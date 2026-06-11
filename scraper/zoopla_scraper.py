"""Zoopla scraper — mirrors the Rightmove pipeline (search -> listings ->
floor plans -> potential -> comps -> enquire) for the Zoopla portal.

Key differences from Rightmove (established by live recon 2026-06-11):
  • Zoopla puts listings in the DOM (no PAGE_MODEL / __NEXT_DATA__ blob), so we
    parse search-result cards.
  • Zoopla is behind Cloudflare — it challenges headless browsers, so the
    scraper runs HEADED with real Chrome (channel="chrome").
  • The enquiry form uses reCAPTCHA v2 (solvable via 2captcha), NOT Arkose.

The comps/valuation/enquire layers are portal-agnostic and reused as-is.
"""
import re
import asyncio
import random
import datetime

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

try:
    from playwright_stealth import stealth_async
except Exception:  # pragma: no cover
    stealth_async = None

import zoopla_storage


# ── Pure parsing (unit-tested without a browser) ────────────────────────────
_TYPE_KEYWORDS = [
    ("maisonette", "Maisonette"),
    ("apartment", "Flat"),
    ("flat", "Flat"),
    ("studio", "Studio"),
    ("end of terrace", "Terraced"),
    ("end terrace", "Terraced"),
    ("terraced", "Terraced"),
    ("terrace", "Terraced"),
    ("bungalow", "Bungalow"),          # before detached: "detached bungalow" = Bungalow
    ("semi-detached", "Semi-Detached"),
    ("semi detached", "Semi-Detached"),
    ("detached", "Detached"),
    ("town house", "Terraced"),
    ("townhouse", "Terraced"),
    ("cottage", "Detached"),
    ("mews", "Terraced"),
]


def listing_id_from_url(url):
    """'.../for-sale/details/62846722/...' -> '62846722'."""
    if not url:
        return None
    m = re.search(r"/details/(\d+)", url)
    return m.group(1) if m else None


def parse_price(text):
    """'£180,000\\n\\nSee monthly cost' -> 180000 (int) or None."""
    if not text:
        return None
    m = re.search(r"£\s*([\d,]+)", text)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def parse_int_label(text, *labels):
    """Find the first 'N <label>' in text — e.g. parse_int_label(t,'bed')."""
    if not text:
        return None
    for label in labels:
        m = re.search(r"(\d+)\s*" + label, text, re.I)
        if m:
            return int(m.group(1))
    return None


def parse_property_type(text):
    if not text:
        return None
    low = text.lower()
    for needle, label in _TYPE_KEYWORDS:
        if needle in low:
            return label
    return None


def parse_zoopla_card(card):
    """Normalise a raw search-result card dict into a listing row.

    Input keys: id|url, price, title|address, full_text.
    Output mirrors rm_listings so the comps/valuation/UI layers are reused.
    """
    url = (card.get("url") or "").split("?")[0]
    pid = card.get("id") or listing_id_from_url(url)
    if not pid:
        return None
    text = card.get("full_text") or ""
    price_num = parse_price(card.get("price") or text)
    address = (card.get("title") or card.get("address") or "").strip() or None
    # property type: prefer the card's structured field, fall back to body text
    ptype = parse_property_type(text) or parse_property_type(card.get("price") or "")
    return {
        "property_id": str(pid),
        "source": "zoopla",
        "listing_url": url or f"https://www.zoopla.co.uk/for-sale/details/{pid}/",
        "price": f"£{price_num:,}" if price_num else (card.get("price") or "").split("\n")[0].strip() or None,
        "price_qualifier": None,
        "address": address,
        "bedrooms": parse_int_label(text, "beds?", "bedrooms?"),
        "bathrooms": parse_int_label(text, "baths?", "bathrooms?"),
        "receptions": parse_int_label(text, "receptions?", "living"),
        "property_type": ptype,
    }


# JS that extracts the cards from a loaded Zoopla search page. Kept here so the
# selector strategy lives next to the parser it feeds.
SEARCH_CARDS_JS = r"""
() => {
  const out = [];
  const anchors = [...document.querySelectorAll('a[href*="/for-sale/details/"]')];
  const seen = new Set();
  for (const a of anchors) {
    const m = a.href.match(/details\/(\d+)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    let card = a;
    for (let i = 0; i < 6; i++) { if (card.parentElement) card = card.parentElement; }
    const pick = (...sels) => { for (const s of sels) { const e = card.querySelector(s); if (e && e.innerText) return e.innerText.trim(); } return null; };
    out.push({
      id: m[1],
      url: a.href.split('?')[0],
      price: pick('[data-testid="listing-price"]', '[class*="price" i]'),
      title: pick('[data-testid="listing-title"]', 'h2', 'address'),
      full_text: (card.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    });
  }
  return out;
}
"""


