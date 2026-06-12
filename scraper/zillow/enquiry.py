"""Zillow buyer-enquiry filler — the trojan that triggers the realtor callback.

The "Contact Listing Agent" modal (Name / Phone / Email / Message -> Contact
Agent -> "Message sent") works logged-out, no captcha. We fill our US callback
number as the phone, so when the realtor calls the "buyer" back they reach
Elsie's pitch line (+12723471167). The message stays as Zillow's default
("I am interested in <address>") — a clean buyer enquiry.

patchright + US residential IP beats PerimeterX on the detail page.
"""
import asyncio
import datetime
from pathlib import Path

from patchright.async_api import TimeoutError as PWTimeout

from .scraper import UsSession, is_perimeterx

SHOTS = Path(__file__).resolve().parent.parent / "data" / "enquiry_screenshots"


class ZillowEnquiryResult:
    def __init__(self, zpid, ok, dry_run, screenshot=None, error=None):
        self.zpid = zpid
        self.ok = ok
        self.dry_run = dry_run
        self.screenshot = screenshot
        self.error = error

    def to_dict(self):
        return {"zpid": self.zpid, "ok": self.ok, "dry_run": self.dry_run,
                "screenshot": self.screenshot, "error": self.error}


class ZillowEnquiryFiller:
    def __init__(self, contact, *, emit=None, dry_run=True, proxy=None):
        self.contact = contact
        self.emit = emit or (lambda e: None)
        self.dry_run = dry_run
        self.proxy = proxy

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    _RETRYABLE = ("PerimeterX", "timeout", "ERR_TUNNEL", "ERR_PROXY", "net::",
                  "contact form not found")

    async def enquire(self, listing):
        zpid = str(listing.get("zpid") or "")
        url = listing.get("listing_url")
        last = None
        for attempt in range(3):
            try:
                async with UsSession(proxy=self.proxy, headless=False) as ctx:
                    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
                    await self._warm(page)
                    res = await self._fill(page, zpid, url)
            except Exception as e:
                res = ZillowEnquiryResult(zpid, False, self.dry_run, error=str(e))
            last = res
            if res.ok or res.dry_run:
                return res
            if not any(s in (res.error or "") for s in self._RETRYABLE):
                return res
            self._log(f"{zpid}: {res.error} — retry {attempt+1}/3", "warn")
            await asyncio.sleep(2)
        return last

    async def _warm(self, page):
        try:
            await page.goto("https://www.zillow.com/", wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(2.5)
            await page.evaluate("() => window.scrollTo(0, 500)")
            await asyncio.sleep(1.5)
        except Exception:
            pass

    async def _fill(self, page, zpid, url):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(4)
            if is_perimeterx(await page.title()):
                return ZillowEnquiryResult(zpid, False, self.dry_run, error="PerimeterX blocked")
            # open the "Contact Listing Agent" modal
            try:
                await page.locator("button:has-text('Contact')").first.click(timeout=8000)
            except Exception:
                pass
            try:
                await page.wait_for_selector("input[name='name'], input[name='email']", timeout=10000)
            except PWTimeout:
                shot = await self._shot(page, zpid + "_noform")
                return ZillowEnquiryResult(zpid, False, self.dry_run,
                                           error="contact form not found", screenshot=shot)

            c = self.contact
            await self._set(page, "input[name='name']", c.get("name", ""))
            await self._set(page, "input[name='phone']", c.get("phone", ""))
            await self._set(page, "input[name='email']", c.get("email", ""))
            # message stays as Zillow's default "I am interested in <address>."

            shot = await self._shot(page, "ZIL_" + zpid)
            if self.dry_run:
                self._log(f"DRY RUN {zpid}: filled, not submitted")
                return ZillowEnquiryResult(zpid, True, True, screenshot=shot)

            await page.locator("button:has-text('Contact Agent')").first.click(timeout=8000)
            await asyncio.sleep(3)
            confirmed = await self._confirm(page)
            shot2 = await self._shot(page, "ZIL_" + zpid + "_after")
            return ZillowEnquiryResult(zpid, confirmed, False, screenshot=shot2,
                                       error=None if confirmed else "no confirmation detected")
        except PWTimeout as e:
            return ZillowEnquiryResult(zpid, False, self.dry_run, error=f"timeout: {e}")
        except Exception as e:  # pragma: no cover
            return ZillowEnquiryResult(zpid, False, self.dry_run, error=str(e))

    async def _set(self, page, sel, val):
        if not val:
            return
        try:
            loc = page.locator(sel).first
            if await loc.count():
                await loc.fill(val, timeout=4000)
        except Exception:
            pass

    async def _confirm(self, page):
        try:
            t = (await page.evaluate("() => document.body.innerText") or "").lower()
        except Exception:
            return False
        return any(s in t for s in ("message sent", "your request has been sent",
                                    "we will connect with you", "request has been sent",
                                    "thanks for reaching out", "we'll connect you"))

    async def _shot(self, page, name):
        try:
            SHOTS.mkdir(parents=True, exist_ok=True)
            ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            path = SHOTS / f"{name}-{ts}.png"
            await page.screenshot(path=str(path), full_page=False)
            return str(path)
        except Exception:
            return None
