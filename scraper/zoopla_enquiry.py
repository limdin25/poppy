"""Zoopla enquiry form-filler — the piece that actually works (vs Rightmove).

Zoopla's "Email agent" form is gated by reCAPTCHA v2 (NOT Arkose), which
2captcha solves reliably. So this completes hands-off, no human, no AI driving:
fill -> select investor situation -> solve reCAPTCHA -> submit.

Headed real Chrome + the iProyal residential proxy (Cloudflare). The contact
NAME is "Elsie" so agent call-backs route as property enquiries.
"""
import asyncio
import datetime
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

from captcha_solver import TwoCaptchaSolver, CaptchaError
from enquiry_config import build_enquiry_message
from zoopla_scraper import is_cloudflare, FreshSession, dismiss_consent

# reCAPTCHA v2 on Zoopla's enquiry form (confirmed live).
ZOOPLA_RECAPTCHA_SITEKEY = "6Lc96NEaAAAAAFMMHlwojpLUzh-wqU8fE1wuIvhq"
SCREENSHOT_DIR = Path(__file__).parent / "data" / "enquiry_screenshots"


class ZooplaEnquiryResult:
    def __init__(self, property_id, ok, dry_run, message="", screenshot=None, error=None):
        self.property_id = property_id
        self.ok = ok
        self.dry_run = dry_run
        self.message = message
        self.screenshot = screenshot
        self.error = error

    def to_dict(self):
        return {"property_id": self.property_id, "ok": self.ok, "dry_run": self.dry_run,
                "message": self.message, "screenshot": self.screenshot, "error": self.error}