def is_cloudflare(title):
    return "just a moment" in (title or "").lower() or "moment..." in (title or "").lower()


class ZooplaScraper:
    """Headed real-Chrome scraper: search URLs -> Zoopla listings -> storage."""

    def __init__(self, emit, stop_event, pause_event, *, max_pages=40,
                 delay_min=2.0, delay_max=5.0, user_data_dir="data/zoopla_profile"):
        self.emit = emit
        self.stop = stop_event
        self.pause = pause_event
        self.max_pages = max_pages
        self.delay_min = float(delay_min)
        self.delay_max = float(delay_max)
        self.user_data_dir = user_data_dir
        self.metrics = {"urls_done": 0, "urls_total": 0, "new": 0, "duplicates": 0,
                        "pages": 0, "current_url": ""}

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    def _push(self):
        self.emit({"type": "zoopla_metrics", **self.metrics})

    async def _sleep(self):
        await asyncio.sleep(random.uniform(self.delay_min, self.delay_max))

    async def _wait_unpaused(self):
        while self.pause.is_set() and not self.stop.is_set():
            await asyncio.sleep(0.3)

    async def _wait_cloudflare(self, page, tries=12):
        for _ in range(tries):
            if not is_cloudflare(await page.title()):
                return True
            await asyncio.sleep(2)
        return not is_cloudflare(await page.title())

    def _paged_url(self, search_url, n):
        if n <= 1:
            return search_url
        sep = "&" if "?" in search_url else "?"
        return f"{search_url}{sep}pn={n}"

    async def run(self, search_urls, force_rescrape=False):
        session_id = zoopla_storage.create_session(search_urls)
        self.metrics["urls_total"] = len(search_urls)
        self._push()
        async with async_playwright() as pw:
            ctx = await pw.chromium.launch_persistent_context(
                self.user_data_dir, channel="chrome", headless=False,
                no_viewport=True,
                args=["--disable-blink-features=AutomationControlled"])
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            if stealth_async:
                try:
                    await stealth_async(page)
                except Exception:
                    pass
            try:
                for i, search_url in enumerate(search_urls):
                    if self.stop.is_set():
                        break
                    search_url = (search_url or "").strip()
                    if not search_url:
                        continue
                    self.metrics["current_url"] = search_url
                    count = await self._scrape_search(page, search_url, session_id)
                    self.metrics["urls_done"] = i + 1
                    self._push()
                    self._log(f"Done {i+1}/{len(search_urls)}: {count} new listings")
                    if i < len(search_urls) - 1:
                        await self._sleep()
            finally:
                await ctx.close()
        zoopla_storage.finish_session(session_id)
        self.emit({"type": "zoopla_done"})

    async def _scrape_search(self, page, search_url, session_id):
        total_new = 0
        for n in range(1, self.max_pages + 1):
            if self.stop.is_set():
                break
            await self._wait_unpaused()
            url = self._paged_url(search_url, n)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            except PWTimeout:
                self._log(f"timeout loading page {n}", "warn")
                break
            await asyncio.sleep(2)
            if not await self._wait_cloudflare(page):
                self._log("Cloudflare challenge did not clear — stopping", "warn")
                break
            await self._dismiss_cookies(page)
            raw_cards = await page.evaluate(SEARCH_CARDS_JS)
            if not raw_cards:
                break  # no more results
            new_here = 0
            for raw in raw_cards:
                row = parse_zoopla_card(raw)
                if not row:
                    continue
                if zoopla_storage.upsert_listing(row, search_url):
                    new_here += 1
            total_new += new_here
            self.metrics["pages"] += 1
            self.metrics["new"] += new_here
            self._push()
            self._log(f"Page {n}: {len(raw_cards)} cards, {new_here} new")
            await self._sleep()
        return total_new

    async def _dismiss_cookies(self, page):
        try:
            btn = page.locator("#onetrust-accept-btn-handler, button:has-text('Accept')").first
            if await btn.count():
                await btn.first.click(timeout=4000)
                await asyncio.sleep(0.5)
        except Exception:
            pass
