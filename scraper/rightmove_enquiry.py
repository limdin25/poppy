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

# Discovered via recon (contactBranch.html). Invisible reCAPTCHA v2.
RECAPTCHA_SITEKEY = "6LfB1DAUAAAAACA3VeBnG7TpTqdNQ0_ds3aguGhk"

# Field selectors, most-specific first; we try each until one is present so a
# Rightmove markup tweak degrades gracefully rather than hard-failing.
FIELD_SELECTORS = {
    "first_name": ["#firstName", "input[name='firstName']", "input[name='name.first']"],
    "last_name": ["#lastName", "input[name='lastName']", "input[name='name.last']"],
    "email": ["#email", "input[name='email']", "input[type='email']"],
    "phone": ["#phone", "input[name='phone.number']", "input[name='telephone']",
              "input[type='tel']"],
    "postcode": ["#postcode", "input[name='postcode']", "input[name='address.postcode']"],
    "message": ["#comments", "textarea[name='comments']", "textarea[name='message']",
                "textarea"],
}
SUBMIT_SELECTORS = [
    "button:has-text('Send email')", "button:has-text('Send enquiry')",
    "button[type='submit']", "button:has-text('Email agent')",
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
                 dry_run=True, headless=True):
        self.proxy = proxy_mgr
        self.contact = contact
        self.captcha_key = captcha_key
        self.emit = emit or (lambda e: None)
        self.dry_run = dry_run
        self.headless = headless

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

            await self._solve_captcha(page, url)
            await self._submit(page)
            await asyncio.sleep(2)
            confirmed = await self._confirm_sent(page)
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
                        any_filled = True
                        break
                except Exception:
                    continue
        return any_filled

    async def _solve_captcha(self, page, url):
        # Only solve if a reCAPTCHA is actually on the page.
        has_captcha = await page.evaluate(
            "() => !!document.querySelector('.g-recaptcha, [data-sitekey], "
            "iframe[src*=\"recaptcha\"]')"
        )
        if not has_captcha:
            self._log("no reCAPTCHA present — submitting without solve")
            return
        sitekey = await page.evaluate(
            "() => { const el = document.querySelector('[data-sitekey]');"
            " return el ? el.getAttribute('data-sitekey') : null; }"
        ) or RECAPTCHA_SITEKEY
        self._log("solving reCAPTCHA via 2captcha…")
        solver = TwoCaptchaSolver(self.captcha_key)
        token = await asyncio.to_thread(
            solver.solve_recaptcha_v2, sitekey, url, invisible=True)
        await page.evaluate(
            """(tok) => {
                let el = document.getElementById('g-recaptcha-response');
                if (!el) {
                    el = document.createElement('textarea');
                    el.id = 'g-recaptcha-response';
                    el.name = 'g-recaptcha-response';
                    el.style.display = 'none';
                    document.body.appendChild(el);
                }
                el.innerHTML = tok; el.value = tok;
                // Fire any invisible-recaptcha callback we can find.
                try {
                    const cfg = window.___grecaptcha_cfg;
                    if (cfg && cfg.clients) {
                        for (const c of Object.values(cfg.clients)) {
                            const stack = [c];
                            while (stack.length) {
                                const o = stack.pop();
                                if (o && typeof o === 'object') {
                                    for (const k of Object.keys(o)) {
                                        if (k === 'callback' && typeof o[k] === 'function') {
                                            o[k](tok); return;
                                        }
                                        if (o[k] && typeof o[k] === 'object') stack.push(o[k]);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {}
            }""", token)
        self._log("captcha token injected")

    async def _submit(self, page):
        for sel in SUBMIT_SELECTORS:
            try:
                loc = page.locator(sel).first
                if await loc.count():
                    await loc.click(timeout=6000)
                    return
            except Exception:
                continue
        raise RuntimeError("submit button not found")

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