class ZooplaEnquiryFiller:
    def __init__(self, contact, captcha_key, *, emit=None, dry_run=True,
                 proxy=None, user_data_dir="data/zoopla_profile", kind="sale"):
        self.contact = contact
        self.captcha_key = captcha_key
        self.emit = emit or (lambda e: None)
        self.dry_run = dry_run
        self.proxy = proxy
        self.user_data_dir = user_data_dir
        self.kind = kind  # 'sale' or 'rent' — selects the pitch template

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    async def enquire(self, property_row):
        pid = str(property_row.get("property_id") or "")
        url = property_row.get("listing_url") or f"https://www.zoopla.co.uk/for-sale/details/{pid}/"
        message = build_enquiry_message(property_row, self.contact, kind=self.kind)
        # Every enquiry = a brand-new session: clean throwaway profile + a fresh
        # rotating residential IP. Reusing a session is what gets flagged.
        async with FreshSession(base_proxy=self.proxy, headless=False) as ctx:
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            return await self._fill(page, pid, url, message)

    async def _fill(self, page, pid, url, message):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            for _ in range(12):
                if not is_cloudflare(await page.title()):
                    break
                await asyncio.sleep(2)
            if is_cloudflare(await page.title()):
                shot = await self._screenshot(page, "ZP_" + pid + "_cloudflare")
                return ZooplaEnquiryResult(pid, False, self.dry_run,
                                           error="Cloudflare did not clear", screenshot=shot)
            await dismiss_consent(page)
            await asyncio.sleep(0.5)
            # open the "Email agent" form (only present on email-enabled listings).
            # Retry, re-dismissing consent in case the banner re-blocks the click.
            opened = await self._open_email_form(page)
            if not opened:
                await dismiss_consent(page)
                opened = await self._open_email_form(page)
            if not opened:
                shot = await self._screenshot(page, "ZP_" + pid + "_noemailbtn")
                return ZooplaEnquiryResult(pid, False, self.dry_run,
                                           error="no Email-agent option on this listing", screenshot=shot)
            # form fields may take a moment; consent can pop late and block them
            try:
                await page.wait_for_selector("#name, input[name='name']", timeout=12000)
            except PWTimeout:
                await dismiss_consent(page)

            filled = await self._fill_fields(page, message)
            if not filled:
                shot = await self._screenshot(page, "ZP_" + pid + "_noform")
                return ZooplaEnquiryResult(pid, False, self.dry_run,
                                           error="enquiry form not found", screenshot=shot)
            shot = await self._screenshot(page, "ZP_" + pid)
            if self.dry_run:
                self._log(f"DRY RUN {pid}: filled, not submitted ({shot})")
                return ZooplaEnquiryResult(pid, True, True, message=message, screenshot=shot)

            await self._solve_recaptcha(page, url)
            await self._submit(page)
            await asyncio.sleep(3)
            confirmed = await self._confirm(page)
            shot2 = await self._screenshot(page, "ZP_" + pid + "_after")
            return ZooplaEnquiryResult(pid, confirmed, False, message=message, screenshot=shot2,
                                       error=None if confirmed else "no confirmation detected")
        except PWTimeout as e:
            return ZooplaEnquiryResult(pid, False, self.dry_run, error=f"timeout: {e}")
        except CaptchaError as e:
            return ZooplaEnquiryResult(pid, False, self.dry_run, error=f"captcha: {e}")
        except Exception as e:  # pragma: no cover
            return ZooplaEnquiryResult(pid, False, self.dry_run, error=str(e))

    async def _open_email_form(self, page):
        for sel in ["button:has-text('Email agent')", "a:has-text('Email agent')",
                    "button:has-text('Email')", "a:has-text('Request details')"]:
            try:
                b = page.locator(sel).first
                if await b.count():
                    await b.first.scroll_into_view_if_needed(timeout=3000)
                    await b.first.click(timeout=6000)
                    return True
            except Exception:
                continue
        return False

    async def _dismiss_cookies(self, page):
        try:
            btn = page.locator("#onetrust-accept-btn-handler, button:has-text('Accept')").first
            if await btn.count():
                await btn.first.click(timeout=4000)
                await asyncio.sleep(0.5)
        except Exception:
            pass

    async def _fill_fields(self, page, message):
        c = self.contact
        fields = [
            (["#name", "input[name='name']"], f"{c.get('first_name','Elsie')} {c.get('last_name','Bennett')}".strip()),
            (["#email", "input[name='email']"], c.get("email", "")),
            (["#phone", "input[name='phone']"], c.get("phone", "")),
            (["#postcode", "input[name='postcode']"], c.get("postcode", "")),
            (["#message", "textarea[name='message']", "textarea"], message),
        ]
        any_filled = False
        for sels, val in fields:
            if not val:
                continue
            for s in sels:
                try:
                    loc = page.locator(s).first
                    if await loc.count():
                        await loc.fill(val, timeout=4000)
                        any_filled = True
                        break
                except Exception:
                    continue
        # situation -> investor (honest: we're cash investors)
        try:
            sel = page.locator("form select, select").first
            if await sel.count():
                await sel.select_option("looking_to_invest", timeout=4000)
        except Exception:
            pass
        return any_filled

    async def _solve_recaptcha(self, page, url):
        # reCAPTCHA loads lazily after the form is interacted with — wait for it.
        for _ in range(8):
            present = await page.evaluate(
                "() => !!document.querySelector('[data-sitekey], iframe[src*=\"recaptcha\"]')")
            if present:
                break
            await asyncio.sleep(1)
        sitekey = await page.evaluate(
            "() => { const e=document.querySelector('[data-sitekey]'); return e?e.getAttribute('data-sitekey'):null; }"
        ) or ZOOPLA_RECAPTCHA_SITEKEY
        invisible = await page.evaluate(
            "() => { const e=document.querySelector('.g-recaptcha'); return e?e.getAttribute('data-size')==='invisible':false; }")
        self._log("solving reCAPTCHA via 2captcha…")
        solver = TwoCaptchaSolver(self.captcha_key)
        token = await asyncio.to_thread(solver.solve_recaptcha_v2, sitekey, url, invisible=bool(invisible))
        await page.evaluate("""(t) => {
            let el = document.getElementById('g-recaptcha-response');
            if (el) { el.value = t; el.innerHTML = t; }
            try {
                const cfg = window.___grecaptcha_cfg;
                if (cfg && cfg.clients) {
                    for (const c of Object.values(cfg.clients)) {
                        const st=[c];
                        while (st.length) { const o=st.pop();
                            if (o && typeof o==='object') for (const k of Object.keys(o)) {
                                if (k==='callback' && typeof o[k]==='function') { o[k](t); return; }
                                if (o[k] && typeof o[k]==='object') st.push(o[k]);
                            }
                        }
                    }
                }
            } catch (e) {}
        }""", token)
        self._log("reCAPTCHA token injected")

    async def _submit(self, page):
        for sel in ["button:has-text('Send enquiry')", "button:has-text('Send')",
                    "form button[type='submit']", "button[type='submit']"]:
            try:
                loc = page.locator(sel).first
                if await loc.count():
                    await loc.scroll_into_view_if_needed(timeout=3000)
                    await loc.click(timeout=6000)
                    return
            except Exception:
                continue
        raise RuntimeError("Send enquiry button not found")

    async def _confirm(self, page):
        try:
            t = (await page.evaluate("() => document.body.innerText") or "").lower()
        except Exception:
            return False
        return any(s in t for s in (
            "your enquiry has been sent", "enquiry sent", "message has been sent",
            "thanks for your enquiry", "we've sent your", "successfully sent",
            # Zoopla's actual post-submit confirmations:
            "should contact you in the next", "will contact you in the next",
            "show you're a serious buyer", "show you are a serious buyer",
            "what happens next", "your details have been sent"))

    async def _screenshot(self, page, name):
        try:
            SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            path = SCREENSHOT_DIR / f"{name}-{ts}.png"
            await page.screenshot(path=str(path), full_page=True)
            return str(path)
        except Exception:
            return None
