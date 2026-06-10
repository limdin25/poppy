"""Playwright Facebook Ad Library scraper: search, scroll, parse ad cards."""
from __future__ import annotations
import asyncio, random, re, time, datetime, urllib.parse
from typing import List, Dict, Tuple
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

try:
    from playwright_stealth import stealth_async
except Exception:
    stealth_async = None

import facebook_storage

COUNTRIES = {
    "GB": "United Kingdom", "US": "United States", "BR": "Brazil",
    "DE": "Germany", "FR": "France", "ES": "Spain", "IT": "Italy",
    "PT": "Portugal", "NL": "Netherlands", "AU": "Australia",
    "CA": "Canada", "IN": "India", "MX": "Mexico", "AR": "Argentina",
    "CO": "Colombia", "CL": "Chile", "PE": "Peru", "PH": "Philippines",
    "NG": "Nigeria", "ZA": "South Africa", "KE": "Kenya", "GH": "Ghana",
    "AE": "United Arab Emirates", "SA": "Saudi Arabia", "EG": "Egypt",
    "PK": "Pakistan", "BD": "Bangladesh", "ID": "Indonesia",
    "MY": "Malaysia", "SG": "Singapore", "TH": "Thailand",
    "VN": "Vietnam", "JP": "Japan", "KR": "South Korea",
    "PL": "Poland", "SE": "Sweden", "NO": "Norway", "DK": "Denmark",
    "FI": "Finland", "IE": "Ireland", "AT": "Austria", "CH": "Switzerland",
    "BE": "Belgium", "CZ": "Czech Republic", "RO": "Romania",
    "HU": "Hungary", "GR": "Greece", "TR": "Turkey",
    "IL": "Israel", "NZ": "New Zealand",
    "ALL": "All countries",
}


