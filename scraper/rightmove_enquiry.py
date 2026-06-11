"""Rightmove enquiry form-filler (Playwright).

Submits a genuine buyer enquiry on a single Rightmove listing: opens the
"Contact agent" form, fills our details + a cash-buyer please-call message,
solves the invisible reCAPTCHA via 2Captcha, and submits.

Safety first:
  • dry_run=True (default) fills everything and screenshots but NEVER submits.
  • one property at a time, human-paced — these are real enquiries, not a blast.
  • reuses the scraper's existing anti-detection + residential proxy setup.

The call path (rightmove_scraper.CompsFetcher / the Retell qualifier) is
completely untouched by this module.
"""
import asyncio
import datetime
import random
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

try:
    from playwright_stealth import stealth_async
except Exception:  # pragma: no cover - optional dep
    stealth_async = None

from captcha_solver import TwoCaptchaSolver, CaptchaError
from enquiry_config import build_enquiry_message

# Rightmove's enquiry form is gated by Arkose Labs FunCaptcha (confirmed by
# live probe). reCAPTCHA on the page is a decoy.
ARKOSE_PUBLICKEY = "91523F73-E56D-4DD9-86C4-5D4E5464E3D8"
ARKOSE_SURL = "https://rightmove-api.arkoselabs.com"

# Installed via add_init_script BEFORE the page's api.js runs (timing is
# critical — page.evaluate after load is too late). Hooks the data-callback
# global so we capture the enforcement instance, then wraps setConfig to steal
# config.data.blob and the site's real onCompleted callback. Firing that
# callback ourselves with a solved token completes the submit as a human would.
ARKOSE_HOOK_JS = r"""
window.__arkose = { instance: null, blob: null, onCompleted: null };
(function () {
  function wrap(enforcement) {
    try {
      if (!enforcement || enforcement.__hooked) return enforcement;
      enforcement.__hooked = true;
      window.__arkose.instance = enforcement;
      var orig = enforcement.setConfig.bind(enforcement);
      enforcement.setConfig = function (cfg) {
        try {
          if (cfg && cfg.data && cfg.data.blob) window.__arkose.blob = cfg.data.blob;
          if (cfg && cfg.onCompleted) window.__arkose.onCompleted = cfg.onCompleted;
        } catch (e) {}
        return orig(cfg);
      };
    } catch (e) {}
    return enforcement;
  }
  ['setupEnforcement', 'setupArkose', 'arkoseSetup'].forEach(function (name) {
    var real = null;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return real ? function (e) { return real(wrap(e)); }
                                       : function (e) { return wrap(e); }; },
        set: function (fn) { real = fn; }
      });
    } catch (e) {}
  });
})();
"""

# Field selectors, most-specific first; we try each until one is present so a
# Rightmove markup tweak degrades gracefully rather than hard-failing.
FIELD_SELECTORS = {
    "first_name": ["#firstName", "input[name='firstName']", "input[name='name.first']"],
    "last_name": ["#lastName", "input[name='lastName']", "input[name='name.last']"],
    "email": ["#email", "input[name='email']", "input[type='email']"],
    "phone": ["input[name='phone.number']", "input[type='tel']", "input[name='telephone']"],
    "postcode": ["#postcode", "input[name='postcode']", "input[name='address.postcode']"],
    "message": ["#comments", "textarea[name='comments']", "textarea[name='message']",
                "textarea"],
}
# Required <select> dropdowns on the enquiry form. We're a cash buyer with
# nothing of our own to sell or let, so "no" to both — honest and valid.
SELECT_FIELDS = [
    ("sellingSituationType", "no"),
    ("rentingSituationType", "no"),
]
# "Send email without an account" is the no-signup submit; there's also a
# "Create an account and send email" button — target the former explicitly.
SUBMIT_SELECTORS = [
    "button:has-text('Send email without an account')",
    "button:has-text('Send email')", "button:has-text('Send enquiry')",
    "button:has-text('Email agent')",
]
SCREENSHOT_DIR = Path(__file__).parent / "data" / "enquiry_screenshots"


def contact_page_url(listing_url):
    """Map a listing URL to its enquiry-form URL.

    https://www.rightmove.co.uk/properties/12345  ->
    https://www.rightmove.co.uk/property-for-sale/contactBranch.html?propertyId=12345
    """
    pid = ""
    if listing_url:
        # last all-digit path segment is the property id
        for part in listing_url.rstrip("/").split("/"):
            digits = "".join(c for c in part if c.isdigit())
            if digits and digits == part.split("#")[0].split("?")[0]:
                pid = digits
        if not pid:
            tail = listing_url.rstrip("/").split("/")[-1]
            pid = "".join(c for c in tail if c.isdigit())
    return ("https://www.rightmove.co.uk/property-for-sale/contactBranch.html"
            f"?propertyId={pid}")


class EnquiryResult:
    def __init__(self, property_id, ok, dry_run, message="", screenshot=None, error=None):
        self.property_id = property_id
        self.ok = ok
        self.dry_run = dry_run
        self.message = message
        self.screenshot = screenshot
        self.error = error

    def to_dict(self):
        return {
            "property_id": self.property_id, "ok": self.ok, "dry_run": self.dry_run,
            "message": self.message, "screenshot": self.screenshot, "error": self.error,
        }


