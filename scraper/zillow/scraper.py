"""Zillow scraper — search -> listings, detail -> agent + phone.

PerimeterX ("Press & Hold") guards Zillow's detail pages. Beaten with
patchright (undetected Chrome) + a US residential IP (iProyal country-us) +
real Chrome channel. Verified live: detail pages load clean, agent + phone
exposed ("Listed by: Lindsay Neuren (512) 913-6987, Compass RE Texas").

The lead is the AGENT. We dedup to one listing per agent and enquire as a
buyer to trigger a callback (then Elsie pitches the AI receptionist).
"""
import re
import asyncio
import random
import datetime
import tempfile
import shutil

from patchright.async_api import async_playwright

from . import storage


# ── Pure parsing (unit-tested, no browser) ──────────────────────────────────
def zpid_from_url(url):
    if not url:
        return None
    m = re.search(r"/(\d+)_zpid", url)
    return m.group(1) if m else None


def parse_price(text):
    if not text:
        return None
    m = re.search(r"\$\s*([\d,]+)", text)
    return int(m.group(1).replace(",", "")) if m else None


def parse_int(text, *labels):
    if not text:
        return None
    for lab in labels:
        m = re.search(r"([\d,]+)\s*" + lab, text, re.I)
        if m:
            return int(m.group(1).replace(",", ""))
    return None


def parse_baths(text):
    if not text:
        return None
    # Zillow crams "2 ba1,900 sqft" (no boundary), also "2.5 ba", "2 baths".
    m = re.search(r"([\d.]+)\s*ba(?:ths?)?(?=\d|\s|,|\)|$)", text, re.I)
    return float(m.group(1)) if m else None


