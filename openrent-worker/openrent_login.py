"""OpenRent login — wired from Comet B1 (Path B: the plain POST form at
/account/simplelogon — no captcha/2FA, cookies required).

The engine creates a Playwright context (account proxy + saved storage_state)
and a page, then calls login(page, email, password). On success the engine
saves context.storage_state so future runs skip login.
"""
from __future__ import annotations

from browser_util import nav

LOGIN_URL = "https://www.openrent.co.uk/account/simplelogon"
LOGOUT_URL = "https://www.openrent.co.uk/account/logoff"
DASHBOARD_URL = "https://www.openrent.co.uk/my-dashboard"
CAPTCHA_SEL = "iframe[src*='recaptcha'], [class*='recaptcha'], [class*='hcaptcha'], iframe[src*='hcaptcha']"


class NeedsManualLogin(Exception):
    """Raised when login hits a captcha / 2FA that can't be automated."""


def is_logged_in(page) -> bool:
    return bool(page.query_selector("a.profile-menu") or page.query_selector("a.log-out-btn"))


def login(page, email: str, password: str) -> bool:
    if not email or not password:
        raise NeedsManualLogin("missing OpenRent email/password for account")

    nav(page, LOGIN_URL, wait_until="domcontentloaded")

    # Already authenticated via restored cookies?
    if is_logged_in(page):
        return True

    # Captcha / 2FA would block automation -> hand off to manual login.
    if page.query_selector(CAPTCHA_SEL):
        raise NeedsManualLogin("captcha/2FA present on OpenRent login")

    page.fill("#Email", email)
    page.fill("#Password", password)
    page.click("form[action='/account/simplelogon'] button[type='submit']")
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:  # noqa: BLE001
        pass

    if is_logged_in(page):
        return True

    # Validation error means bad credentials.
    err = page.query_selector("span.field-validation-error")
    if err:
        raise RuntimeError(f"OpenRent login failed: {(err.inner_text() or '').strip()[:200]}")

    # Some redirects land on the homepage; confirm via the dashboard.
    nav(page, DASHBOARD_URL, wait_until="domcontentloaded")
    if is_logged_in(page):
        return True

    raise NeedsManualLogin("OpenRent login did not complete (no logged-in indicator)")
