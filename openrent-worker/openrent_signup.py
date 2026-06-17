"""OpenRent account signup — Phase 2 (persona "Maria" auto account-creation).

signup(page, email, password) -> bool:
  Drives the registration form at /account/register and returns True once the
  account is created (OpenRent then emails a confirmation link to `email`, which
  the worker picks up from the catch-all inbox — see worker.py confirm loop).

set_profile_name(page, full_name) -> bool:
  Best-effort sets the account display name to "Maria <Surname>" on the
  edit-profile page. The profile-edit field selectors are NOT in the DOM map
  yet, so this is a non-crashing stub (see TODO below).

Style mirrors openrent_login.py / openrent_enquiry.py: all selectors live here,
the engine creates the proxied Playwright context + page and calls in.

Register form (per the DOM map / handover spec — NO captcha confirmed):
  Email / Password / ConfirmPassword + hidden TokenString +
  __RequestVerificationToken (Playwright form-fill handles the CSRF token).
"""
from __future__ import annotations

BASE = "https://www.openrent.co.uk"
REGISTER_URL = f"{BASE}/account/register"
EDIT_PROFILE_URL = f"{BASE}/account/edit"
DASHBOARD_URL = f"{BASE}/my-dashboard"

# Register form fields (handover spec; no captcha in normal use).
EMAIL_SELS = ["#Email", "input[name='Email']"]
PASSWORD_SELS = ["#Password", "input[name='Password']"]
CONFIRM_SELS = ["#ConfirmPassword", "input[name='ConfirmPassword']"]
# TODO: DOM-map confirm — register page may ask for a name field on signup.
# The classic register form submits via <button type="submit"
# class="btn btn-flex btn-primary">Register</button> (no id/name). The page ALSO
# carries a hidden "OpenID" modal whose buttons ("Continue with email", "Create
# Account") are type=submit too — so we target the visible Register button first
# by its distinctive class/text, and only fall back to generic submit selectors.
SUBMIT_SELS = [
    "button.btn-flex[type='submit']",
    "button:has-text('Register')",
    "form[action='/account/register'] button[type='submit']",
    "form[action='/account/register'] input[type='submit']",
    "form[action*='register'] button[type='submit']",
    "button[type='submit']",
]
# Same anti-bot probe as login — none seen on OpenRent in normal use, but bail
# loudly if one appears so we never silently hammer a captcha.
CAPTCHA_SEL = "iframe[src*='recaptcha'], [class*='recaptcha'], [class*='hcaptcha'], iframe[src*='hcaptcha']"
# Server-side validation error (e.g. "email already in use", weak password).
ERROR_SELS = [
    "span.field-validation-error",
    "div.validation-summary-errors",
    ".text-danger",
]


class SignupBlocked(Exception):
    """Raised when signup hits a captcha / anti-bot wall we can't automate."""


def _fill_first(page, sels, value) -> bool:
    for sel in sels:
        try:
            el = page.query_selector(sel)
            if el:
                el.fill(value)
                return True
        except Exception:
            continue
    return False


def _click_first(page, sels) -> bool:
    """Click the first VISIBLE element matching any selector. We scan ALL matches
    for each selector (not just the first) because the register page carries a
    hidden OpenID modal whose buttons also match generic submit selectors — we
    must skip those hidden ones and click the visible 'Register' button."""
    for sel in sels:
        try:
            for el in page.query_selector_all(sel):
                if el and el.is_visible():
                    el.click()
                    return True
        except Exception:
            continue
    return False


def _first_error(page) -> str | None:
    for sel in ERROR_SELS:
        try:
            el = page.query_selector(sel)
            if el:
                t = (el.inner_text() or "").strip()
                if t:
                    return t[:200]
        except Exception:
            continue
    return None


def signup(page, email: str, password: str) -> bool:
    """Register a new OpenRent account. Returns True on success. Raises on a
    captcha (SignupBlocked) or a validation failure (RuntimeError)."""
    if not email or not password:
        raise RuntimeError("missing email/password for signup")

    page.goto(REGISTER_URL, wait_until="domcontentloaded")
    try:
        page.wait_for_timeout(600)
    except Exception:
        pass

    if page.query_selector(CAPTCHA_SEL):
        raise SignupBlocked("captcha present on OpenRent register form")

    if not _fill_first(page, EMAIL_SELS, email):
        raise RuntimeError("register: email field not found (DOM changed?)")
    if not _fill_first(page, PASSWORD_SELS, password):
        raise RuntimeError("register: password field not found (DOM changed?)")
    # ConfirmPassword may not exist on every layout — fill it if present.
    _fill_first(page, CONFIRM_SELS, password)
    # Hidden TokenString / __RequestVerificationToken are submitted automatically
    # by Playwright's form fill (they're already in the DOM).

    if not _click_first(page, SUBMIT_SELS):
        raise RuntimeError("register: submit button not found")

    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass

    # Success signal: OpenRent leaves the register form. Either we land on the
    # dashboard / a "check your email" confirmation page, or at least we're no
    # longer on /account/register with a visible validation error.
    err = _first_error(page)
    url = page.url or ""
    if "/account/register" in url and err:
        raise RuntimeError(f"OpenRent signup failed: {err}")

    # Treat leaving the register URL, or a confirmation page, as success. The
    # account is "pending_confirm" until the email link is opened (worker.py).
    if "/account/register" not in url:
        return True
    # Some flows stay on the page and show a "confirm your email" notice instead
    # of redirecting — accept that too.
    try:
        body = (page.content() or "").lower()
        if "confirm" in body and ("email" in body) and not err:
            return True
    except Exception:
        pass

    raise RuntimeError("OpenRent signup did not complete (no success signal)")


def set_profile_name(page, full_name: str) -> bool:
    """Best-effort set the account display name to e.g. "Maria Smith".

    # TODO: DOM-map needed — the edit-profile name field selector is NOT in
    # reference_openrent-dom.md (only the URL /account/edit is known). Until
    # Comet maps the field, this is a non-crashing best-effort: it tries a few
    # likely selectors and returns False if none are found, so the caller can
    # carry on (the display name is cosmetic; signup + confirm don't depend on it).
    """
    if not full_name:
        return False
    try:
        page.goto(EDIT_PROFILE_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(500)
    except Exception:
        return False

    # TODO: DOM-map needed — replace these guessed selectors with the real ones.
    name_guess_sels = [
        "#Name", "input[name='Name']",
        "#FullName", "input[name='FullName']",
        "#DisplayName", "input[name='DisplayName']",
    ]
    if not _fill_first(page, name_guess_sels, full_name):
        return False  # field not found — skip silently (cosmetic only)

    # TODO: DOM-map needed — confirm the save button selector on /account/edit.
    save_guess_sels = [
        "form[action*='edit'] button[type='submit']",
        "button[type='submit']",
        "input[type='submit']",
    ]
    if not _click_first(page, save_guess_sels):
        return False
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    return True