class EnquiryFiller:
    def __init__(self, proxy_mgr, contact, captcha_key, *, emit=None,
                 dry_run=True, headless=True, auto_solve=False):
        self.proxy = proxy_mgr
        self.contact = contact
        self.captcha_key = captcha_key
        self.emit = emit or (lambda e: None)
        self.dry_run = dry_run
        self.headless = headless
        # 2captcha returns UNSOLVABLE for Rightmove's Arkose today, so the
        # auto-solve is OFF by default and we rely on Hugo finishing the quick
        # puzzle in the headed window. Flip on to retry 2captcha later.
        self.auto_solve = auto_solve

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    async def enquire(self, property_row):
        """Fill (and, unless dry_run, submit) the enquiry for one property."""
        pid = str(property_row.get("property_id") or property_row.get("source_property_id") or "")
        url = contact_page_url(property_row.get("listing_url"))
        message = build_enquiry_message(property_row, self.contact)

        async with async_playwright() as pw:
            kwargs = dict(
                headless=self.headless,
                args=["--disable-blink-features=AutomationControlled",
                      "--disable-dev-shm-usage", "--no-default-browser-check",
                      "--no-first-run"],
            )
            proxy_arg = self.proxy.playwright_proxy() if self.proxy else None
            if proxy_arg:
                kwargs["proxy"] = proxy_arg
            browser = await pw.chromium.launch(**kwargs)
            try:
                ctx = await browser.new_context(
                    viewport={"width": 1366, "height": 900},
                    user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                "AppleWebKit/537.36 (KHTML, like Gecko) "
                                "Chrome/124.0.0.0 Safari/537.36"),
                    locale="en-GB", ignore_https_errors=True,
                )
                await ctx.add_init_script(
                    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
                )
                # Arkose hook — MUST be installed before the page's api.js runs.
                await ctx.add_init_script(ARKOSE_HOOK_JS)
                ctx.set_default_navigation_timeout(60_000)
                ctx.set_default_timeout(30_000)
                page = await ctx.new_page()
                if stealth_async:
                    try:
                        await stealth_async(page)
                    except Exception:
                        pass
                return await self._fill(page, pid, url, message)
            finally:
                await browser.close()

    async def _fill(self, page, pid, url, message):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(2)
            await self._dismiss_cookies(page)

            filled = await self._fill_fields(page, message)
            if not filled:
                return EnquiryResult(pid, False, self.dry_run,
                                     error="no enquiry fields found on page")

            shot = await self._screenshot(page, pid)

            if self.dry_run:
                self._log(f"DRY RUN {pid}: form filled, NOT submitted ({shot})")
                return EnquiryResult(pid, True, True, message=message, screenshot=shot)

            # Click submit (a real, trusted browser click). This triggers the
            # Arkose challenge.
            await self._submit(page)
            if self.auto_solve and self.captcha_key:
                await self._try_solve_arkose(page, url)
            confirmed = await self._wait_for_outcome(page)
            shot2 = await self._screenshot(page, pid + "_after")
            return EnquiryResult(pid, confirmed, False, message=message,
                                 screenshot=shot2,
                                 error=None if confirmed else "no confirmation detected")
        except PWTimeout as e:
            return EnquiryResult(pid, False, self.dry_run, error=f"timeout: {e}")
        except CaptchaError as e:
            return EnquiryResult(pid, False, self.dry_run, error=f"captcha: {e}")
        except Exception as e:  # pragma: no cover - defensive
            return EnquiryResult(pid, False, self.dry_run, error=str(e))

    async def _dismiss_cookies(self, page):
        try:
            btn = page.locator("#onetrust-accept-btn-handler")
            if await btn.count():
                await btn.first.click(timeout=4000)
                await asyncio.sleep(0.5)
        except Exception:
            pass

    async def _fill_fields(self, page, message):
        values = {
            "first_name": self.contact.get("first_name", ""),
            "last_name": self.contact.get("last_name", ""),
            "email": self.contact.get("email", ""),
            "phone": self.contact.get("phone", ""),
            "postcode": self.contact.get("postcode", ""),
            "message": message,
        }
        any_filled = False
        for field, selectors in FIELD_SELECTORS.items():
            val = values.get(field, "")
            if not val:
                continue
            for sel in selectors:
                try:
                    loc = page.locator(sel).first
                    if await loc.count():
                        await loc.fill(val, timeout=4000)
                        # Blur so the field's own validation clears (the form
                        # re-validates on blur, not just on submit).
                        try:
                            await loc.evaluate("el => el.blur()")
                        except Exception:
                            pass
                        any_filled = True
                        break
                except Exception:
                    continue

        # Required dropdowns — set to "no" (we have nothing to sell/let).
        for select_id, value in SELECT_FIELDS:
            try:
                loc = page.locator(f"#{select_id}, select[name='{select_id}']").first
                if await loc.count():
                    await loc.select_option(value, timeout=4000)
            except Exception:
                continue
        return any_filled

    async def _try_solve_arkose(self, page, url):
        """If Arkose challenges, capture its blob, solve via 2captcha, inject.

        Returns True if a token was solved and injected. On any failure it
        returns False — in headed mode _wait_for_outcome then lets Hugo finish
        the puzzle by hand (belt-and-braces).
        """
        if not self.captcha_key:
            return False
        # Wait for the hook to capture Arkose's onCompleted (set when the page's
        # api.js calls setConfig). Rightmove's Arkose uses NO data blob, so we
        # solve with just the public key + surl. blob stays None.
        blob = None
        ready = False
        for _ in range(15):  # ~15s
            state = await page.evaluate(
                """() => ({
                    onc: !!(window.__arkose && typeof window.__arkose.onCompleted === 'function'),
                    blob: (window.__arkose && window.__arkose.blob) || null
                })""")
            if state.get("onc"):
                blob = state.get("blob")
                ready = True
                break
            await asyncio.sleep(1)
        if not ready:
            return False

        # Public key from the live api.js script, falling back to the known one.
        publickey = await page.evaluate(
            """() => {
                const s = document.querySelector('script[src*="arkoselabs.com/v2/"]');
                if (!s) return null;
                const m = s.src.match(/\\/v2\\/([0-9A-Fa-f-]{36})\\//);
                return m ? m[1] : null;
            }""") or ARKOSE_PUBLICKEY

        self._log("solving Arkose FunCaptcha via 2captcha…")
        solver = TwoCaptchaSolver(self.captcha_key)
        try:
            token = await asyncio.to_thread(
                solver.solve_funcaptcha, publickey, url, ARKOSE_SURL, blob)
        except CaptchaError as e:
            self._log(f"Arkose solve failed: {e}", "warn")
            return False

        injected = await page.evaluate(
            """(tok) => {
                let fired = false;
                try {
                    if (window.__arkose && typeof window.__arkose.onCompleted === 'function') {
                        window.__arkose.onCompleted({ token: tok });
                        fired = true;
                    }
                } catch (e) {}
                // Fallback: write the token into a hidden field the form posts.
                const el = document.querySelector(
                    '#fc-token, #FunCaptcha-Token, input[name="fc-token"], '
                    + 'input[name="verification-token"], input[name="arkose-token"]');
                if (el) {
                    el.value = tok;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    fired = true;
                }
                return fired;
            }""", token)
        self._log("Arkose token injected" if injected else "Arkose token solved but no sink found")
        return bool(injected)

    async def _submit(self, page):
        # Prefer the real "Send email" submit button by accessible name, then
        # fall back to selectors. Scroll it into view and force-click if a
        # late-loading overlay intercepts the normal click.
        candidates = []
        try:
            candidates.append(page.get_by_role("button", name="Send email without an account"))
        except Exception:
            pass
        candidates += [page.locator(sel) for sel in SUBMIT_SELECTORS]

        for loc in candidates:
            try:
                btn = loc.first
                if not await btn.count():
                    continue
                try:
                    await btn.scroll_into_view_if_needed(timeout=4000)
                except Exception:
                    pass
                try:
                    await btn.click(timeout=6000)
                except Exception:
                    await btn.click(timeout=6000, force=True)
                return
            except Exception:
                continue
        await self._screenshot(page, "SUBMIT_FAIL")
        raise RuntimeError("submit button not found")

    async def _wait_for_outcome(self, page, timeout=180):
        """After clicking submit, poll until the enquiry is confirmed.

        If Arkose throws its "Security Verification" puzzle, prompt Hugo (once)
        to solve it in the visible browser window, then keep waiting — once he
        solves it Rightmove completes the original submit on its own.
        """
        prompted = False
        elapsed = 0.0
        while elapsed < timeout:
            if await self._confirm_sent(page):
                return True
            if await self._arkose_present(page) and not prompted:
                self._log("👉 Solve the quick 'Security Verification' puzzle in "
                          "the browser window — I'll detect when it's sent.", "warn")
                prompted = True
            await asyncio.sleep(2)
            elapsed += 2
        return False

    async def _arkose_present(self, page):
        try:
            return await page.evaluate(
                """() => {
                    const t = (document.body.innerText || '').toLowerCase();
                    if (t.includes('security verification') ||
                        t.includes('solve this puzzle') ||
                        t.includes('solve the puzzle')) return true;
                    return !!document.querySelector(
                        'iframe[src*="arkoselabs"], #arkose, [id*="arkose"], '
                        '[class*="arkose"], iframe[src*="funcaptcha"]');
                }""")
        except Exception:
            return False

    async def _confirm_sent(self, page):
        try:
            text = (await page.evaluate("() => document.body.innerText") or "").lower()
        except Exception:
            return False
        return any(s in text for s in (
            "your enquiry has been sent", "email has been sent",
            "thank you", "message sent", "we've sent your"))

    async def _screenshot(self, page, name):
        try:
            SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            path = SCREENSHOT_DIR / f"{name}-{ts}.png"
            await page.screenshot(path=str(path), full_page=True)
            return str(path)
        except Exception:
            return None
