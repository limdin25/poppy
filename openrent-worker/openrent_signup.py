"""OpenRent account signup — Phase 2 (persona "Maria" auto account-creation).

signup(page, email, password) -> bool:
  Drives the registration form at /account/register and returns True once the
  account is created (OpenRent then emails a confirmation link to `email`, which
  the worker picks up from the catch-all inbox — see worker.py confirm loop).

ensure_profile_name(page, first, last) -> NAME_* status:
  Idempotently sets the account's First name (+ Surname) on /account/edit
  (#FirstName / #Surname, Save = #submitButton — LIVE-mapped 2026-06-18).
  Verifies by re-reading. set_profile_name(page, full_name) is a thin shim.

Style mirrors openrent_login.py / openrent_enquiry.py: all selectors live here,
the engine creates the proxied Playwright context + page and calls in.

Register form (per the DOM map / handover spec — NO captcha confirmed):
  Email / Password / ConfirmPassword + hidden TokenString +
  __RequestVerificationToken (Playwright form-fill handles the CSRF token).
"""
from __future__ import annotations

from browser_util import nav

BASE = "https://www.openrent.co.uk"
REGISTER_URL = f"{BASE}/account/register"
EDIT_PROFILE_URL = f"{BASE}/account/edit"
DASHBOARD_URL = f"{BASE}/my-dashboard"

# /account/edit profile fields — LIVE-mapped through the proxied worker session
# 2026-06-18 (ASP.NET form; ids == names). First name is PUBLIC, Surname PRIVATE.
FIRST_NAME_SELS = ["#FirstName", "input[name='FirstName']"]
SURNAME_SELS = ["#Surname", "input[name='Surname']"]
PROFILE_SAVE_SELS = ["#submitButton", "form button[type='submit']"]

# ensure_profile_name() outcome (mirrors openrent_login's KIND_* style).
NAME_ALREADY_SET = "already-set"   # first name already correct — no write
NAME_SET = "set"                   # filled + saved + re-read confirms
NAME_NO_FIELD = "no-field"         # first-name field absent (logged out / DOM changed)
NAME_SAVE_FAILED = "save-failed"   # filled but save/verify didn't take
NAME_NAV_FAILED = "nav-failed"     # couldn't reach /account/edit

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


def _read_value(page, sels) -> str | None:
    """Current value of the first matching input, or None if no field is found
    (e.g. we got redirected to the login page because the session is dead)."""
    for sel in sels:
        try:
            el = page.query_selector(sel)
            if el:
                return (el.input_value() or "").strip()
        except Exception:
            continue
    return None


def ensure_profile_name(page, first: str, last: str = "") -> str:
    """Idempotently set the OpenRent profile First name (+ Surname) on
    /account/edit. `page` must ALREADY be logged in. Reads the current First name;
    if it already equals `first` (case-insensitive) returns NAME_ALREADY_SET
    without writing. Otherwise fills First (+ Surname if given), clicks Save, then
    re-reads First to verify. Never raises for a missing field — returns a NAME_*
    status so the caller can log/skip. (First name is PUBLIC on OpenRent — setting
    it fixes the "Hey ," / "No name provided" blank-sender problem.)"""
    first = (first or "").strip()
    last = (last or "").strip()
    if not first:
        return NAME_NO_FIELD
    try:
        nav(page, EDIT_PROFILE_URL)
        page.wait_for_timeout(600)
    except Exception:  # noqa: BLE001
        return NAME_NAV_FAILED

    current = _read_value(page, FIRST_NAME_SELS)
    if current is None:
        return NAME_NO_FIELD  # not logged in / DOM changed — no first-name field
    if current.casefold() == first.casefold():
        return NAME_ALREADY_SET

    if not _fill_first(page, FIRST_NAME_SELS, first):
        return NAME_NO_FIELD
    if last:
        _fill_first(page, SURNAME_SELS, last)  # best-effort (Surname is private)

    if not _click_first(page, PROFILE_SAVE_SELS):
        return NAME_SAVE_FAILED
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:  # noqa: BLE001
        pass

    # Verify by RE-READING the First name (more reliable than a success banner).
    try:
        nav(page, EDIT_PROFILE_URL)
        page.wait_for_timeout(500)
    except Exception:  # noqa: BLE001
        pass
    after = _read_value(page, FIRST_NAME_SELS)
    if after is not None and after.casefold() == first.casefold():
        return NAME_SET
    return NAME_SAVE_FAILED


def set_profile_name(page, full_name: str) -> bool:
    """Back-compat shim: split "Maria Smith" → first/last and call
    ensure_profile_name. Returns True if the name is now set."""
    parts = (full_name or "").split()
    if not parts:
        return False
    first, last = parts[0], " ".join(parts[1:])
    return ensure_profile_name(page, first, last) in (NAME_SET, NAME_ALREADY_SET)