class FacebookScraper:
    def __init__(self, proxy_mgr, emit, stop_event, pause_event,
                 max_results=100, delay_min=2.0, delay_max=5.0,
                 headless=True):
        self.proxy = proxy_mgr
        self.emit = emit
        self.stop = stop_event
        self.pause = pause_event
        self.max_results = max_results
        self.delay_min = float(delay_min)
        self.delay_max = float(delay_max)
        self.headless = headless
        self.metrics = {
            "pages": 0, "new": 0, "duplicates": 0, "errors": 0,
            "current_query": "", "current_proxy": proxy_mgr.label,
            "queries_done": 0, "queries_total": 0, "started_at": None,
        }

    async def _sleep(self, lo=None, hi=None):
        await asyncio.sleep(random.uniform(lo or self.delay_min, hi or self.delay_max))

    async def _wait_unpaused(self):
        while self.pause.is_set() and not self.stop.is_set():
            await asyncio.sleep(0.3)

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    def _push_metrics(self):
        self.metrics["current_proxy"] = self.proxy.label
        self.emit({"type": "fb_metrics", **self.metrics})

    async def _launch(self, pw):
        kwargs = dict(
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-default-browser-check",
                "--no-first-run",
                "--disable-background-networking",
                "--disable-http2",
            ],
        )
        proxy_arg = self.proxy.playwright_proxy()
        if proxy_arg:
            kwargs["proxy"] = proxy_arg
            self._log(f"Launch proxy: {self.proxy.label}")
        return await pw.chromium.launch(**kwargs)

    async def _new_context(self, pw, browser):
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"),
            locale="en-GB",
            ignore_https_errors=True,
        )
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

    def _build_url(self, keyword: str, country: str) -> str:
        params = {
            "active_status": "active",
            "ad_type": "all",
            "country": country,
            "is_targeted_country": "false",
            "media_type": "all",
            "q": keyword,
            "search_type": "keyword_unordered",
            "sort_data[direction]": "desc",
            "sort_data[mode]": "total_impressions",
        }
        return "https://www.facebook.com/ads/library/?" + urllib.parse.urlencode(params)

    async def _dismiss_cookie_banner(self, page):
        for sel in [
            'button[data-cookiebanner="accept_button"]',
            'button:has-text("Allow all cookies")',
            'button:has-text("Accept all")',
            'button:has-text("Allow essential and optional cookies")',
            'button[title="Allow all cookies"]',
        ]:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=2000):
                    await btn.click()
                    await asyncio.sleep(1.0)
                    self._log("Dismissed cookie banner")
                    return
            except Exception:
                continue

    async def _wait_for_ads(self, page) -> bool:
        """Wait for ad cards to appear. Returns True if ads found."""
        try:
            await page.wait_for_selector(
                'div[class*="xrvj5dj"]',
                timeout=15_000,
            )
            return True
        except PWTimeout:
            pass
        try:
            content = await page.content()
            if "no results" in content.lower() or "no ads" in content.lower():
                self._log("No ads found for this search", "warn")
                return False
        except Exception:
            pass
        self._log("Could not detect ad cards — will try DOM scan anyway", "warn")
        return True

    async def _scroll_and_collect(self, page, keyword: str, country: str) -> list[dict]:
        """Scroll the page and extract ad data from the DOM."""
        collected = []
        seen_pages = set()
        prev_count = 0
        stable_rounds = 0

        for scroll_round in range(60):
            if self.stop.is_set():
                break
            await self._wait_unpaused()

            ads = await self._extract_ads_from_dom(page, keyword, country)
            new_ads = []
            for ad in ads:
                key = (ad.get("page_name", ""), ad.get("page_url", ""))
                if key not in seen_pages and ad.get("page_name"):
                    seen_pages.add(key)
                    new_ads.append(ad)
                    collected.append(ad)

            if len(collected) >= self.max_results:
                self._log(f"Reached max {self.max_results} results")
                break

            current_count = len(collected)
            if current_count == prev_count:
                stable_rounds += 1
                if stable_rounds >= 5:
                    self._log(f"No new ads after {stable_rounds} scrolls — done")
                    break
            else:
                stable_rounds = 0
                self._log(f"Scroll {scroll_round + 1}: found {len(new_ads)} new ({current_count} total)")
            prev_count = current_count

            try:
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            except Exception:
                pass
            await self._sleep(1.5, 3.0)

            try:
                await page.evaluate("window.scrollBy(0, -200)")
                await asyncio.sleep(0.3)
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            except Exception:
                pass
            await self._sleep(1.0, 2.0)

        return collected[:self.max_results]

    async def _extract_ads_from_dom(self, page, keyword: str, country: str) -> list[dict]:
        """Extract all visible ad data from current DOM state using JavaScript.

        DOM structure (mapped 2025-07-18):
        - The feed container is div.xrvj5dj with ~38 child divs
        - Each ad card is a child div starting with class x1plvlek
        - Text per card: "Active\\nLibrary ID: ...\\nStarted running on DD Mon YYYY\\nPlatforms\\n..."
        - Page name is a link to facebook.com/pagename
        - External website links go through l.facebook.com/l.php?u=<encoded_url>
        - Platform icons are images without alt text; count icons after "Platforms" label
        """
        js_extract = """
        () => {
            const results = [];

            // The feed container holds all ad cards as direct children.
            // Each ad card contains "Library ID:" text as a reliable boundary marker.
            // Strategy: find all "Started running" text nodes, walk up to the
            // individual card container (class starts with x1plvlek), extract from there.

            const feedContainer = document.querySelector('div[class*="xrvj5dj"]');
            if (!feedContainer) return results;

            // Each direct child of the feed's inner wrapper is an ad card
            const cardSelector = 'div[class*="x1plvlek"][class*="xryxfnj"]';
            const cards = feedContainer.querySelectorAll(cardSelector);

            for (const card of cards) {
                const text = card.innerText || '';
                if (!text.includes('Library ID:')) continue;

                const ad = {
                    page_name: '',
                    page_url: '',
                    website: '',
                    start_date: '',
                    is_active: true,
                    platforms: '',
                };

                // --- Active status ---
                // "Active" or "Inactive" appears at the very start of the card text
                if (text.match(/\\bInactive\\b/)) {
                    ad.is_active = false;
                }

                // --- Start date ---
                // Format: "Started running on 17 Jul 2025" or "Started running on 5 May 2026"
                const dateMatch = text.match(/Started running on\\s+(\\d{1,2}\\s+[A-Z][a-z]+\\s+\\d{4})/);
                if (dateMatch) {
                    ad.start_date = dateMatch[1];
                }

                // --- Page name + URL ---
                // The advertiser page is a link to facebook.com/<pagename>
                const fbLinks = card.querySelectorAll('a[href*="facebook.com/"]');
                for (const link of fbLinks) {
                    const href = link.href || '';
                    // Skip navigation/meta links
                    if (href.includes('/ads/library') || href.includes('/login') ||
                        href.includes('/help') || href.includes('/privacy') ||
                        href.includes('/policies') || href.includes('/about') ||
                        href.includes('/business') || href.includes('/settings') ||
                        href === 'https://www.facebook.com/' ||
                        href === 'https://www.facebook.com') continue;
                    const linkText = (link.innerText || '').trim();
                    // Page name links are short text (not full ad copy)
                    if (linkText && linkText.length > 1 && linkText.length < 100 &&
                        !linkText.includes('\\n') && linkText !== 'Sponsored') {
                        ad.page_name = linkText;
                        ad.page_url = href.split('?')[0];
                        break;
                    }
                }

                // --- Website URL ---
                // External links go through l.facebook.com/l.php?u=<url-encoded>
                // Extract the real URL from the u= parameter
                const allLinks = card.querySelectorAll('a[href*="l.facebook.com/l.php"]');
                for (const link of allLinks) {
                    const href = link.href || '';
                    try {
                        const url = new URL(href);
                        const realUrl = url.searchParams.get('u');
                        if (realUrl) {
                            // Skip app store links and fb.me links
                            if (realUrl.includes('fb.me/') || realUrl.includes('fb.com/')) continue;
                            ad.website = realUrl.split('?')[0];
                            break;
                        }
                    } catch(e) {}
                }

                // --- Platforms ---
                // After "Platforms" label, Facebook shows small icon images.
                // The icons don't have alt text, but we can count them.
                // Look for the section between "Platforms" and the next text block.
                // Also check for icon containers (small divs with mask-image style)
                const platformSection = text.match(/Platforms\\n([\\s\\S]*?)(?:This ad|EU transparency|See ad|Open Drop)/);
                if (platformSection) {
                    // Count non-empty lines (each icon renders as a blank line or unicode char)
                    const iconLines = platformSection[1].split('\\n').filter(l => l.trim() === '\\u200B' || l.trim() === '').length;
                    // Map count to platforms (Facebook first, then Instagram, Messenger, Audience Network)
                    const platformNames = ['Facebook', 'Instagram', 'Messenger', 'Audience Network'];
                    const platformCount = Math.min(iconLines, 4);
                    if (platformCount > 0) {
                        ad.platforms = platformNames.slice(0, platformCount).join(', ');
                    }
                }
                // Fallback: count mask-image divs near the Platforms label
                if (!ad.platforms) {
                    const iconDivs = card.querySelectorAll('div[style*="mask-image"]');
                    const platformIcons = [];
                    for (const div of iconDivs) {
                        const style = div.getAttribute('style') || '';
                        // Platform icons have specific background positions in the sprite
                        if (style.includes('mask-image')) {
                            platformIcons.push(div);
                        }
                    }
                    // Each platform has one icon; filter out non-platform icons
                    // by checking they're in the platforms section (near "Platforms" text)
                    const platformNames = ['Facebook', 'Instagram', 'Messenger', 'Audience Network'];
                    if (platformIcons.length > 0 && platformIcons.length <= 5) {
                        ad.platforms = platformNames.slice(0, Math.min(platformIcons.length, 4)).join(', ');
                    }
                }

                if (ad.page_name) {
                    results.push(ad);
                }
            }
            return results;
        }
        """
        try:
            raw = await page.evaluate(js_extract)
            for ad in raw:
                ad["keyword"] = keyword
                ad["country"] = country
                ad["scraped_at"] = datetime.datetime.now().isoformat(timespec="seconds")
            return raw
        except Exception as e:
            self._log(f"DOM extraction error: {e}", "error")
            return []

    def _build_ad_library_url_by_id(self, page_id: str, country: str) -> str:
        """Build the Ad Library URL using numeric page ID (always reliable)."""
        params = {
            "active_status": "active",
            "ad_type": "all",
            "country": country or "GB",
            "view_all_page_id": page_id,
            "search_type": "page",
            "media_type": "all",
        }
        return "https://www.facebook.com/ads/library/?" + urllib.parse.urlencode(params)

    async def _get_page_id(self, page, page_url: str) -> str:
        """Navigate to a Facebook page and extract its numeric page ID."""
        try:
            await page.goto(page_url, wait_until="domcontentloaded", timeout=30_000)
        except Exception:
            pass
        await asyncio.sleep(2.0)

        page_id = await page.evaluate("""
            () => {
                // Method 1: meta tag
                const meta = document.querySelector('meta[property="al:android:url"]');
                if (meta) {
                    const m = (meta.content || '').match(/fb:\\/\\/page\\/(\\d+)/);
                    if (m) return m[1];
                }
                // Method 2: page source contains pageID
                const html = document.documentElement.innerHTML;
                const patterns = [
                    /"pageID":"(\\d+)"/,
                    /"page_id":"(\\d+)"/,
                    /"pageId":"(\\d+)"/,
                    /entity_id":"(\\d+)"/,
                    /page_id=(\\d+)/,
                    /"identifier":"(\\d+)"/,
                ];
                for (const p of patterns) {
                    const m = html.match(p);
                    if (m) return m[1];
                }
                // Method 3: URL might already contain numeric ID
                const urlMatch = window.location.href.match(/facebook\\.com\\/(\\d+)/);
                if (urlMatch) return urlMatch[1];
                return '';
            }
        """)
        return page_id or ""

    async def _count_active_ads(self, page, ad_library_url: str) -> int:
        """Navigate to an advertiser's Ad Library page and count their active ads."""
        try:
            await page.goto(ad_library_url, wait_until="domcontentloaded", timeout=30_000)
        except Exception as e:
            self._log(f"Navigation error: {e}", "warn")
            return -1

        await self._dismiss_cookie_banner(page)
        await self._sleep(2.0, 3.0)

        count = await page.evaluate("""
            () => {
                const text = document.body.innerText || '';
                const m = text.match(/~?([\\d,]+)\\s+results?/i);
                if (m) return parseInt(m[1].replace(/,/g, ''), 10);
                if (text.includes('No ads match') || text.includes('no results')) return 0;
                return -1;
            }
        """)
        return count if isinstance(count, int) else -1

    async def _enrich_ad_counts(self, page, session_id: int):
        """Second pass: visit each unique page to get their ID, then count active ads."""
        pages = facebook_storage.unique_pages(session_id)
        if not pages:
            self._log("No pages to enrich.", "warn")
            return

        self._log(f"Enrichment pass: counting active ads for {len(pages)} pages...")
        self.emit({"type": "fb_enrich_start", "total": len(pages)})

        for i, p in enumerate(pages):
            if self.stop.is_set():
                break
            await self._wait_unpaused()

            page_name = p["page_name"]
            page_url = p["page_url"]
            country = p.get("country", "GB")

            # Step 1: Get numeric page ID from the Facebook page
            slug = page_url.rstrip("/").split("/")[-1]
            if slug.isdigit():
                page_id = slug
            else:
                self._log(f"  Getting page ID for: {page_name}")
                page_id = await self._get_page_id(page, page_url)

            if not page_id:
                self._log(f"  {page_name}: could not get page ID", "warn")
                await self._sleep()
                continue

            # Step 2: Build the reliable Ad Library URL using view_all_page_id
            ad_lib_url = self._build_ad_library_url_by_id(page_id, country)
            facebook_storage.update_ad_library_url(page_url, ad_lib_url)

            # Step 3: Navigate to Ad Library and count active ads
            count = await self._count_active_ads(page, ad_lib_url)
            if count >= 0:
                facebook_storage.update_ad_count(page_url, count)
                self._log(f"  {page_name}: {count} active ads")
                self.emit({"type": "fb_enrich_update",
                           "page_name": page_name, "count": count,
                           "done": i + 1, "total": len(pages)})
            else:
                self._log(f"  {page_name}: could not get count", "warn")

            await self._sleep()

        self._log("Enrichment pass complete.")
        self.emit({"type": "fb_enrich_done"})

    async def _scrape_query(self, page, keyword: str, country: str, session_id: int):
        url = self._build_url(keyword, country)
        self.metrics["current_query"] = f"{keyword} ({country})"
        self._push_metrics()
        self._log(f"GET {url}")

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=120_000)
        except PWTimeout:
            self._log("Navigation timeout", "error")
            return "error"
        except Exception as e:
            msg = str(e)
            if "ERR_ABORTED" in msg or "Navigation interrupted" in msg:
                self._log("goto interrupted — continuing")
            else:
                self._log(f"Navigation error: {e}", "error")
                return "error"

        await self._dismiss_cookie_banner(page)
        await self._sleep(2.0, 4.0)

        has_ads = await self._wait_for_ads(page)
        if not has_ads:
            return "empty"

        await self._sleep(1.0, 2.0)
        ads = await self._scroll_and_collect(page, keyword, country)
        self._log(f"Collected {len(ads)} ads for: {keyword} ({country})")

        new_count = 0
        for ad in ads:
            if self.stop.is_set():
                break
            ad["session_id"] = session_id
            ad["is_active"] = 1 if ad.get("is_active", True) else 0

            if not ad.get("page_name"):
                continue
            inserted = facebook_storage.insert_ad(ad)
            if inserted:
                self.metrics["new"] += 1
                new_count += 1
                self.emit({"type": "fb_lead", "lead": ad})
            else:
                self.metrics["duplicates"] += 1
            self._push_metrics()

            if self.proxy.tick():
                self._log(f"Rotated proxy -> {self.proxy.label}")

        self.metrics["pages"] += 1
        facebook_storage.mark_query_scraped(keyword, country, new_count)
        return "ok"

    async def run(self, jobs, force_rescrape=False, count_ads=False):
        facebook_storage.init_db()

        if not force_rescrape:
            jobs = [(k, c) for (k, c) in jobs
                    if not facebook_storage.is_query_scraped(k, c)]

        self.metrics["queries_total"] = len(jobs)
        self.metrics["started_at"] = time.time()

        if not jobs:
            self._log("Nothing to do — all queries already scraped.", "warn")
            self.emit({"type": "fb_done"})
            return

        session_id = facebook_storage.start_session()
        facebook_storage.update_session(session_id, queries_total=len(jobs))
        self._log(f"Facebook session {session_id} started — {len(jobs)} queries.")

        self._log("Launching Chromium…")
        async with async_playwright() as pw:
            try:
                browser = await self._launch(pw)
            except Exception as e:
                self._log(f"Browser launch FAILED: {e}", "error")
                self._log("Hint: run `python -m playwright install chromium`", "warn")
                facebook_storage.end_session(session_id)
                self.emit({"type": "fb_done", "session_id": session_id})
                return

            ctx, page = await self._new_context(pw, browser)
            self._log("Browser ready.")

            try:
                for keyword, country in jobs:
                    if self.stop.is_set():
                        break
                    await self._wait_unpaused()

                    try:
                        status = await self._scrape_query(page, keyword, country, session_id)
                    except Exception as e:
                        self.metrics["errors"] += 1
                        self._log(f"query '{keyword}/{country}' raised: {e}", "error")
                        status = "error"

                    if status == "blocked":
                        self._log("Blocked — rotating proxy", "warn")
                        self.proxy.rotate()
                        try:
                            await ctx.close()
                            await browser.close()
                        except Exception:
                            pass
                        try:
                            browser = await self._launch(pw)
                            ctx, page = await self._new_context(pw, browser)
                            status = await self._scrape_query(page, keyword, country, session_id)
                        except Exception as e:
                            self._log(f"retry failed: {e}", "error")

                    self.metrics["queries_done"] += 1
                    facebook_storage.update_session(
                        session_id,
                        leads_new=self.metrics["new"],
                        duplicates=self.metrics["duplicates"],
                        errors=self.metrics["errors"],
                    )
                    self._push_metrics()
                    await self._sleep()

                # Enrichment pass: count active ads per page
                if count_ads and not self.stop.is_set():
                    await self._enrich_ad_counts(page, session_id)
            finally:
                try:
                    await ctx.close()
                except Exception:
                    pass
                try:
                    await browser.close()
                except Exception:
                    pass
                facebook_storage.end_session(session_id)
                self.emit({"type": "fb_done", "session_id": session_id})
                self._log(f"Facebook session {session_id} ended.")
