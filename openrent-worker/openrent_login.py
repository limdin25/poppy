"""OpenRent login — wired from Comet B1 (Path B: the plain POST form at
/account/simplelogon — no captcha/2FA, cookies required).

The engine creates a Playwright context (account proxy + saved storage_state)
and a page, then calls login(page, email, password). On success the engine
saves context.storage_state so future runs skip login.

On failure we raise LoginError carrying a `kind` so the engine's self-healing
can decide whether to retry (network/unknown/captcha/unconfirmed) or hand off to
a human immediately (banned/bad_credentials). See worker.Sessions._login_and_track.
"""
from __future__ import annotations

from browser_util import nav

LOGIN_URL = "https://www.openrent.co.uk/account/simplelogon"
LOGOUT_URL = "https://www.openrent.co.uk/account/logoff"
DASHBOARD_URL = "https://www.openrent.co.uk/my-dashboard"
CAPTCHA_SEL = "iframe[src*='recaptcha'], [class*='recaptcha'], [class*='hcaptcha'], iframe[src*='hcaptcha']"

# Classified failure kinds. Terminal kinds can't be fixed by retrying.
KIND_NETWORK = "network"           # couldn't reach the site (proxy/timeout) — retry
KIND_CAPTCHA = "captcha"           # captcha/2FA challenge — retry a few times, then human
KIND_BAD_CREDENTIALS = "bad_credentials"  # wrong email/password — human
KIND_UNCONFIRMED = "unconfirmed"   # email not confirmed yet — retry (may propagate)
KIND_BANNED = "banned"             # account suspended/blocked — human
KIND_UNKNOWN = "unknown"           # logged-in indicator never appeared, no clear reason


class LoginError(Exception):
    """A failed OpenRent login, classified by `kind` for self-healing."""

    def __init__(self, message: str, kind: str = KIND_UNKNOWN):
        super().__init__(message)
        self.kind = kind


# Back-compat alias: older code/tests import NeedsManualLogin. It's now any
# classified login failure (defaults to 'unknown' when constructed with a string).
NeedsManualLogin = LoginError


def is_logged_in(page) -> bool:
    return bool(page.query_selector("a.profile-menu") or page.query_selector("a.log-out-btn"))


def _body_text(page) -> str:
    """Lower-cased visible page text (best-effort) for failure classification."""
    try:
        return (page.inner_text("body") or "").lower()
    except Exception:  # noqa: BLE001
        return ""


def classify_failure(page) -> tuple[str, str]:
    """Inspect a page where login did NOT complete and return (kind, human_detail).

    Order matters: most specific / most actionable signals first."""
    # Captcha / 2FA challenge on the page.
    if page.query_selector(CAPTCHA_SEL):
        return (KIND_CAPTCHA, "A captcha / 2-factor challenge appeared on the login page.")

    # Inline validation error under the form usually means wrong email/password.
    err = page.query_selector("span.field-validation-error")
    if err:
        try:
            msg = (err.inner_text() or "").strip()[:200]
        except Exception:  # noqa: BLE001
            msg = ""
        return (KIND_BAD_CREDENTIALS, msg or "OpenRent rejected the email/password.")

    txt = _body_text(page)
    try:
        url = (page.url or "").lower()
    except Exception:  # noqa: BLE001
        url = ""

    # Account suspended / blocked / locked.
    if any(s in txt for s in ("suspended", "your account has been disabled", "account has been blocked",
                              "account is locked", "banned", "we've locked")):
        return (KIND_BANNED, "OpenRent says this account is suspended / blocked.")

    # Email not yet confirmed (signup confirmation hasn't landed / propagated).
    if any(s in txt for s in ("confirm your email", "verify your email", "not been confirmed",
                              "please confirm", "email address has not been verified")) \
       or any(s in url for s in ("confirm", "verify", "activate")):
        return (KIND_UNCONFIRMED, "OpenRent is still waiting for the account's email to be confirmed.")

    return (KIND_UNKNOWN, "OpenRent login did not complete (no logged-in indicator).")


def login(page, email: str, password: str) -> bool:
    """Log the account in. Returns True on success; raises LoginError (with .kind)
    on failure. Network/timeout errors from nav() propagate as plain exceptions and
    are treated by the caller as a transient 'network' failure."""
    if not email or not password:
        raise LoginError("missing OpenRent email/password for account", KIND_BAD_CREDENTIALS)

    nav(page, LOGIN_URL, wait_until="domcontentloaded")

    # Already authenticated via restored cookies?
    if is_logged_in(page):
        return True

    # Captcha / 2FA would block automation -> classified handoff.
    if page.query_selector(CAPTCHA_SEL):
        raise LoginError("captcha/2FA present on OpenRent login", KIND_CAPTCHA)

    page.fill("#Email", email)
    page.fill("#Password", password)
    page.click("form[action='/account/simplelogon'] button[type='submit']")
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:  # noqa: BLE001
        pass

    if is_logged_in(page):
        return True

    # Some redirects land on the homepage; confirm via the dashboard before giving up.
    nav(page, DASHBOARD_URL, wait_until="domcontentloaded")
    if is_logged_in(page):
        return True

    kind, detail = classify_failure(page)
    raise LoginError(detail, kind)
