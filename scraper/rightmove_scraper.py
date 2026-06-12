"""Playwright Rightmove scraper: takes search URLs, extracts all listings + prices + comps."""
import asyncio, random, re, datetime, urllib.parse, math, json, os
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

try:
    import urllib.request
except Exception:
    pass

try:
    from playwright_stealth import stealth_async
except Exception:
    stealth_async = None

import rightmove_storage


class RightmoveScraper:
    def __init__(self, proxy_mgr, emit, stop_event, pause_event,
                 max_pages=50, delay_min=2.0, delay_max=5.0,
                 headless=True):
        self.proxy = proxy_mgr
        self.emit = emit
        self.stop = stop_event
        self.pause = pause_event
        self.max_pages = max_pages
        self.delay_min = float(delay_min)
        self.delay_max = float(delay_max)
        self.headless = headless
        self.metrics = {
            "pages": 0, "new": 0, "duplicates": 0, "errors": 0,
            "current_url": "", "current_proxy": proxy_mgr.label,
            "urls_done": 0, "urls_total": 0, "started_at": None,
        }

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
        self.emit({"type": "rm_metrics", **self.metrics})

    async def _launch(self, pw):
        kwargs = dict(
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-default-browser-check",
                "--no-first-run",
            ],
        )
        proxy_arg = self.proxy.playwright_proxy()
        if proxy_arg:
            kwargs["proxy"] = proxy_arg
        return await pw.chromium.launch(**kwargs)

    async def _new_context(self, browser):
        ctx = await browser.new_context(
            viewport={"width": 1366, "height": 900},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"),
            locale="en-GB",
            ignore_https_errors=True,
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
        return ctx, page

    async def _extract_listings(self, page, search_url):
        """Extract all property listings from the current search results page."""
        listings = []

        data = await page.evaluate('''(searchUrl) => {
            const cards = document.querySelectorAll('[class*="propertyCard-details"]');
            return Array.from(cards).map(card => {
                const anchor = card.querySelector('a[id^="prop"]');
                const propId = anchor ? anchor.id.replace('prop','') : '';
                if (!propId) return null;

                const priceEl = card.querySelector('[data-testid="property-price"]');
                let price = priceEl ? priceEl.textContent.trim() : '';
                let qualifier = '';
                const qualMatch = price.match(/(Guide Price|Offers Over|Offers in Excess of|POA|Shared Ownership|From)/i);
                if (qualMatch) {
                    qualifier = qualMatch[1];
                    price = price.replace(qualMatch[0], '').trim();
                }
                const priceMatch = price.match(/£[\\d,]+/);
                if (priceMatch) price = priceMatch[0];

                const addrEl = card.querySelector('[data-testid="property-address"]');
                const address = addrEl ? addrEl.textContent.trim() : '';

                const infoEl = card.querySelector('[data-testid="property-information"]');
                const info = infoEl ? infoEl.textContent.trim() : '';
                // Info is like "Flat11" or "Apartment21" — type then beds then baths
                // Split: letters first, then digits
                const typeMatch = info.match(/^([A-Za-z\\s-]+)/);
                const propType = typeMatch ? typeMatch[1].trim() : '';
                const numsMatch = info.match(/[A-Za-z\\s-]+(\\d)/);
                const beds = numsMatch ? numsMatch[1] : '';

                // Listing date from card
                const parent = card.closest('[class*="propertyCard"]') || card.parentElement;
                const cardText = parent ? parent.innerText : card.innerText;
                let listedDate = '';
                const dateMatch = cardText.match(/(?:Added|Reduced|Listed)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
                if (dateMatch) listedDate = dateMatch[1];

                // Auction detection from qualifier
                const isAuction = /guide price|auction/i.test(qualifier) ? '1' : '0';

                // Tenanted detection from card text
                const isTenanted = /\b(tenanted|tenant in situ|investment|currently let|buy.to.let)\b/i.test(cardText) ? '1' : '0';

                return {
                    listing_url: 'https://www.rightmove.co.uk/properties/' + propId,
                    price, price_qualifier: qualifier, address,
                    bedrooms: beds, property_type: propType,
                    property_id: propId, search_url: searchUrl,
                    listed_date: listedDate, is_auction: isAuction, is_tenanted: isTenanted,
                };
            }).filter(x => x !== null);
        }''', search_url)

        now = datetime.datetime.now().isoformat(timespec="seconds")
        for item in data:
            item["scraped_at"] = now
            listings.append(item)

        return listings

    async def _get_total_results(self, page):
        """Try to read the total results count from the page."""
        try:
            text = await page.evaluate('''() => {
                const el = document.querySelector('[class*="searchHeader"], [class*="SearchHeader"]');
                return el ? el.textContent : '';
            }''')
            m = re.search(r"([\d,]+)\s*(?:results?|properties)", text, re.IGNORECASE)
            if m:
                return int(m.group(1).replace(",", ""))
        except Exception:
            pass
        return 0

    async def _scrape_search_url(self, page, search_url, session_id):
        """Scrape all pages of a single Rightmove search URL."""
        self._log(f"Opening: {search_url}")
        self.metrics["current_url"] = search_url

        page_num = 0
        total_for_url = 0
        # Rightmove takes the *first* `index=` query param, so we must strip any
        # existing one off the user's URL before appending our own per-page value.
        # Otherwise every page request returns page 1.
        try:
            from urllib.parse import urlparse, urlencode, parse_qsl, urlunparse
            _p = urlparse(search_url)
            _q = [(k, v) for k, v in parse_qsl(_p.query, keep_blank_values=True) if k != "index"]
            base_url = urlunparse(_p._replace(query=urlencode(_q)))
        except Exception:
            base_url = search_url
        page_cap = self.max_pages
        seen_pids_this_url: set[str] = set()

        while page_num < page_cap:
            if self.stop.is_set():
                break
            await self._wait_unpaused()

            if page_num == 0:
                url = base_url
            else:
                sep = "&" if "?" in base_url else "?"
                url = f"{base_url}{sep}index={page_num * 24}"

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                await asyncio.sleep(2)
            except PWTimeout:
                self._log(f"Timeout loading page {page_num + 1}", "warn")
                self.metrics["errors"] += 1
                break
            except Exception as e:
                self._log(f"Error loading page: {e}", "error")
                self.metrics["errors"] += 1
                break

            if page_num == 0:
                total = await self._get_total_results(page)
                if total:
                    # Rightmove paginates 24 per page. Cap the loop at the real
                    # number of pages so we don't keep crawling past the end
                    # (Rightmove returns recycled results when index > total).
                    real_pages = (total + 23) // 24
                    page_cap = min(self.max_pages, real_pages)
                    self._log(f"Found {total} total results → capping at {page_cap} page(s)")

            self.metrics["pages"] += 1
            self._push_metrics()

            listings = await self._extract_listings(page, search_url)
            if not listings:
                self._log(f"No listings found on page {page_num + 1} - stopping pagination")
                break

            # Early-exit: if every listing on this page is something we've
            # already seen this run, Rightmove is showing wrap-around results.
            page_pids = {l.get("property_id") for l in listings if l.get("property_id")}
            page_new_pids = page_pids - seen_pids_this_url
            seen_pids_this_url.update(page_pids)

            for listing in listings:
                listing["session_id"] = session_id
                is_new = rightmove_storage.insert_listing(listing)
                if is_new:
                    self.metrics["new"] += 1
                    total_for_url += 1
                    self.emit({"type": "rm_listing", **listing})
                else:
                    self.metrics["duplicates"] += 1
                self._push_metrics()

            self._log(f"Page {page_num + 1}: found {len(listings)} listings ({self.metrics['new']} new total)")

            if not page_new_pids:
                self._log(f"Page {page_num + 1}: all listings were duplicates of earlier pages — stopping")
                break

            has_next = await page.evaluate('''() => {
                const pag = document.querySelector('[class*="Pagination"]');
                if (!pag) return false;
                const next = pag.querySelector('button:last-child, a:last-child');
                if (!next) return false;
                return !next.disabled && next.textContent.includes('Next');
            }''')
            if not has_next:
                self._log("No more pages")
                break

            page_num += 1
            await self._sleep()

        return total_for_url

    async def run(self, search_urls, force_rescrape=False):
        """Main entry point: scrape a list of Rightmove search URLs."""
        self.metrics["urls_total"] = len(search_urls)
        self.metrics["started_at"] = datetime.datetime.now().isoformat(timespec="seconds")
        self._push_metrics()

        session_id = rightmove_storage.start_session()
        rightmove_storage.update_session(session_id, urls_total=len(search_urls))

        async with async_playwright() as pw:
            browser = await self._launch(pw)
            try:
                ctx, page = await self._new_context(browser)

                for i, search_url in enumerate(search_urls):
                    if self.stop.is_set():
                        break
                    await self._wait_unpaused()

                    search_url = search_url.strip()
                    if not search_url:
                        continue

                    if not force_rescrape and rightmove_storage.is_url_scraped(search_url):
                        self._log(f"Skipping already scraped: {search_url}")
                        self.metrics["urls_done"] += 1
                        self._push_metrics()
                        continue

                    count = await self._scrape_search_url(page, search_url, session_id)
                    rightmove_storage.mark_url_scraped(search_url, count)
                    rightmove_storage.update_session(
                        session_id,
                        listings_new=self.metrics["new"],
                        duplicates=self.metrics["duplicates"],
                        errors=self.metrics["errors"],
                    )
                    self.metrics["urls_done"] = i + 1
                    self._push_metrics()
                    self._log(f"Done URL {i + 1}/{len(search_urls)}: {count} new listings")

                    if i < len(search_urls) - 1:
                        await self._sleep()

                await ctx.close()
            finally:
                await browser.close()

        rightmove_storage.end_session(session_id)
        self._log("All done!", "info")
        self.emit({"type": "rm_done"})


class FloorplanFetcher:
    """Visits Rightmove listing pages and extracts floor plan image URLs."""

    def __init__(self, proxy_mgr, emit, stop_event, pause_event,
                 delay_min=2.0, delay_max=4.0, headless=True):
        self.proxy = proxy_mgr
        self.emit = emit
        self.stop = stop_event
        self.pause = pause_event
        self.delay_min = float(delay_min)
        self.delay_max = float(delay_max)
        self.headless = headless
        self.metrics = {
            "fetched": 0, "errors": 0, "no_floorplan": 0,
            "total": 0, "current": "",
        }

    async def _sleep(self):
        await asyncio.sleep(random.uniform(self.delay_min, self.delay_max))

    async def _wait_unpaused(self):
        while self.pause.is_set() and not self.stop.is_set():
            await asyncio.sleep(0.3)

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    def _push_metrics(self):
        self.emit({"type": "fp_metrics", **self.metrics})

    async def _extract_floorplans(self, page, property_id):
        """Extract floor plan image URLs from a listing page (large versions only)."""
        urls = await page.evaluate('''() => {
            const results = [];
            // Method 1: look for floorplan images in the page
            const imgs = document.querySelectorAll('img[src*="floorplan"], img[src*="FloorPlan"], img[alt*="floorplan" i], img[alt*="floor plan" i]');
            for (const img of imgs) {
                const src = img.src || img.getAttribute('data-src') || '';
                if (src && !results.includes(src)) results.push(src);
            }
            // Method 2: look for floorplan links/images in media viewer
            const links = document.querySelectorAll('a[href*="floorplan"], a[href*="FloorPlan"]');
            for (const a of links) {
                const img = a.querySelector('img');
                if (img) {
                    const src = img.src || img.getAttribute('data-src') || '';
                    if (src && !results.includes(src)) results.push(src);
                }
            }
            // Method 3: look in meta tags or script data for floorplan URLs
            const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
            for (const s of scripts) {
                const text = s.textContent || '';
                const matches = text.match(/https?:[^"'\\s]*(?:floorplan|floor_plan|FloorPlan)[^"'\\s]*\\.(?:jpg|jpeg|png|gif|webp)/gi);
                if (matches) {
                    for (const m of matches) {
                        const clean = m.replace(/\\\\/g, '');
                        if (!results.includes(clean)) results.push(clean);
                    }
                }
            }
            return results;
        }''')
        return self._filter_largest_floorplans(urls)

    def _filter_largest_floorplans(self, urls):
        """Keep only the largest version of each floor plan, drop thumbnails."""
        if not urls:
            return urls
        thumb_patterns = re.compile(
            r'_max_\d+x\d+|_thumb|_small|_preview|_crop|_\d+x\d+\.',
            re.IGNORECASE
        )
        full = [u for u in urls if not thumb_patterns.search(u)]
        if full:
            return full
        return urls

    async def _extract_listing_details(self, page):
        """Extract auction status, listing date, tenancy status, and floor area."""
        return await page.evaluate(r'''() => {
            const result = {is_auction: '0', listed_date: '', days_on_market: '', is_tenanted: '0',
                            floor_area_sqft: '', floor_area_sqm: '',
                            agent_name: '', agent_phone: '', agent_branch_url: ''};

            const text = document.body.innerText || '';

            // Auction detection
            const auctionPatterns = /\b(auction|guide price|lot \d+|reserve price|going to auction)\b/i;
            if (auctionPatterns.test(text)) result.is_auction = '1';
            const auctionBadge = document.querySelector('[class*="auction" i], [data-testid*="auction" i]');
            if (auctionBadge) result.is_auction = '1';

            // Listed date / days on market
            const addedMatch = text.match(/(?:Added|Listed)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
            if (addedMatch) result.listed_date = addedMatch[1];
            const reducedMatch = text.match(/Reduced\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
            if (reducedMatch && !result.listed_date) result.listed_date = reducedMatch[1];
            const daysMatch = text.match(/(\d+)\s+days?\s+(?:on\s+)?Rightmove/i);
            if (daysMatch) result.days_on_market = daysMatch[1];

            // Tenanted detection
            const tenantPatterns = /\b(tenanted|tenant in situ|currently let|currently rented|with sitting tenant|rental income|buy.to.let investment|investment.only|tenant in place|occupied)\b/i;
            if (tenantPatterns.test(text)) result.is_tenanted = '1';

            // Floor area extraction
            const sqftMatch = text.match(/([\d,]+)\s*sq\s*\.?\s*ft/i);
            if (sqftMatch) result.floor_area_sqft = sqftMatch[1].replace(/,/g, '');
            const sqmMatch = text.match(/([\d,.]+)\s*sq\s*\.?\s*m(?:\b|[^i])/i);
            if (sqmMatch) result.floor_area_sqm = sqmMatch[1].replace(/,/g, '');
            if (result.floor_area_sqft && !result.floor_area_sqm) {
                result.floor_area_sqm = String(Math.round(parseFloat(result.floor_area_sqft) / 10.764));
            }
            if (result.floor_area_sqm && !result.floor_area_sqft) {
                result.floor_area_sqft = String(Math.round(parseFloat(result.floor_area_sqm) * 10.764));
            }

            // Agent info — preferred source: window.PAGE_MODEL JSON blob that
            // Rightmove inlines on each listing page.
            try {
                const scripts = Array.from(document.querySelectorAll('script'));
                const pmScript = scripts.find(s => /window\.PAGE_MODEL\s*=/.test(s.textContent || ''));
                if (pmScript) {
                    const m = pmScript.textContent.match(/window\.PAGE_MODEL\s*=\s*({[\s\S]*?})\s*(?:;|<\/script>|$)/);
                    if (m) {
                        const pm = JSON.parse(m[1]);
                        const pd = pm && pm.propertyData;
                        if (pd) {
                            const cust = pd.customer || {};
                            const contact = (pd.contactInfo && pd.contactInfo.telephoneNumbers) || {};
                            const analytics = pm.analyticsInfo || pm.analyticsData || {};
                            const analyticsProperty = analytics.analyticsProperty || analytics.property || {};
                            const analyticsAgent = analyticsProperty.agent || analytics.agent || {};
                            result.agent_name = cust.branchDisplayName || cust.brandTradingName
                                              || cust.companyTradingName || cust.branchName
                                              || analyticsAgent.branchName || analyticsAgent.brandName || '';
                            result.agent_phone = contact.localNumber || contact.internationalNumber
                                              || cust.contactTelephone || '';
                            const slug = cust.branchLandingPageUrl || cust.brandLandingPageUrl || '';
                            result.agent_branch_url = slug ? (slug.startsWith('http') ? slug : 'https://www.rightmove.co.uk' + slug) : '';
                        }
                    }
                }
            } catch (_) { /* fall through to DOM */ }

            // DOM fallback if PAGE_MODEL didn't expose the fields.
            if (!result.agent_phone) {
                const phoneEl = document.querySelector('[data-testid*="contact" i] a[href^="tel:"], a[href^="tel:"]');
                if (phoneEl) {
                    const href = phoneEl.getAttribute('href') || '';
                    result.agent_phone = href.replace(/^tel:/i, '').trim() || (phoneEl.textContent || '').trim();
                }
            }
            if (!result.agent_name) {
                const nameEl = document.querySelector('[data-testid="agent-details-name"], [data-testid*="branch-name" i], [class*="agentName" i], [class*="branchName" i]');
                if (nameEl) result.agent_name = (nameEl.textContent || '').trim();
            }
            if (!result.agent_branch_url) {
                const branchLink = document.querySelector('a[href*="/estate-agents/"], a[href*="/branch/"]');
                if (branchLink) {
                    const h = branchLink.getAttribute('href') || '';
                    result.agent_branch_url = h.startsWith('http') ? h : ('https://www.rightmove.co.uk' + h);
                }
            }

            // Last-resort: derive agent_name from the branch URL slug,
            // e.g. ".../estate-agents/agent/Zuker-Property-Ltd/Birmingham-147848.html"
            //   →  "Zuker Property Ltd"
            if (!result.agent_name && result.agent_branch_url) {
                const m = result.agent_branch_url.match(/\/estate-agents\/agent\/([^/]+)\//i)
                       || result.agent_branch_url.match(/\/branch\/([^/]+)\//i);
                if (m && m[1]) {
                    result.agent_name = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
                }
            }

            // Normalise phone — strip surrounding whitespace, keep digits/spaces.
            if (result.agent_phone) {
                result.agent_phone = result.agent_phone.replace(/[^0-9+()\s\-]/g, '').replace(/\s+/g, ' ').trim();
            }

            return result;
        }''')

    async def run(self, properties):
        """Fetch floor plans for a list of property dicts with property_id and listing_url."""
        self.metrics["total"] = len(properties)
        self._push_metrics()

        async with async_playwright() as pw:
            kwargs = dict(
                headless=self.headless,
                args=["--disable-blink-features=AutomationControlled",
                      "--disable-dev-shm-usage", "--no-default-browser-check", "--no-first-run"],
            )
            proxy_arg = self.proxy.playwright_proxy()
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

                for i, prop in enumerate(properties):
                    if self.stop.is_set():
                        break
                    await self._wait_unpaused()

                    pid = prop["property_id"]
                    url = prop["listing_url"]
                    self.metrics["current"] = f"{pid} ({i+1}/{len(properties)})"
                    self._push_metrics()

                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        await asyncio.sleep(2)

                        details = await self._extract_listing_details(page)
                        rightmove_storage.update_listing_details(pid, details)

                        fp_urls = await self._extract_floorplans(page, pid)
                        if fp_urls:
                            for idx, fp_url in enumerate(fp_urls):
                                rightmove_storage.insert_floorplan(pid, fp_url, idx + 1)
                            self.metrics["fetched"] += 1
                            tags = []
                            if details.get("is_auction") == "1":
                                tags.append("AUCTION")
                            if details.get("is_tenanted") == "1":
                                tags.append("TENANTED")
                            if details.get("days_on_market"):
                                tags.append(f"{details['days_on_market']}d")
                            tag_str = f" [{', '.join(tags)}]" if tags else ""
                            self._log(f"{pid}: {len(fp_urls)} floor plan(s){tag_str}")
                            self.emit({"type": "fp_found", "property_id": pid, "count": len(fp_urls)})
                        else:
                            rightmove_storage.insert_floorplan(pid, "", 0)
                            # Auto-skip: no floor plan = useless for BRRRR.
                            # set_review_if_unset never overwrites a status
                            # the user already set, so this is safe.
                            rightmove_storage.set_review_if_unset(pid, "skip")
                            self.metrics["no_floorplan"] += 1
                            self._log(f"{pid}: no floor plan found — auto-skipped", "warn")

                    except Exception as e:
                        self._log(f"{pid}: error - {e}", "error")
                        self.metrics["errors"] += 1

                    self._push_metrics()

                    if i < len(properties) - 1:
                        await self._sleep()

                await ctx.close()
            finally:
                await browser.close()

        self._log("Floor plan fetch complete!", "info")
        self.emit({"type": "fp_done"})


class CompsFetcher:
    """Searches Rightmove for comparable sold prices (Land Registry) and rental
    listings, sorted by distance from the subject property."""

    PAGES_TO_SCRAPE = 5

    def __init__(self, proxy_mgr, emit, stop_event, pause_event,
                 delay_min=3.0, delay_max=6.0, headless=True, storage=None):
        self.proxy = proxy_mgr
        self.emit = emit
        self.stop = stop_event
        self.pause = pause_event
        self.delay_min = float(delay_min)
        self.delay_max = float(delay_max)
        self.headless = headless
        # Portal-agnostic: defaults to rightmove_storage, but Zoopla passes
        # zoopla_storage so comps land in zp_comps. Same insert_comp/clear_comps API.
        self.storage = storage or rightmove_storage
        self.metrics = {"done": 0, "total": 0, "current": ""}
        self._outcode_cache = {}
        self._geo_cache = {}

    async def _sleep(self):
        await asyncio.sleep(random.uniform(self.delay_min, self.delay_max))

    async def _wait_unpaused(self):
        while self.pause.is_set() and not self.stop.is_set():
            await asyncio.sleep(0.3)

    def _log(self, msg, level="info"):
        self.emit({"type": "log", "level": level, "msg": msg,
                   "ts": datetime.datetime.now().strftime("%H:%M:%S")})

    def _push_metrics(self):
        self.emit({"type": "comp_metrics", **self.metrics})

    @staticmethod
    def _extract_outcode(address):
        m = re.search(r'\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b', address, re.IGNORECASE)
        if m:
            return m.group(1).upper()
        m = re.search(r'\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b', address, re.IGNORECASE)
        if m:
            return m.group(1).upper()
        return ""

    @staticmethod
    def _extract_full_postcode(address):
        m = re.search(r'\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b', address, re.IGNORECASE)
        return m.group(1).upper().replace(" ", "") if m else ""

    @staticmethod
    def _extract_street(address):
        addr = re.sub(r'\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d?[A-Z]{0,2}\b', '', address, flags=re.IGNORECASE)
        addr = re.sub(r',?\s*(Manchester|Salford|Greater Manchester|Lancashire)\b', '', addr, flags=re.IGNORECASE)
        parts = [p.strip() for p in addr.split(',') if p.strip()]
        for p in parts:
            cleaned = re.sub(r'^\d+[a-zA-Z]?\s*,?\s*', '', p).strip()
            cleaned = re.sub(r'^(Flat|Apartment|Unit)\s+\d+\w?\s*,?\s*', '', cleaned, flags=re.IGNORECASE).strip()
            if len(cleaned) > 3 and re.search(r'[A-Za-z]{3,}', cleaned):
                return cleaned.lower()
        return ""

    CITY_ALIASES = {
        "greater manchester": "manchester", "salford": "manchester",
        "merseyside": "liverpool", "west midlands": "birmingham",
        "tyne and wear": "newcastle", "west yorkshire": "leeds",
        "south yorkshire": "sheffield", "nottinghamshire": "nottingham",
    }
    KNOWN_CITIES = ["manchester", "liverpool", "birmingham", "leeds",
                    "newcastle", "blackpool", "sheffield", "nottingham"]

    @staticmethod
    def _extract_city(address):
        addr_lower = address.lower()
        addr_clean = re.sub(r'\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d?[A-Z]{0,2}\b', '', address, flags=re.IGNORECASE)
        parts = [p.strip().lower() for p in addr_clean.split(',') if p.strip()]
        for p in reversed(parts):
            p_clean = p.strip()
            if p_clean in CompsFetcher.CITY_ALIASES:
                return CompsFetcher.CITY_ALIASES[p_clean]
            if p_clean in CompsFetcher.KNOWN_CITIES:
                return p_clean
        for city in CompsFetcher.KNOWN_CITIES:
            if city in addr_lower:
                return city
        return ""

    @staticmethod
    def _build_zoopla_street_url(address):
        city = CompsFetcher._extract_city(address)
        street = CompsFetcher._extract_street(address)
        if not city or not street:
            return None
        street_slug = re.sub(r'[^a-z0-9\s]', '', street).strip().replace(' ', '-')
        return f"https://www.zoopla.co.uk/house-prices/{city}/{street_slug}/"

    @staticmethod
    def _build_zoopla_postcode_url(address):
        city = CompsFetcher._extract_city(address)
        street = CompsFetcher._extract_street(address)
        pc = CompsFetcher._extract_full_postcode(address)
        if not city or not street or not pc:
            return None
        street_slug = re.sub(r'[^a-z0-9\s]', '', street).strip().replace(' ', '-')
        pc_slug = pc.lower()
        pc_slug = pc_slug[:-3] + "-" + pc_slug[-3:] if len(pc_slug) > 3 else pc_slug
        return f"https://www.zoopla.co.uk/house-prices/{city}/{street_slug}/{pc_slug}/"

    async def _dismiss_zoopla_cookies(self, page):
        try:
            btn = page.locator('button:has-text("Accept all cookies")')
            await btn.click(timeout=3000)
            await asyncio.sleep(0.5)
        except Exception:
            try:
                await page.evaluate('''() => {
                    const btns = Array.from(document.querySelectorAll("button"));
                    const accept = btns.find(b => /accept|agree|save/i.test(b.textContent));
                    if (accept) accept.click();
                }''')
            except Exception:
                pass

    async def _scrape_zoopla_street_page(self, page, url):
        try:
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            except Exception:
                self._log(f"  Zoopla page load timeout: {url}", "warn")
                return []
            await asyncio.sleep(3)
            await self._dismiss_zoopla_cookies(page)
            results = await page.evaluate(r'''() => {
                const out = [];
                const links = document.querySelectorAll('a[href*="/property/uprn/"]');
                const seen = new Set();
                for (const link of links) {
                    const href = link.getAttribute("href") || "";
                    if (seen.has(href)) continue;
                    seen.add(href);
                    const card = link.closest("li") || link.closest("div") || link.parentElement;
                    if (!card) continue;
                    const text = card.innerText || "";
                    const addrEl = card.querySelector("h2, h3, [data-testid*='address']");
                    const address = addrEl ? addrEl.textContent.trim() : link.textContent.trim().split("\n")[0];
                    const bedMatch = text.match(/(\d+)\s*bed/i);
                    const beds = bedMatch ? bedMatch[1] : "";
                    const sqmMatch = text.match(/(\d+)\s*sq\s*m/i);
                    const sqm = sqmMatch ? sqmMatch[1] : "";
                    const typeMatch = text.match(/(flat|maisonette|apartment|studio|purpose built flat|terraced|semi-detached|detached)/i);
                    const ptype = typeMatch ? typeMatch[1] : "";
                    const uprn = href.match(/uprn\/(\d+)/);
                    out.push({
                        address: address,
                        beds: beds,
                        sqm: sqm,
                        property_type: ptype,
                        uprn_path: href,
                        uprn: uprn ? uprn[1] : ""
                    });
                }
                return out;
            }''')
            self._log(f"  Zoopla street page: {len(results)} properties found")
            return results
        except Exception as e:
            self._log(f"  Zoopla street page error: {e}", "warn")
            return []

    async def _scrape_zoopla_uprn_page(self, page, uprn_path):
        try:
            url = f"https://www.zoopla.co.uk{uprn_path}" if uprn_path.startswith("/") else uprn_path
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            except Exception:
                self._log(f"    Zoopla UPRN timeout: {uprn_path}", "warn")
                return None
            await asyncio.sleep(2)
            data = await page.evaluate(r'''() => {
                const text = document.body.innerText || "";
                const sales = [];
                const priceRegex = /(?:Sold|sold)\s*(?:for\s*)?(?:in\s+)?(\w+\s+\d{4})\s*[\n\r]+\s*£([\d,]+)/g;
                let m;
                while ((m = priceRegex.exec(text)) !== null) {
                    sales.push({date: m[1], price: "£" + m[2]});
                }
                if (sales.length === 0) {
                    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
                    for (let i = 0; i < lines.length; i++) {
                        if (/sold/i.test(lines[i])) {
                            const dateMatch = lines.slice(i, i+3).join(" ").match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
                            const priceMatch = lines.slice(i, i+3).join(" ").match(/£([\d,]+)/);
                            if (dateMatch && priceMatch) {
                                sales.push({date: dateMatch[1], price: "£" + priceMatch[1]});
                            }
                        }
                    }
                }
                const bedMatch = text.match(/(\d+)\s*bed/i);
                const sqmMatch = text.match(/(\d+)\s*sq\s*m/i);
                const typeMatch = text.match(/(purpose built flat|flat|maisonette|apartment|studio)/i);
                const pcMatch = text.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/);
                return {
                    sales: sales,
                    beds: bedMatch ? bedMatch[1] : "",
                    sqm: sqmMatch ? sqmMatch[1] : "",
                    property_type: typeMatch ? typeMatch[1] : "Flat",
                    postcode: pcMatch ? pcMatch[1] : "",
                    url: window.location.href
                };
            }''')
            return data
        except Exception as e:
            self._log(f"    Zoopla UPRN page error ({uprn_path}): {e}", "warn")
            return None

    async def _search_zoopla_sold(self, page, subject_addr, beds, target_beds):
        subject_street = self._extract_street(subject_addr)
        subject_pc = self._extract_full_postcode(subject_addr)
        subject_geo = self._geo_cache.get(subject_pc)
        if not subject_geo and subject_pc:
            self._geocode_postcodes([subject_pc])
            subject_geo = self._geo_cache.get(subject_pc)

        all_properties = []
        seen_uprns = set()

        def merge_properties(new_props):
            for p in new_props:
                uprn = p.get("uprn", "")
                if uprn and uprn in seen_uprns:
                    continue
                if uprn:
                    seen_uprns.add(uprn)
                all_properties.append(p)

        # --- Fallback 1: street + postcode (most specific) ---
        pc_url = self._build_zoopla_postcode_url(subject_addr)
        if pc_url:
            self._log(f"  Zoopla fallback 1: street+postcode {pc_url}")
            merge_properties(await self._scrape_zoopla_street_page(page, pc_url))
            await asyncio.sleep(random.uniform(1.0, 2.0))

        # --- Fallback 2: street only (all postcodes on that street) ---
        street_url = self._build_zoopla_street_url(subject_addr)
        if street_url and street_url != pc_url:
            self._log(f"  Zoopla fallback 2: street only {street_url}")
            merge_properties(await self._scrape_zoopla_street_page(page, street_url))
            await asyncio.sleep(random.uniform(1.0, 2.0))

        # --- Fallback 3: nearby postcodes within 200m (different streets) ---
        if subject_pc:
            nearby = self._get_nearby_postcodes(subject_pc, radius=200)
            nearby_pcs = [pc for pc, dist in nearby if pc.replace(" ", "") != subject_pc]
            if nearby_pcs:
                city = self._extract_city(subject_addr)
                self._log(f"  Zoopla fallback 3: {len(nearby_pcs)} nearby postcodes within 200m")
                for npc in nearby_pcs[:6]:
                    if self.stop.is_set():
                        break
                    npc_slug = npc.lower().replace(" ", "")
                    npc_slug = npc_slug[:-3] + "-" + npc_slug[-3:] if len(npc_slug) > 3 else npc_slug
                    if city:
                        npc_url = f"https://www.zoopla.co.uk/house-prices/{city}/{npc_slug}/"
                    else:
                        npc_url = f"https://www.zoopla.co.uk/house-prices/{npc_slug}/"
                    before = len(all_properties)
                    merge_properties(await self._scrape_zoopla_street_page(page, npc_url))
                    added = len(all_properties) - before
                    if added:
                        self._log(f"    {npc}: +{added} properties")
                    await asyncio.sleep(random.uniform(1.0, 2.0))

        flat_types = {"flat", "maisonette", "apartment", "studio", "purpose built flat", ""}
        flats = [p for p in all_properties if p.get("property_type", "").lower() in flat_types]
        same_bed_pool = [p for p in flats if p.get("beds") == str(beds)]
        target_bed_pool = [p for p in flats if p.get("beds") == str(target_beds)]

        self._log(f"  Zoopla totals: {len(flats)} flats, {len(same_bed_pool)} x {beds}-bed, {len(target_bed_pool)} x {target_beds}-bed")

        async def fetch_sold_comps(pool, label, max_visits=8):
            results = []
            visited = 0
            for prop in pool[:max_visits]:
                if self.stop.is_set():
                    break
                uprn_path = prop.get("uprn_path", "")
                if not uprn_path:
                    continue
                self._log(f"    Zoopla: checking {prop.get('address', '')[:40]}...")
                data = await self._scrape_zoopla_uprn_page(page, uprn_path)
                visited += 1
                if not data or not data.get("sales"):
                    await asyncio.sleep(random.uniform(1.0, 2.0))
                    continue
                sale = data["sales"][0]
                year = self._parse_year(sale.get("date", ""))
                if year < 2020:
                    await asyncio.sleep(random.uniform(1.0, 2.0))
                    continue

                comp_pc = data.get("postcode", "")
                comp_pc_clean = comp_pc.replace(" ", "") if comp_pc else ""
                if comp_pc_clean:
                    self._geocode_postcodes([comp_pc_clean])

                comp_geo = self._geo_cache.get(comp_pc_clean) if comp_pc_clean else None
                dist = 0
                if subject_geo and comp_geo:
                    dist = self._haversine(subject_geo[0], subject_geo[1], comp_geo[0], comp_geo[1])

                comp_street = self._extract_street(prop.get("address", ""))
                dist_label = self._distance_label(dist, subject_street, comp_street, subject_addr, prop.get("address", ""))

                results.append({
                    "address": prop.get("address", ""),
                    "postcode": comp_pc,
                    "price": sale.get("price", ""),
                    "beds": data.get("beds") or prop.get("beds", ""),
                    "property_type": data.get("property_type") or prop.get("property_type", "Flat"),
                    "date": sale.get("date", ""),
                    "url": data.get("url", ""),
                    "distance_m": str(int(dist)),
                    "distance_label": dist_label,
                    "source": "Zoopla",
                    "floor_area_sqm": data.get("sqm") or prop.get("sqm", ""),
                })
                await asyncio.sleep(random.uniform(1.5, 3.0))

            results.sort(key=lambda r: self._sort_key(r))
            self._log(f"  Zoopla {label}: {len(results)} comps from {visited} pages")
            return results[:5]

        same_bed_comps = await fetch_sold_comps(same_bed_pool, f"{beds}-bed (same)")
        target_bed_comps = await fetch_sold_comps(target_bed_pool, f"{target_beds}-bed (target)")

        return same_bed_comps, target_bed_comps

    @staticmethod
    def _parse_year(date_str):
        if not date_str:
            return 0
        m = re.search(r'(\d{4})', str(date_str))
        return int(m.group(1)) if m else 0

    @staticmethod
    def _sort_key(r):
        label = r.get("distance_label", "")
        dist = int(r.get("distance_m") or 999999)
        year = CompsFetcher._parse_year(r.get("date", ""))
        neg_year = -year if year > 0 else 0
        if label == "Same building":
            return (0, neg_year, dist)
        if label == "Same road":
            return (1, neg_year, dist)
        return (2, neg_year, dist)

    @staticmethod
    def _haversine(lat1, lon1, lat2, lon2):
        R = 6371000
        p = math.pi / 180
        a = (math.sin((lat2 - lat1) * p / 2) ** 2
             + math.cos(lat1 * p) * math.cos(lat2 * p)
             * math.sin((lon2 - lon1) * p / 2) ** 2)
        return R * 2 * math.asin(math.sqrt(a))

    def _geocode_postcodes(self, postcodes):
        to_fetch = [pc for pc in postcodes if pc and pc not in self._geo_cache]
        if to_fetch:
            for batch_start in range(0, len(to_fetch), 100):
                batch = to_fetch[batch_start:batch_start + 100]
                try:
                    body = json.dumps({"postcodes": batch}).encode()
                    req = urllib.request.Request(
                        "https://api.postcodes.io/postcodes",
                        data=body,
                        headers={"Content-Type": "application/json"},
                        method="POST")
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = json.loads(resp.read())
                    for r in data.get("result", []):
                        if r.get("result"):
                            self._geo_cache[r["query"]] = (
                                r["result"]["latitude"], r["result"]["longitude"])
                except Exception as e:
                    self._log(f"Geocode batch error: {e}", "warn")
            for pc in to_fetch:
                if pc not in self._geo_cache:
                    try:
                        url = f"https://api.postcodes.io/postcodes/{pc}"
                        req = urllib.request.Request(url)
                        with urllib.request.urlopen(req, timeout=10) as resp:
                            d = json.loads(resp.read())
                        if d.get("result"):
                            self._geo_cache[pc] = (d["result"]["latitude"], d["result"]["longitude"])
                    except Exception:
                        try:
                            url = f"https://api.postcodes.io/terminated_postcodes/{pc}"
                            req = urllib.request.Request(url)
                            with urllib.request.urlopen(req, timeout=10) as resp:
                                d = json.loads(resp.read())
                            if d.get("result"):
                                self._geo_cache[pc] = (d["result"]["latitude"], d["result"]["longitude"])
                        except Exception:
                            pass

    def _geocode_outcode(self, outcode):
        key = f"_outcode_{outcode}"
        if key in self._geo_cache:
            return self._geo_cache[key]
        try:
            url = f"https://api.postcodes.io/outcodes/{outcode}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=10) as resp:
                d = json.loads(resp.read())
            if d.get("result"):
                self._geo_cache[key] = (d["result"]["latitude"], d["result"]["longitude"])
                return self._geo_cache[key]
        except Exception:
            pass
        return None

    def _distance_label(self, metres, subject_street, comp_street, subject_addr, comp_addr):
        if subject_addr and comp_addr:
            s_parts = re.split(r'[,\s]+', subject_addr.lower())
            c_parts = re.split(r'[,\s]+', comp_addr.lower())
            if len(set(s_parts) & set(c_parts)) > 3 and metres < 50:
                return "Same building"
        if subject_street and comp_street and subject_street == comp_street:
            return "Same road"
        if metres < 50:
            return "~50m"
        rounded = round(metres / 100) * 100
        if rounded == 0:
            rounded = 100
        return f"~{int(rounded)}m"

    async def _resolve_outcode(self, page, outcode):
        if outcode in self._outcode_cache:
            return self._outcode_cache[outcode]
        try:
            current = page.url or ""
            if "rightmove.co.uk" not in current:
                await page.goto("https://www.rightmove.co.uk/property-to-rent.html",
                                wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(1)
            result = await page.evaluate('''async (outcode) => {
                try {
                    const r = await fetch("https://los.rightmove.co.uk/typeahead?query=" + encodeURIComponent(outcode) + "&limit=5&exclude=", {
                        headers: {"Referer": "https://www.rightmove.co.uk/"}
                    });
                    const data = await r.json();
                    const match = (data.matches || data.typeAheadLocations || []).find(
                        m => m.type === "OUTCODE" && m.displayName.toUpperCase() === outcode.toUpperCase()
                    );
                    if (match) return "OUTCODE%5E" + match.id;
                    const first = (data.matches || data.typeAheadLocations || [])[0];
                    if (first) return first.type + "%5E" + first.id;
                    return null;
                } catch(e) { return null; }
            }''', outcode)
            if result:
                self._outcode_cache[outcode] = result
            return result
        except Exception as e:
            self._log(f"  Outcode resolution error for {outcode}: {e}", "warn")
        return None

    async def _dismiss_cookies(self, page):
        try:
            accept_btn = page.locator('#onetrust-accept-btn-handler')
            await accept_btn.click(timeout=3000)
            await asyncio.sleep(0.5)
        except Exception:
            try:
                await page.evaluate('document.getElementById("onetrust-consent-sdk")?.remove()')
            except Exception:
                pass

    async def _scrape_sold_page(self, page):
        return await page.evaluate('''() => {
            const cards = document.querySelectorAll('a[data-testid="propertyCard"]');
            const out = [];
            for (const card of cards) {
                const title = card.querySelector("h2")?.textContent?.trim() || "";
                const href = card.href || "";
                let beds = "", ptype = "";
                card.querySelectorAll("[aria-label]").forEach(el => {
                    const al = el.getAttribute("aria-label") || "";
                    if (al.startsWith("Bedrooms:")) beds = al.replace("Bedrooms: ","").replace(".","");
                    if (al.startsWith("Property Type:")) ptype = al.replace("Property Type: ","").replace(".","");
                });
                const rows = card.querySelectorAll("tr");
                let price = "", dateSold = "";
                for (const r of rows) {
                    const cells = r.querySelectorAll("td");
                    if (cells.length >= 2) {
                        const p = cells[1].textContent.trim();
                        if (p.includes("£")) {
                            price = p; dateSold = cells[0].textContent.trim();
                            break;
                        }
                    }
                }
                if (price && title) {
                    out.push({address: title, price, beds, property_type: ptype, date: dateSold, url: href});
                }
            }
            return out;
        }''')

    def _get_nearby_postcodes(self, postcode, radius=200, limit=None):
        """Get postcodes within radius metres using postcodes.io/nearest."""
        pc_clean = postcode.replace(" ", "")
        if limit is None:
            limit = max(20, min(100, radius // 8))  # wider radius needs more postcodes
        try:
            url = f"https://api.postcodes.io/postcodes/{pc_clean}/nearest?limit={limit}&radius={radius}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
            results = []
            for r in data.get("result", []):
                pc = r.get("postcode", "")
                dist = r.get("distance", 0)
                results.append((pc, dist))
            self._log(f"  postcodes.io: {len(results)} postcodes within {radius}m of {postcode}")
            return results
        except Exception as e:
            self._log(f"  postcodes.io failed: {e}", "warn")
            return [(postcode, 0)]

    def _lr_db_path(self):
        return Path(__file__).parent / "data" / "land_registry.db"

    @staticmethod
    def _lr_types_for(subject_property_type):
        """Map a listing's property type to Land Registry type(s). Never mix
        flats with houses — RICS comparable rule."""
        t = (subject_property_type or "").lower()
        if any(k in t for k in ("flat", "apartment", "maisonette", "studio")):
            return ("flat",)
        if "terrace" in t:
            return ("terraced",)
        if "semi" in t:
            return ("semi-detached",)
        if "detached" in t:
            return ("detached",)
        if any(k in t for k in ("house", "bungalow", "cottage")):
            return ("terraced", "semi-detached", "detached")
        return ("flat",)  # unknown — Hugo's pipeline is flats

    def _lr_fetch_local(self, postcodes, min_date="2020-01-01", property_types=("flat",)):
        """Query the local Land Registry SQLite database by postcodes.
        Excludes new-build first sales (14-52% premium pollutes comps)."""
        import sqlite3
        db_path = self._lr_db_path()
        if not db_path.exists():
            self._log("  Land Registry local DB not found — run build_land_registry_db.py first", "warn")
            return []
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        pc_ph = ",".join("?" for _ in postcodes)
        ty_ph = ",".join("?" for _ in property_types)
        rows = conn.execute(
            f"""SELECT price, date, postcode, property_type, paon, saon, street, town
                FROM sold_prices
                WHERE postcode IN ({pc_ph})
                  AND property_type IN ({ty_ph})
                  AND new_build = 0
                  AND date >= ?
                ORDER BY date DESC
                LIMIT 150""",
            [*postcodes, *property_types, min_date]
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def _lr_fetch_by_street(self, street_name, outcode, min_date="2020-01-01", property_types=("flat",)):
        """Query local Land Registry DB by street name + outcode area. Street-first search."""
        import sqlite3
        db_path = self._lr_db_path()
        if not db_path.exists():
            return []
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        ty_ph = ",".join("?" for _ in property_types)
        rows = conn.execute(
            f"""SELECT price, date, postcode, property_type, paon, saon, street, town
               FROM sold_prices
               WHERE street = ?
                 AND postcode LIKE ?
                 AND property_type IN ({ty_ph})
                 AND new_build = 0
                 AND date >= ?
               ORDER BY date DESC
               LIMIT 50""",
            [street_name.upper(), outcode + "%", *property_types, min_date]
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    def _lr_fetch_api(self, pc_encoded, min_date="2020-01-01", max_retries=3):
        """Fallback: fetch from Land Registry API with retries."""
        import ssl
        ctx = ssl.create_default_context()
        for attempt in range(max_retries):
            try:
                api_url = (f"https://landregistry.data.gov.uk/data/ppi/transaction-record.json"
                           f"?propertyAddress.postcode={pc_encoded}"
                           f"&_pageSize=50&_sort=-transactionDate"
                           f"&min-transactionDate={min_date}")
                req = urllib.request.Request(api_url, headers={
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0"
                })
                with urllib.request.urlopen(req, timeout=90, context=ctx) as resp:
                    return json.loads(resp.read()).get("result", {}).get("items", [])
            except Exception as e:
                if attempt < max_retries - 1:
                    import time
                    time.sleep(2 * (attempt + 1))
                else:
                    self._log(f"  Land Registry API ({pc_encoded}) failed after {max_retries} tries: {e}", "warn")
        return []

    def _search_land_registry(self, postcode, subject_addr, radius=200,
                              property_types=("flat",), include_street=True):
        """Search Land Registry: street name first, then nearby postcodes
        within `radius` metres. Uses local SQLite DB (instant)."""
        subject_street = self._extract_street(subject_addr)
        subject_pc = self._extract_full_postcode(subject_addr)
        outcode = self._extract_outcode(subject_addr) or postcode.split()[0]
        is_full_pc = bool(subject_pc) or " " in postcode

        subject_key = (subject_pc or postcode).replace(" ", "")
        subject_geo = self._geo_cache.get(subject_key)
        if not subject_geo:
            self._geocode_postcodes([subject_key])
            subject_geo = self._geo_cache.get(subject_key)

        results = []
        use_local = self._lr_db_path().exists()

        if not use_local:
            self._log("  No local DB — skipping Land Registry search", "warn")
            return []

        if subject_street:
            street_rows = self._lr_fetch_by_street(subject_street, outcode, min_date="2020-01-01", property_types=property_types)
            if include_street:
                self._log(f"  LR street search '{subject_street}' in {outcode}: {len(street_rows)} sales")
        else:
            street_rows = []
        if not include_street:
            street_kept = street_rows
            street_rows = []
        else:
            street_kept = street_rows

        # Listings often expose only the outcode (e.g. "M15"). The street's own
        # Land Registry sales carry full postcodes — borrow the most common one
        # as the anchor so the radius search can still run.
        if not is_full_pc and street_kept:
            from collections import Counter
            pcs = [r.get("postcode", "") for r in street_kept if r.get("postcode")]
            if pcs:
                postcode = Counter(pcs).most_common(1)[0][0]
                is_full_pc = True
                subject_key = postcode.replace(" ", "")
                if not self._geo_cache.get(subject_key):
                    self._geocode_postcodes([subject_key])
                subject_geo = self._geo_cache.get(subject_key)
                self._log(f"  No full postcode on listing — anchoring radius search at {postcode} (from street sales)")

        pc_rows = []
        nearby = []
        if is_full_pc:
            nearby = self._get_nearby_postcodes(postcode, radius=radius)
            nearby_pcs = [pc for pc, _ in nearby]
            pc_rows = self._lr_fetch_local(nearby_pcs, min_date="2020-01-01", property_types=property_types)
            self._log(f"  LR postcode search ({radius}m, {len(nearby_pcs)} postcodes): {len(pc_rows)} sales")
        else:
            self._log(f"  No full postcode and no street sales — cannot widen search", "warn")

        all_rows = street_rows + pc_rows
        seen_keys = set()
        deduped = []
        for row in all_rows:
            key = (row.get("saon", ""), row.get("paon", ""), row.get("street", ""), row["price"], row["date"])
            if key not in seen_keys:
                seen_keys.add(key)
                deduped.append(row)

        all_pcs = list({r["postcode"].replace(" ", "") for r in deduped})
        self._geocode_postcodes(all_pcs)

        for row in deduped:
            pc = row["postcode"]
            pc_clean = pc.replace(" ", "")
            paon = row.get("paon") or ""
            saon = row.get("saon") or ""
            street = row.get("street") or ""
            full_addr = f"{saon} {paon} {street}".strip()

            comp_geo = self._geo_cache.get(pc_clean)
            if subject_geo and comp_geo:
                dist = self._haversine(subject_geo[0], subject_geo[1], comp_geo[0], comp_geo[1])
            elif nearby:
                pc_dist = next((d for p, d in nearby if p == pc), 200)
                dist = pc_dist
            else:
                dist = 0

            comp_street = self._extract_street(full_addr)
            dist_label = self._distance_label(
                dist, subject_street, comp_street, subject_addr, full_addr)

            results.append({
                "address": full_addr,
                "postcode": pc,
                "price": f"£{row['price']:,}",
                "beds": "",
                "property_type": (row.get("property_type") or "Flat").title(),
                "date": row["date"],
                "url": "",
                "distance_m": str(int(dist)),
                "distance_label": dist_label,
                "source": "Land Registry"
            })

        results.sort(key=lambda r: (int(r.get("distance_m") or 999999), -self._parse_year(r.get("date", ""))))
        self._log(f"  Land Registry total: {len(results)} unique sales (street: {len(street_rows)}, nearby: {len(pc_rows)})")
        return results

    EPC_API_BASE = "https://api.get-energy-performance-data.communities.gov.uk"
    EPC_API_TOKEN = os.environ.get("EPC_API_TOKEN", "j2FmY1xN91LyvbN4ZQ17ewzBriwtcmUsiDaph1lsyAITh0iS16lYkQhF6kCFv9mW")

    def _epc_search(self, postcode):
        """Search EPC API by postcode. Returns list of certificate summaries."""
        import ssl
        ctx = ssl.create_default_context()
        pc_encoded = urllib.parse.quote(postcode)
        url = f"{self.EPC_API_BASE}/api/domestic/search?postcode={pc_encoded}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.EPC_API_TOKEN}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                return json.loads(resp.read()).get("data", [])
        except Exception as e:
            self._log(f"    EPC search failed for {postcode}: {e}", "warn")
            return []

    def _epc_get_certificate(self, cert_number):
        """Fetch full certificate details by certificate number."""
        import ssl
        ctx = ssl.create_default_context()
        url = f"{self.EPC_API_BASE}/api/certificate?certificate_number={cert_number}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.EPC_API_TOKEN}",
            "Accept": "application/json"
        })
        try:
            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                return json.loads(resp.read()).get("data", {})
        except Exception as e:
            self._log(f"    EPC cert fetch failed: {e}", "warn")
            return {}

    def _epc_find_match(self, postcode, address):
        """Find the best matching EPC certificate for an address and return floor area + rooms."""
        certs = self._epc_search(postcode)
        if not certs:
            return None

        addr_upper = address.upper()
        flat_match = re.match(r'(?:FLAT|Flat|flat)\s*(\d+)', address, re.IGNORECASE)
        flat_num = flat_match.group(1) if flat_match else ""
        number_match = re.match(r'(\d+)', address)
        number = number_match.group(1) if number_match else ""

        best = None
        for cert in certs:
            line1 = (cert.get("addressLine1") or "").upper()
            line2 = (cert.get("addressLine2") or "").upper()
            combined = f"{line1} {line2}"
            if flat_num and f"FLAT {flat_num}" in combined:
                best = cert
                break
            if number and number in line1:
                best = cert

        if not best and certs:
            best = certs[0]

        if not best:
            return None

        full = self._epc_get_certificate(best["certificateNumber"])
        if not full:
            return None

        floor_area = str(full.get("total_floor_area", ""))
        rooms = str(full.get("habitable_room_count", ""))

        if floor_area or rooms:
            self._log(f"    EPC API: {address[:30]} = {floor_area} sqm, {rooms} rooms")

        return {
            "floor_area": floor_area or None,
            "habitable_rooms": rooms or None
        }

    async def _lookup_epc_floor_area(self, page, postcode, address):
        """Look up floor area + habitable rooms via EPC API (no browser needed).
        Falls back to website scraping if API fails."""
        result = self._epc_find_match(postcode, address)
        if result:
            return result

        try:
            search_url = f"https://find-energy-certificate.service.gov.uk/find-a-certificate/search-by-postcode?postcode={urllib.parse.quote(postcode)}"
            await page.goto(search_url, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)

            number = re.match(r'(\d+)', address)
            number_str = number.group(1) if number else ""

            link_result = await page.evaluate(f'''() => {{
                const links = Array.from(document.querySelectorAll("a"));
                const target = "{number_str}";
                for (const link of links) {{
                    const text = link.textContent.trim();
                    if (target && text.includes(target) && link.href.includes("energy-certificate")) {{
                        return link.href;
                    }}
                }}
                return null;
            }}''')

            if not link_result:
                return None

            await page.goto(link_result, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(1)

            epc_data = await page.evaluate('''() => {
                const text = document.body.innerText;
                const areaMatch = text.match(/Total floor area[:\\s]*([\\d.]+)/i);
                const roomsMatch = text.match(/(?:Number of habitable rooms|Habitable rooms)[:\\s]*([\\d]+)/i);
                return {
                    floor_area: areaMatch ? areaMatch[1] : null,
                    habitable_rooms: roomsMatch ? roomsMatch[1] : null
                };
            }''')

            floor_area = epc_data.get("floor_area") if epc_data else None
            rooms = epc_data.get("habitable_rooms") if epc_data else None
            if floor_area or rooms:
                self._log(f"    EPC web: {address[:30]} = {floor_area} sqm, {rooms} rooms")
            return epc_data
        except Exception as e:
            self._log(f"    EPC fallback failed: {e}", "warn")
            return None

    async def _scrape_sold_pages(self, page, url, label, max_pages=None):
        pages = max_pages or self.PAGES_TO_SCRAPE
        results = []
        for pg in range(1, pages + 1):
            if self.stop.is_set():
                break
            try:
                page_url = url if pg == 1 else url + ("&" if "?" in url else "?") + f"page={pg}&pageNumber={pg}"
                await page.goto(page_url, wait_until="domcontentloaded", timeout=45000)
                await asyncio.sleep(3)
                if pg == 1:
                    await self._dismiss_cookies(page)
                cards = await self._scrape_sold_page(page)
                results.extend(cards)
                self._log(f"  {label} page {pg}: {len(cards)} properties")
                if len(cards) == 0:
                    break
                if pg < pages:
                    await asyncio.sleep(random.uniform(1.5, 3.0))
            except Exception as e:
                self._log(f"  {label} page {pg} error: {e}", "warn")
                break
        return results

    async def _search_sold(self, page, outcode, beds, target_beds, subject_addr):
        street = self._extract_street(subject_addr)
        full_pc = self._extract_full_postcode(subject_addr)
        all_results = []

        if full_pc:
            pc_clean = full_pc.replace(" ", "")
            pc_slug = pc_clean[:-3] + "-" + pc_clean[-3:]
            pc_url = f"https://www.rightmove.co.uk/house-prices/{pc_slug}.html?propertyType=FLAT"
            self._log(f"Searching sold FLATS in {full_pc} (same postcode)...")
            pc_results = await self._scrape_sold_pages(page, pc_url, f"Postcode ({full_pc})", max_pages=3)
            all_results.extend(pc_results)
            if pc_results:
                await self._sleep()

        if street:
            street_query = street.replace(" ", "-")
            street_url = f"https://www.rightmove.co.uk/house-prices/{street_query}/{outcode}.html?propertyType=FLAT"
            self._log(f"Searching sold FLATS on {street} in {outcode}...")
            street_results = await self._scrape_sold_pages(page, street_url, f"Street ({street})", max_pages=2)
            all_results.extend(street_results)
            if street_results:
                await self._sleep()

        outcode_url = f"https://www.rightmove.co.uk/house-prices/{outcode}.html?propertyType=FLAT"
        self._log(f"Searching sold FLATS in {outcode} (wider area)...")
        outcode_results = await self._scrape_sold_pages(page, outcode_url, outcode)
        all_results.extend(outcode_results)

        subject_pc = self._extract_full_postcode(subject_addr)
        subject_street = self._extract_street(subject_addr)
        comp_postcodes = [self._extract_full_postcode(r["address"]) for r in all_results]
        all_pcs = ([subject_pc] if subject_pc else []) + [pc for pc in comp_postcodes if pc]
        self._geocode_postcodes(list(set(all_pcs)))

        subject_geo = self._geo_cache.get(subject_pc)
        if not subject_geo:
            subject_outcode = self._extract_outcode(subject_addr)
            if subject_outcode:
                subject_geo = self._geocode_outcode(subject_outcode)
                self._log(f"Using outcode center for {subject_outcode} (no full postcode)")

        for i, r in enumerate(all_results):
            pc = comp_postcodes[i]
            comp_geo = self._geo_cache.get(pc)
            if not comp_geo and pc:
                comp_outcode = self._extract_outcode(r["address"])
                if comp_outcode:
                    comp_geo = self._geocode_outcode(comp_outcode)
            if subject_geo and comp_geo:
                dist = self._haversine(subject_geo[0], subject_geo[1], comp_geo[0], comp_geo[1])
                comp_street = self._extract_street(r["address"])
                r["distance_m"] = str(int(dist))
                r["distance_label"] = self._distance_label(dist, subject_street, comp_street, subject_addr, r["address"])
            else:
                r["distance_m"] = ""
                r["distance_label"] = ""

        seen_urls = set()
        unique = []
        for r in all_results:
            if r["url"] and r["url"] in seen_urls:
                continue
            if r["url"]:
                seen_urls.add(r["url"])
            unique.append(r)

        has_distance = [r for r in unique if r.get("distance_m")]
        has_distance.sort(key=lambda r: self._sort_key(r))

        flat_types = {"flat", "apartment", "maisonette", "penthouse", "studio"}
        def is_flat(r):
            return (r.get("property_type") or "").strip().lower() in flat_types

        def pick_best(pool, count=5):
            same_bld = [r for r in pool if "Same building" in (r.get("distance_label") or "")]
            same_rd = [r for r in pool if "Same road" in (r.get("distance_label") or "") and r not in same_bld]
            within_200 = [r for r in pool if int(r.get("distance_m") or 999999) <= 200 and r not in same_bld and r not in same_rd]
            selected = (same_bld + same_rd + within_200)[:count]
            recent = [r for r in selected if self._parse_year(r.get("date", "")) >= 2023]
            selected = recent[:count] if len(recent) >= 3 else selected[:count]
            if len(selected) >= 3:
                prices = [int(re.sub(r'[^0-9]', '', r["price"])) for r in selected if re.sub(r'[^0-9]', '', r["price"])]
                if prices:
                    median = sorted(prices)[len(prices) // 2]
                    selected = [r for r in selected
                                if abs(int(re.sub(r'[^0-9]', '', r["price"])) - median) < median * 0.6]
            return selected[:count]

        same_bed_pool = [r for r in has_distance if r["beds"] == str(beds) and is_flat(r)]
        target_bed_pool = [r for r in has_distance if r["beds"] == str(target_beds) and is_flat(r)]

        same_bed_comps = pick_best(same_bed_pool)
        target_bed_comps = pick_best(target_bed_pool)

        within_200_target = [r for r in target_bed_comps if int(r.get("distance_m") or 999999) <= 200]
        if len(within_200_target) < 3:
            self._log(f"  WARNING: Only {len(within_200_target)} target-bed sold comps within 200m", "warn")

        self._log(f"  Found {len(same_bed_comps)} same-bed ({beds}-bed) + {len(target_bed_comps)} target-bed ({target_beds}-bed) sold comps")
        return same_bed_comps, target_bed_comps

    async def _search_rent(self, page, outcode_id, target_beds, subject_addr):
        url = (f"https://www.rightmove.co.uk/property-to-rent/find.html"
               f"?locationIdentifier={outcode_id}&minBedrooms={target_beds}"
               f"&maxBedrooms={target_beds}&radius=0.25"
               f"&includeLetAgreed=true&sortType=6")
        self._log(f"Searching rentals for {target_beds}-bed...")

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(3)
            await self._dismiss_cookies(page)
        except Exception as e:
            self._log(f"Error loading rentals: {e}", "error")
            return []

        results = await page.evaluate('''() => {
            const cards = document.querySelectorAll('[class*="propertyCard-details"]');
            return Array.from(cards).slice(0, 15).map(card => {
                const anchor = card.querySelector('a[id^="prop"]');
                const propId = anchor ? anchor.id.replace('prop','') : '';
                const priceEl = card.querySelector('[data-testid="property-price"]');
                let price = priceEl ? priceEl.textContent.trim() : '';
                const priceMatch = price.match(/£[\\d,]+/);
                if (priceMatch) price = priceMatch[0];
                const addrEl = card.querySelector('[data-testid="property-address"]');
                const address = addrEl ? addrEl.textContent.trim() : '';
                const infoEl = card.querySelector('[data-testid="property-information"]');
                const info = infoEl ? infoEl.textContent.trim() : '';
                const typeMatch = info.match(/^([A-Za-z\\s-]+)/);
                const propType = typeMatch ? typeMatch[1].trim() : '';
                const bedMatch = info.match(/[A-Za-z\\s-]+(\\d)/);
                const beds = bedMatch ? bedMatch[1] : '';
                const url = propId ? 'https://www.rightmove.co.uk/properties/' + propId : '';
                return {address, price, beds, property_type: propType, date: 'pcm', url};
            }).filter(r => r.price && r.address);
        }''')

        subject_pc = self._extract_full_postcode(subject_addr)
        subject_street = self._extract_street(subject_addr)
        comp_postcodes = [self._extract_full_postcode(r["address"]) for r in results]
        all_pcs = ([subject_pc] if subject_pc else []) + [pc for pc in comp_postcodes if pc]
        self._geocode_postcodes(list(set(all_pcs)))

        subject_geo = self._geo_cache.get(subject_pc)
        if not subject_geo:
            subject_outcode = self._extract_outcode(subject_addr)
            if subject_outcode:
                subject_geo = self._geocode_outcode(subject_outcode)
        for i, r in enumerate(results):
            pc = comp_postcodes[i]
            comp_geo = self._geo_cache.get(pc)
            if not comp_geo:
                comp_outcode = self._extract_outcode(r["address"])
                if comp_outcode:
                    comp_geo = self._geocode_outcode(comp_outcode)
            if subject_geo and comp_geo:
                dist = self._haversine(subject_geo[0], subject_geo[1], comp_geo[0], comp_geo[1])
                comp_street = self._extract_street(r["address"])
                r["distance_m"] = str(int(dist))
                r["distance_label"] = self._distance_label(dist, subject_street, comp_street, subject_addr, r["address"])
            else:
                r["distance_m"] = ""
                r["distance_label"] = ""

        has_distance = [r for r in results if r.get("distance_m")]
        has_distance.sort(key=lambda r: self._sort_key(r))

        MAX_DISTANCE = 400
        relevant = [r for r in has_distance if int(r.get("distance_m") or 999999) <= MAX_DISTANCE]
        if len(relevant) < 3:
            relevant = has_distance[:5]
        return relevant[:5]

    async def run(self, properties):
        self.metrics["total"] = len(properties)
        self._push_metrics()

        async with async_playwright() as pw:
            kwargs = dict(
                headless=self.headless,
                args=["--disable-blink-features=AutomationControlled",
                      "--disable-dev-shm-usage", "--no-default-browser-check", "--no-first-run"],
            )
            proxy_arg = self.proxy.playwright_proxy()
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

                for i, prop in enumerate(properties):
                    if self.stop.is_set():
                        break
                    await self._wait_unpaused()

                    pid = prop["property_id"]
                    address = prop.get("address", "")
                    beds = int(prop.get("bedrooms") or 1)
                    target_beds = beds + 1

                    self.metrics["current"] = f"{address} ({i+1}/{len(properties)})"
                    self._push_metrics()

                    outcode = self._extract_outcode(address)
                    if not outcode:
                        self._log(f"{pid}: no postcode found in address, skipping", "warn")
                        self.metrics["done"] += 1
                        self._push_metrics()
                        continue

                    self._log(f"Property: {address} ({beds}-bed) -> searching {beds}-bed + {target_beds}-bed comps in {outcode}")
                    self.storage.clear_comps(pid)

                    full_pc = self._extract_full_postcode(address)
                    search_pc = full_pc or outcode

                    # === STEP 1: Land Registry DB — widening ladder until 5+5 comps ===
                    # 200m → 500m → 800m (the valuation engine weights distance,
                    # so far comps inform without dominating). EPC estimates beds.
                    ptypes = self._lr_types_for(prop.get("property_type"))
                    same_bed_comps, target_bed_comps = [], []
                    classified_keys = set()
                    epc_budget = 45  # ~0.5s per lookup — keeps a property under ~25s

                    for radius in (200, 500, 800):
                        if self.stop.is_set():
                            break
                        lr_results = self._search_land_registry(
                            search_pc, address, radius=radius, property_types=ptypes,
                            include_street=(radius == 200))
                        fresh = []
                        for lr in lr_results:
                            key = (lr.get("address", "").lower(), lr.get("price", ""), lr.get("date", ""))
                            if key not in classified_keys:
                                classified_keys.add(key)
                                fresh.append(lr)
                        fresh = fresh[:30]
                        if fresh:
                            self._log(f"  Looking up EPC for {len(fresh)} Land Registry sales ({radius}m ring) to estimate beds...")
                        for lr in fresh:
                            if self.stop.is_set() or epc_budget <= 0:
                                break
                            lr_pc = lr.get("postcode", "") or self._extract_full_postcode(lr.get("address", ""))
                            if lr_pc:
                                lr_pc_fmt = lr_pc if " " in lr_pc else (lr_pc[:-3] + " " + lr_pc[-3:])
                                epc = self._epc_find_match(lr_pc_fmt, lr.get("address", ""))
                                epc_budget -= 1
                                if epc:
                                    lr["floor_area_sqm"] = epc.get("floor_area") or ""
                                    rooms = epc.get("habitable_rooms")
                                    if rooms:
                                        est_beds = max(1, int(rooms) - 1)
                                        lr["beds"] = str(est_beds)
                                    elif lr["floor_area_sqm"]:
                                        sqm = float(lr["floor_area_sqm"])
                                        lr["beds"] = "1" if sqm <= 50 else ("2" if sqm <= 75 else "3")
                                await asyncio.sleep(random.uniform(0.3, 0.6))
                            if lr.get("beds") == str(beds):
                                same_bed_comps.append(lr)
                            elif lr.get("beds") == str(target_beds):
                                target_bed_comps.append(lr)
                        self._log(f"  After {radius}m ring: {len(same_bed_comps)} same-bed ({beds}), "
                                  f"{len(target_bed_comps)} target-bed ({target_beds})")
                        if len(same_bed_comps) >= 5 and len(target_bed_comps) >= 5:
                            break

                    # === STEP 2: Zoopla sold pages (fallback — only if LR didn't find enough) ===
                    if len(same_bed_comps) < 5 or len(target_bed_comps) < 5:
                        self._log(f"  Not enough from LR — supplementing with Zoopla sold pages...")
                        z_same, z_target = await self._search_zoopla_sold(page, address, beds, target_beds)

                        existing_addrs_s = {s.get("address", "").lower() for s in same_bed_comps}
                        existing_addrs_t = {s.get("address", "").lower() for s in target_bed_comps}
                        for z in z_same:
                            if z["address"].lower() not in existing_addrs_s and len(same_bed_comps) < 5:
                                same_bed_comps.append(z)
                        for z in z_target:
                            if z["address"].lower() not in existing_addrs_t and len(target_bed_comps) < 5:
                                target_bed_comps.append(z)

                    # Selection: nearest first; when we know the subject's size,
                    # size-similar comps (0.7–1.4×) outrank size-mismatched ones.
                    subj_sqm = 0.0
                    try:
                        subj_sqm = float(prop.get("floor_area_sqm") or 0)
                    except (TypeError, ValueError):
                        pass

                    def comp_rank(r):
                        dist = int(r.get("distance_m") or 999999)
                        size_penalty = 0
                        if subj_sqm > 0:
                            try:
                                c_sqm = float(r.get("floor_area_sqm") or 0)
                            except (TypeError, ValueError):
                                c_sqm = 0
                            if c_sqm > 0 and not (0.7 * subj_sqm <= c_sqm <= 1.4 * subj_sqm):
                                size_penalty = 1
                        return (size_penalty, dist)

                    same_bed_comps.sort(key=comp_rank)
                    target_bed_comps.sort(key=comp_rank)
                    same_bed_comps = same_bed_comps[:5]
                    target_bed_comps = target_bed_comps[:5]

                    all_sold = [(comp, "sale_same") for comp in same_bed_comps] + \
                               [(comp, "sale_target") for comp in target_bed_comps]

                    # Look up floor areas for any comp missing it
                    for comp, _ in all_sold:
                        if comp.get("floor_area_sqm"):
                            continue
                        comp_pc = self._extract_full_postcode(comp.get("address", ""))
                        if comp_pc and not self.stop.is_set():
                            comp_pc_fmt = comp_pc if " " in comp_pc else (comp_pc[:-3] + " " + comp_pc[-3:])
                            epc = self._epc_find_match(comp_pc_fmt, comp.get("address", ""))
                            if epc:
                                comp["floor_area_sqm"] = epc.get("floor_area") or ""
                            else:
                                comp["floor_area_sqm"] = ""
                            await asyncio.sleep(random.uniform(0.3, 0.6))
                        else:
                            comp["floor_area_sqm"] = comp.get("floor_area_sqm", "")

                    sold_count = 0
                    for comp, comp_type in all_sold:
                        self.storage.insert_comp(
                            pid, comp_type, comp.get("address", ""), comp.get("price", ""),
                            comp.get("beds", ""), comp.get("property_type", ""),
                            comp.get("url", ""), comp.get("date", ""),
                            comp.get("distance_m", ""), comp.get("distance_label", ""),
                            comp.get("source", "Land Registry"),
                            comp.get("floor_area_sqm", ""))
                        sold_count += 1
                    self._log(f"  Saved {len(same_bed_comps)} same-bed + {len(target_bed_comps)} target-bed sold comps")
                    if len(same_bed_comps) < 3:
                        self._log(f"  ⚠ WARNING: Only {len(same_bed_comps)} same-bed comps — not enough evidence, deal unverifiable", "warn")
                    if len(target_bed_comps) < 3:
                        self._log(f"  ⚠ WARNING: Only {len(target_bed_comps)} target-bed comps — not enough evidence, deal unverifiable", "warn")

                    await self._sleep()

                    outcode_id = await self._resolve_outcode(page, outcode)
                    if outcode_id:
                        rent = await self._search_rent(page, outcode_id, target_beds, address)
                        for comp in rent:
                            self.storage.insert_comp(
                                pid, "rent", comp.get("address", ""), comp.get("price", ""),
                                comp.get("beds", ""), comp.get("property_type", ""),
                                comp.get("url", ""), comp.get("date", ""),
                                comp.get("distance_m", ""), comp.get("distance_label", ""),
                                "Rightmove")
                        self._log(f"  Found {len(rent)} rental comps in {outcode}")
                    else:
                        rent = []
                        self._log(f"  Could not resolve {outcode} for rental search", "warn")

                    self.metrics["done"] += 1
                    self._push_metrics()
                    self.emit({"type": "comp_found", "property_id": pid,
                               "sold": sold_count, "rent": len(rent)})

                    if i < len(properties) - 1:
                        await self._sleep()

                await ctx.close()
            finally:
                await browser.close()

        self._log("Comps fetch complete!", "info")
        self.emit({"type": "comp_done"})
