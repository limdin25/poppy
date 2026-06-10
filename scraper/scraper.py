"""Playwright Google Maps scraper: search, scroll, parse cards."""
import asyncio, random, re, time, datetime, urllib.parse
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

try:
    from playwright_stealth import stealth_async
except Exception:  # pragma: no cover
    stealth_async = None

import storage

CARD_SELECTOR = "a.hfpxzc, div[role='feed'] a[href*='/maps/place/']"
FEED_SELECTOR = "div[role='feed']"
END_SENTINEL = "You've reached the end of the list"


class Scraper:
    def __init__(self, proxy_mgr, emit, stop_event, pause_event,
                 max_per_query=50, delay_min=2.0, delay_max=5.0,
                 headless=True, full_details=True):
        self.proxy = proxy_mgr
        self.emit = emit
        self.stop = stop_event
        self.pause = pause_event
        self.max_per_query = max_per_query
        self.delay_min = float(delay_min)
        self.delay_max = float(delay_max)
        self.headless = headless
        self.full_details = full_details
        self.metrics = {
            "pages": 0, "new": 0, "duplicates": 0, "errors": 0,
            "current_query": "", "current_proxy": proxy_mgr.label,
            "queries_done": 0, "queries_total": 0, "started_at": None,
        }

    # ---------- helpers ----------
    async def _sleep(self):
        await asyncio.sleep(random.uniform(self.delay_min, self.delay_max))

    async def _wait_unpaused(self):
        while self.pause.is_set() and not self.stop.is_set():
            await asyncio.sleep(0.3)

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    def _push_metrics(self):
        self.metrics["current_proxy"] = self.proxy.label
        self.emit({"type": "metrics", **self.metrics})

    # ---------- browser lifecycle ----------
    async def _new_context(self, pw, browser):
        # Proxy is now at launch level (see _launch). No context-level proxy.
        ctx = await browser.new_context(
            viewport={"width": 1366, "height": 900},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"),
            locale="en-GB",
            ignore_https_errors=True,
        )
        # Pre-seed Google's consent cookies so the EU consent page never
        # redirects us. Same cookies a real user would have after clicking
        # through once.
        await ctx.add_cookies([
            {"name": "SOCS",    "value": "CAESHAgBEhJnd3NfMjAyMzExMjEtMF9SQzIaAmVuIAEaBgiA_LyqBg",
             "domain": ".google.com", "path": "/"},
            {"name": "CONSENT", "value": "YES+",
             "domain": ".google.com", "path": "/"},
        ])
        # Hide the webdriver flag at navigator level (lightweight stealth).
        await ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )
        ctx.set_default_navigation_timeout(120_000)
        ctx.set_default_timeout(30_000)
        page = await ctx.new_page()
        if stealth_async:
            try:
                await stealth_async(page)
            except Exception:
                pass
        return ctx, page

    async def _launch(self, pw):
        kwargs = dict(
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-default-browser-check",
                "--no-first-run",
                "--disable-background-networking",
                # Force HTTP/1.1: residential proxies often can't tunnel h2 to
                # google.com cleanly — the TLS handshake completes but h2 frames
                # silently disappear. curl works because it negotiates http/1.1.
                "--disable-http2",
            ],
        )
        proxy_arg = self.proxy.playwright_proxy()
        if proxy_arg:
            kwargs["proxy"] = proxy_arg
            u = proxy_arg.get("username", "") or ""
            p = proxy_arg.get("password", "") or ""
            mask = f"{u[:3]}***:{p[:3]}***" if u else "(no auth)"
            self._log(f"Launch proxy: {self.proxy.label}  auth={mask}")
        return await pw.chromium.launch(**kwargs)

    # ---------- captcha / consent ----------
    async def _is_blocked(self, page) -> bool:
        url = page.url or ""
        if "/sorry/" in url or "consent.google" in url:
            return True
        try:
            html = (await page.content()).lower()
        except Exception:
            return False
        return ("recaptcha" in html) or ("unusual traffic" in html)

    async def _dismiss_consent(self, page):
        for sel in ['button:has-text("Accept all")', 'button:has-text("Reject all")',
                    'button[aria-label*="Accept"]', 'button[aria-label*="Reject"]',
                    'form[action*="consent"] button']:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1500):
                    await btn.click()
                    await asyncio.sleep(1.0)
                    return
            except Exception:
                continue

    # ---------- core scrape ----------
    async def _scroll_feed(self, page):
        """Scroll left panel until end-sentinel or no growth."""
        prev = 0
        stable = 0
        for _ in range(80):
            if self.stop.is_set():
                return
            await self._wait_unpaused()
            try:
                cards = await page.locator(CARD_SELECTOR).count()
            except Exception:
                cards = 0
            if cards >= self.max_per_query:
                return
            try:
                end_visible = await page.locator(f"text={END_SENTINEL}").count()
                if end_visible:
                    return
            except Exception:
                pass
            # scroll the feed div
            try:
                await page.evaluate(
                    "(sel) => { const el = document.querySelector(sel); if (el) el.scrollTop = el.scrollHeight; }",
                    FEED_SELECTOR)
            except Exception:
                pass
            await asyncio.sleep(random.uniform(1.2, 2.2))
            if cards == prev:
                stable += 1
                if stable >= 4:
                    return
            else:
                stable = 0
            prev = cards

    async def _parse_card_listview(self, card) -> dict:
        """Extract everything we can from the list-view card (no click needed).
        Selectors verified against current Google Maps DOM (Apr 2026)."""
        out = {"name": "", "rating": None, "reviews_count": None, "category": "",
               "address": "", "status": "", "phone": "", "website": "", "maps_url": ""}

        # Walk up to the role=article container that holds the surrounding meta.
        try:
            article = card.locator("xpath=ancestor::div[@role='article'][1]")
            if not await article.count():
                article = card
        except Exception:
            article = card

        # Canonical URL
        try:
            out["maps_url"] = (await card.get_attribute("href")) or ""
        except Exception:
            pass

        # Name — prefer rendered text, fall back to aria-label.
        try:
            n = article.locator(".qBF1Pd").first
            if await n.count():
                out["name"] = (await n.inner_text(timeout=1500)).strip()
        except Exception:
            pass
        if not out["name"]:
            try:
                lbl = await card.get_attribute("aria-label")
                if lbl:
                    out["name"] = lbl.strip()
            except Exception:
                pass

        # Rating + reviews from aria-label like "4.8 stars 424 Reviews"
        try:
            rating_el = article.locator('span[role="img"][aria-label*="star"]').first
            if await rating_el.count():
                lbl = (await rating_el.get_attribute("aria-label")) or ""
                m = re.search(r"([\d.]+)\s*star", lbl, re.I)
                if m:
                    try: out["rating"] = float(m.group(1))
                    except Exception: pass
                m2 = re.search(r"([\d,]+)\s*Review", lbl, re.I)
                if m2:
                    try: out["reviews_count"] = int(m2.group(1).replace(",", ""))
                    except Exception: pass
        except Exception:
            pass
        # Direct fallback: the "(424)" span has class .UY7F9 — most reliable.
        if out["reviews_count"] is None:
            try:
                rv = article.locator(".UY7F9").first
                if await rv.count():
                    txt = (await rv.inner_text(timeout=800)).strip()
                    m3 = re.search(r"([\d,]+)", txt)
                    if m3:
                        out["reviews_count"] = int(m3.group(1).replace(",", ""))
            except Exception:
                pass
        # Same for rating: the .MW4etd span has the bare number.
        if out["rating"] is None:
            try:
                rt = article.locator(".MW4etd").first
                if await rt.count():
                    txt = (await rt.inner_text(timeout=800)).strip()
                    m4 = re.search(r"([\d.]+)", txt)
                    if m4:
                        out["rating"] = float(m4.group(1))
            except Exception:
                pass

        # Phone
        try:
            ph = article.locator(".UsdlK").first
            if await ph.count():
                out["phone"] = (await ph.inner_text(timeout=1000)).strip()
        except Exception:
            pass

        # Website (real external href)
        try:
            a = article.locator('a[data-value="Website"]').first
            if await a.count():
                href = await a.get_attribute("href")
                if href:
                    out["website"] = href
        except Exception:
            pass

        # Category + address + status from the two nested .W4Efsd rows.
        # Row 1 ("Plumber · Suite 94, 792 Wilmslow Rd")  → category + (sometimes) address
        # Row 2 ("Closed · Opens 8 AM Mon · +44 ...")    → status (phone is grabbed elsewhere)
        try:
            rows = article.locator(".W4Efsd .W4Efsd")
            count = await rows.count()
            for i in range(count):
                txt = (await rows.nth(i).inner_text(timeout=800)).strip()
                if not txt:
                    continue
                has_status = any(k in txt for k in
                                 ("Open 24 hours", "Closes", "Opens", "Closed", "Open"))
                if has_status:
                    m = re.search(
                        r"(Open 24 hours|Open[^·\n]*|Closed[^·\n]*|Closes[^·\n]*|Opens[^·\n]*)", txt)
                    if m and not out["status"]:
                        out["status"] = m.group(1).strip().rstrip("·").strip()
                else:
                    parts = [p.strip() for p in txt.split("·") if p.strip()]
                    if parts and not out["category"]:
                        out["category"] = parts[0]
                    if len(parts) >= 2 and not out["address"]:
                        # Anything after the first · is the address (rejoin in the rare
                        # case it contains its own ·).
                        out["address"] = " · ".join(parts[1:])
        except Exception:
            pass

        return out

    async def _enrich_via_panel(self, page, card, lead: dict):
        """Click card, read side panel for phone/website/address/category/rating/etc."""
        prev_url = page.url
        try:
            await card.click()
        except Exception:
            try:
                await card.click(force=True)
            except Exception:
                return
        # Wait for the URL to change to a new /maps/place/... so we know the panel reloaded.
        try:
            await page.wait_for_function(
                """(prev) => location.href.includes('/maps/place/') && location.href !== prev""",
                arg=prev_url, timeout=8000,
            )
        except PWTimeout:
            pass
        # Wait for the new h1 to actually render in the place panel.
        try:
            await page.wait_for_selector('h1.DUwDvf, h1[class*="DUwDvf"], div[role="main"] h1', timeout=8000)
        except PWTimeout:
            return
        await asyncio.sleep(random.uniform(0.6, 1.2))

        async def text_of(selector, attr=None):
            try:
                el = page.locator(selector).first
                if not await el.count():
                    return ""
                if attr:
                    v = await el.get_attribute(attr)
                    return (v or "").strip()
                return (await el.inner_text(timeout=1500)).strip()
            except Exception:
                return ""

        # Name (don't overwrite if list-view already had it)
        if not lead.get("name"):
            name = await text_of('h1.DUwDvf, h1[class*="DUwDvf"], div[role="main"] h1')
            if name:
                lead["name"] = name

        # Category fallback
        if not lead.get("category"):
            cat = (await text_of('button.DkEaL')
                   or await text_of('div[jsaction*="category"] button')
                   or await text_of('button[jsaction*="category"]'))
            if cat:
                lead["category"] = cat

        # Address — give the panel up to 5s to render the address row.
        try:
            await page.wait_for_selector(
                'button[data-item-id="address"], button[aria-label^="Address:"], '
                'button[aria-label*="Address" i], [data-tooltip="Copy address"]',
                timeout=5000)
        except PWTimeout:
            pass
        addr = (await text_of('button[data-item-id="address"]', attr="aria-label")
                or await text_of('button[aria-label^="Address:"]', attr="aria-label")
                or await text_of('button[aria-label*="Address" i]', attr="aria-label")
                or await text_of('button[data-item-id="address"] .Io6YTe')   # visible address text
                or await text_of('[data-tooltip="Copy address"]', attr="aria-label"))
        if addr:
            lead["address"] = re.sub(r"^Address:\s*", "", addr).strip()

        # Phone fallback
        if not lead.get("phone"):
            phone = await text_of('button[data-item-id^="phone:tel:"]', attr="aria-label")
            if not phone:
                phone = await text_of('button[aria-label^="Phone:"]', attr="aria-label")
            if phone:
                lead["phone"] = re.sub(r"^Phone:\s*", "", phone).strip()

        # Website fallback
        if not lead.get("website"):
            try:
                a = page.locator('a[data-item-id="authority"]').first
                if await a.count():
                    href = await a.get_attribute("href")
                    if href:
                        lead["website"] = href
                    else:
                        lead["website"] = (await a.inner_text(timeout=1500)).strip()
            except Exception:
                pass

        # Rating + reviews count — only if list view didn't already capture them.
        if lead.get("rating") is None or lead.get("reviews_count") is None:
            try:
                block = page.locator('div.F7nice, div[role="img"][aria-label*="star"]').first
                label_text = ""
                if await block.count():
                    label_text = (await block.get_attribute("aria-label")) or (await block.inner_text(timeout=1500))
                m = re.search(r"(\d\.\d)", label_text or "")
                if m and lead.get("rating") is None:
                    lead["rating"] = float(m.group(1))
                m2 = re.search(r"\(([\d,]+)\)", label_text or "") or \
                     re.search(r"([\d,]+)\s*review", (label_text or "").lower())
                if m2 and lead.get("reviews_count") is None:
                    lead["reviews_count"] = int(m2.group(1).replace(",", ""))
            except Exception:
                pass

        # Hours / status string
        try:
            for sel in ['div[aria-label*="Hours"] span:has-text("Open")',
                        'div[aria-label*="Hours"] span:has-text("Closed")',
                        'span:has-text("Closes")', 'span:has-text("Opens")',
                        'span:has-text("Open 24 hours")']:
                el = page.locator(sel).first
                if await el.count():
                    txt = (await el.inner_text(timeout=1000)).strip().splitlines()[0]
                    if txt:
                        lead["status"] = txt
                        break
        except Exception:
            pass

        # Canonical URL
        try:
            url = page.url
            if "/maps/place/" in url:
                lead["maps_url"] = url
        except Exception:
            pass

    async def _scrape_query(self, page, keyword: str, location: str, session_id: int):
        q = f"{keyword} {location}".strip()
        url = f"https://www.google.com/maps/search/{urllib.parse.quote_plus(q)}/"
        self.metrics["current_query"] = q
        self._push_metrics()
        self._log(f"GET {url}")
        try:
            # domcontentloaded survives the consent/region redirect that
            # would otherwise abort a 'commit' navigation.
            await page.goto(url, wait_until="domcontentloaded", timeout=120_000)
            self._log(f"…DOM loaded (page.url = {page.url})")
        except PWTimeout:
            self._log("Navigation timeout — proxy may be too slow or blocked. "
                      "Try direct (no proxy) or rotate.", "error")
            return "error"
        except Exception as e:
            msg = str(e)
            if "ERR_ABORTED" in msg or "Navigation interrupted" in msg or "frame was detached" in msg:
                self._log(f"goto interrupted (likely redirect) — continuing")
            else:
                self._log(f"Navigation error: {type(e).__name__}: {e}", "error")
                return "error"
        await self._dismiss_consent(page)
        if await self._is_blocked(page):
            return "blocked"
        try:
            await page.wait_for_selector(CARD_SELECTOR, timeout=30_000)
        except PWTimeout:
            self._log(f"No results panel appeared (URL: {page.url})", "warn")
            return "empty"

        await self._scroll_feed(page)
        cards = page.locator(CARD_SELECTOR)
        n = min(await cards.count(), self.max_per_query)
        self._log(f"Found {n} cards for: {q}")
        new_count = 0
        for i in range(n):
            if self.stop.is_set():
                break
            await self._wait_unpaused()
            card = cards.nth(i)
            try:
                lead = await self._parse_card_listview(card)
                if self.full_details:
                    await self._enrich_via_panel(page, card, lead)
                    await self._sleep()
                lead.update({
                    "keyword": keyword, "location": location,
                    "session_id": session_id,
                    "scraped_at": datetime.datetime.now().isoformat(timespec="seconds"),
                })
                if not lead.get("name"):
                    continue
                inserted = storage.insert_lead(lead)
                if inserted:
                    self.metrics["new"] += 1
                    new_count += 1
                    self.emit({"type": "lead", "lead": lead})
                else:
                    self.metrics["duplicates"] += 1
                self._push_metrics()
                # rotate proxy on schedule
                if self.proxy.tick():
                    self._log(f"Rotated proxy → {self.proxy.label}")
            except Exception as e:
                self.metrics["errors"] += 1
                self._log(f"card error: {e}", "error")
        self.metrics["pages"] += 1
        storage.mark_query_scraped(keyword, location, new_count)
        return "ok"

    # ---------- main loop ----------
    async def run(self, jobs, force_rescrape=False):
        storage.init_db()
        # Filter already-scraped queries
        if not force_rescrape:
            jobs = [(k, l) for (k, l) in jobs if not storage.is_query_scraped(k, l)]
        self.metrics["queries_total"] = len(jobs)
        self.metrics["started_at"] = time.time()
        if not jobs:
            self._log("Nothing to do — all queries already scraped (toggle force re-scrape).", "warn")
            self.emit({"type": "done"})
            return

        session_id = storage.start_session()
        storage.update_session(session_id, queries_total=len(jobs))
        self._log(f"Session {session_id} started — {len(jobs)} queries.")

        self._log("Launching Chromium…")
        async with async_playwright() as pw:
            try:
                browser = await self._launch(pw)
            except Exception as e:
                self._log(f"Browser launch FAILED: {type(e).__name__}: {e}", "error")
                self._log("Hint: did you run `python -m playwright install chromium`?", "warn")
                storage.end_session(session_id)
                self.emit({"type": "done", "session_id": session_id})
                return
            ctx, page = await self._new_context(pw, browser)
            self._log("Browser ready.")
            try:
                for keyword, location in jobs:
                    if self.stop.is_set():
                        break
                    await self._wait_unpaused()
                    try:
                        status = await self._scrape_query(page, keyword, location, session_id)
                    except Exception as e:
                        self.metrics["errors"] += 1
                        self._log(f"query '{keyword} / {location}' raised: {type(e).__name__}: {e}", "error")
                        status = "error"

                    if status == "blocked":
                        self._log("Block/CAPTCHA detected — rotating proxy and retrying once", "warn")
                        self.proxy.rotate()
                        try:
                            await ctx.close(); await browser.close()
                        except Exception:
                            pass
                        try:
                            browser = await self._launch(pw)
                            ctx, page = await self._new_context(pw, browser)
                            status = await self._scrape_query(page, keyword, location, session_id)
                        except Exception as e:
                            self._log(f"retry failed: {type(e).__name__}: {e}", "error")
                            status = "error"
                        if status == "blocked":
                            self.emit({"type": "captcha"})
                            self._log("CAPTCHA — rotating proxies / solve manually & resume.", "error")
                            self.pause.set()
                            while self.pause.is_set() and not self.stop.is_set():
                                await asyncio.sleep(0.5)

                    self.metrics["queries_done"] += 1
                    storage.update_session(session_id,
                                           leads_new=self.metrics["new"],
                                           duplicates=self.metrics["duplicates"],
                                           errors=self.metrics["errors"])
                    self._push_metrics()
                    await self._sleep()
            finally:
                try:
                    await ctx.close()
                except Exception:
                    pass
                try:
                    await browser.close()
                except Exception:
                    pass
                storage.end_session(session_id)
                self.emit({"type": "done", "session_id": session_id})
                self._log(f"Session {session_id} ended.")