def agent_key(name):
    """Normalised key for dedup/blacklist (name OR phone keeps agents distinct)."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower()) or None


def phone_key(phone):
    digits = re.sub(r"\D", "", phone or "")
    return digits or None


def parse_listed_by(text):
    """'Listed by: Lindsay Neuren (512) 913-6987, Compass RE Texas, LLC' ->
    (name, phone, brokerage)."""
    if not text:
        return None, None, None
    m = re.search(r"listed by[:\s]+(.+)", text, re.I)
    seg = (m.group(1) if m else text).strip()
    phone_m = re.search(r"(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})", seg)
    phone = phone_m.group(1) if phone_m else None
    # name is what precedes the phone; brokerage is what follows it
    name, brokerage = None, None
    if phone:
        before = seg[:seg.index(phone)].strip(" ,")
        after = seg[seg.index(phone) + len(phone):].strip(" ,")
        name = before or None
        brokerage = (after.split("\n")[0].strip(" ,") or None)
    else:
        name = seg.split(",")[0].strip() or None
    return name, phone, brokerage


def parse_search_card(card):
    """A search-result card -> base listing row (agent filled later from detail)."""
    url = (card.get("url") or "").split("?")[0]
    zpid = card.get("zpid") or zpid_from_url(url)
    if not zpid:
        return None
    text = card.get("full_text") or ""
    price_num = parse_price(card.get("price") or text)
    brokerage = (card.get("brokerage") or "").strip() or None
    return {
        "zpid": str(zpid),
        "listing_url": url,
        "price": f"${price_num:,}" if price_num else None,
        "price_num": price_num,
        "address": (card.get("address") or "").strip() or None,
        "beds": parse_int(text, "bds", "bd", "beds?"),
        "baths": parse_baths(text),
        "sqft": parse_int(text, "sqft"),
        "brokerage": brokerage,
        "agent_name": None, "agent_phone": None, "agent_key": None,
    }


def is_perimeterx(title, body=""):
    t = (title or "").lower() + " " + (body or "").lower()
    return ("access to this page has been denied" in t or "press & hold" in t
            or "press and hold" in t)


SEARCH_CARDS_JS = r"""
() => {
  const out = []; const seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/homedetails/"]')) {
    const m = a.href.match(/(\d+)_zpid/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    let card = a;
    for (let i = 0; i < 6; i++) { if (card.parentElement) card = card.parentElement; }
    const txt = card.innerText || '';
    // brokerage is the all-caps line near the bottom of a card
    const bro = (txt.match(/\n([A-Z][A-Z0-9 &.,'-]{4,40}(?:LLC|INC|REALTY|GROUP|RE|HOMES|PROPERTIES|REAL ESTATE)[A-Z0-9 &.,'-]*)/) || ['',''])[1];
    out.push({
      zpid: m[1], url: a.href.split('?')[0],
      price: (txt.match(/\$[\d,]+/) || [''])[0],
      address: (txt.match(/\d[^,\n]*,[^,\n]*,\s*[A-Z]{2}\s*\d{5}/) || [''])[0].trim(),
      brokerage: (bro || '').trim(),
      full_text: txt.replace(/\s+/g, ' ').slice(0, 220),
    });
  }
  return out;
}
"""

DETAIL_AGENT_JS = r"""
() => {
  const t = document.body.innerText || '';
  const m = t.match(/Listed by[\s\S]{0,90}/i);
  return { listed_by: m ? m[0].replace(/\s+/g, ' ').slice(0, 90) : null };
}
"""


class UsSession:
    """patchright + real Chrome + US residential IP — beats PerimeterX. Throwaway
    profile per run (auto-deleted)."""
    def __init__(self, proxy=None, headless=False):
        self.proxy = proxy
        self.headless = headless
        self._dir = None
        self._pw = None
        self.ctx = None

    async def __aenter__(self):
        self._dir = tempfile.mkdtemp(prefix="zillow_sess_")
        self._pw = await async_playwright().start()
        kw = dict(channel="chrome", headless=self.headless, no_viewport=True)
        if self.proxy:
            kw["proxy"] = self.proxy
        self.ctx = await self._pw.chromium.launch_persistent_context(self._dir, **kw)
        return self.ctx

    async def __aexit__(self, *exc):
        try:
            if self.ctx:
                await self.ctx.close()
        finally:
            if self._pw:
                await self._pw.stop()
            if self._dir:
                shutil.rmtree(self._dir, ignore_errors=True)


class ZillowScraper:
    def __init__(self, emit, stop_event, pause_event, *, max_pages=20,
                 delay_min=3.0, delay_max=6.0, proxy=None, fetch_agents=True):
        self.emit = emit
        self.stop = stop_event
        self.pause = pause_event
        self.max_pages = max_pages
        self.delay_min = float(delay_min)
        self.delay_max = float(delay_max)
        self.proxy = proxy
        self.fetch_agents = fetch_agents
        self.metrics = {"urls_done": 0, "urls_total": 0, "new": 0, "agents": 0, "current": ""}

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    def _push(self):
        self.emit({"type": "zillow_metrics", **self.metrics})

    async def _sleep(self):
        await asyncio.sleep(random.uniform(self.delay_min, self.delay_max))

    async def _warm(self, page):
        # PerimeterX is behavioural — land on the homepage, scroll, settle first.
        try:
            await page.goto("https://www.zillow.com/", wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(2.5)
            await page.evaluate("() => window.scrollTo(0, 500)")
            await asyncio.sleep(1.5)
        except Exception:
            pass

    def _paged(self, url, n):
        if n <= 1:
            return url
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}p={n}"

    async def run(self, search_urls):
        sid = storage.create_session(search_urls)
        self.metrics["urls_total"] = len(search_urls)
        self._push()
        async with UsSession(proxy=self.proxy, headless=False) as ctx:
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            await self._warm(page)
            for i, url in enumerate(search_urls):
                if self.stop.is_set():
                    break
                url = (url or "").strip()
                if not url:
                    continue
                self.metrics["current"] = url
                await self._scrape_search(page, url, sid)
                self.metrics["urls_done"] = i + 1
                self._push()
                if i < len(search_urls) - 1:
                    await self._sleep()
            if self.fetch_agents and not self.stop.is_set():
                await self._fetch_agents(page)
        storage.finish_session(sid)
        self.emit({"type": "zillow_done"})

    async def _scrape_search(self, page, url, sid):
        for n in range(1, self.max_pages + 1):
            if self.stop.is_set():
                break
            while self.pause.is_set() and not self.stop.is_set():
                await asyncio.sleep(0.3)
            try:
                await page.goto(self._paged(url, n), wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                self._log(f"page {n} load error: {str(e)[:60]}", "warn")
                break
            await asyncio.sleep(3)
            if is_perimeterx(await page.title()):
                self._log("PerimeterX on search — stopping", "warn")
                break
            cards = await page.evaluate(SEARCH_CARDS_JS)
            if not cards:
                break
            new_here = 0
            for raw in cards:
                row = parse_search_card(raw)
                if row and storage.upsert_listing(row, url):
                    new_here += 1
            self.metrics["new"] += new_here
            self._push()
            self._log(f"Page {n}: {len(cards)} listings, {new_here} new")
            await self._sleep()

    async def _fetch_agents(self, page):
        """Visit each agent-less listing's detail page (patchright passes PX) to
        grab the agent name + phone."""
        todo = storage.listings_without_agent(limit=120)
        self._log(f"Fetching agent + phone for {len(todo)} listings…")
        for i, l in enumerate(todo):
            if self.stop.is_set():
                break
            while self.pause.is_set() and not self.stop.is_set():
                await asyncio.sleep(0.3)
            try:
                await page.goto(l["listing_url"], wait_until="domcontentloaded", timeout=45000)
                await asyncio.sleep(3)
                if is_perimeterx(await page.title()):
                    self._log(f"PerimeterX on {l['zpid']} — skipping", "warn")
                    await self._sleep()
                    continue
                info = await page.evaluate(DETAIL_AGENT_JS)
                name, phone, brokerage = parse_listed_by(info.get("listed_by"))
                key = agent_key(name) or phone_key(phone)
                if key:
                    storage.update_agent(l["zpid"], name, phone, key)
                    self.metrics["agents"] += 1
                    self._log(f"{l['zpid']}: {name or '?'} {phone or ''}")
            except Exception as e:
                self._log(f"{l['zpid']}: {str(e)[:60]}", "warn")
            self._push()
            if i < len(todo) - 1:
                await self._sleep()
