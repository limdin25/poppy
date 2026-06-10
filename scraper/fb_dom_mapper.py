"""Temporary script: opens Facebook Ad Library, captures actual DOM structure of ad cards."""
from __future__ import annotations
import asyncio
from playwright.async_api import async_playwright

URL = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=GB&q=leads&search_type=keyword_unordered&sort_data[direction]=desc&sort_data[mode]=total_impressions"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False)
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        page = await ctx.new_page()
        print("Navigating to Facebook Ad Library...")
        await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(3)

        # Dismiss cookie banner
        for sel in [
            'button[data-cookiebanner="accept_button"]',
            'button:has-text("Allow all cookies")',
            'button:has-text("Accept all")',
            'button:has-text("Allow essential and optional cookies")',
        ]:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=2000):
                    await btn.click()
                    print(f"Clicked cookie button: {sel}")
                    await asyncio.sleep(2)
                    break
            except Exception:
                continue

        print("Waiting for ads to load...")
        await asyncio.sleep(5)

        # Scroll once to make sure content is loaded
        await page.evaluate("window.scrollTo(0, 1000)")
        await asyncio.sleep(3)

        # Capture full page text to understand structure
        print("\n" + "=" * 80)
        print("FULL PAGE TEXT (first 5000 chars):")
        print("=" * 80)
        text = await page.evaluate("document.body.innerText")
        print(text[:5000])

        # Capture HTML of potential ad containers
        print("\n" + "=" * 80)
        print("SEARCHING FOR AD CONTAINERS...")
        print("=" * 80)

        # Try multiple selectors
        selectors_to_try = [
            'div[role="article"]',
            'div._7jvw',
            'div[class*="x1yztbdb"]',
            'div[class*="xrvj5dj"]',
            'div[class*="x1dr75xp"]',
            'div[class*="xh8yej3"]',
        ]

        for sel in selectors_to_try:
            try:
                count = await page.locator(sel).count()
                print(f"\n{sel}: {count} matches")
                if count > 0:
                    html = await page.locator(sel).first.inner_html()
                    print(f"  First match HTML (500 chars): {html[:500]}")
                    text = await page.locator(sel).first.inner_text()
                    print(f"  First match TEXT: {text[:300]}")
            except Exception as e:
                print(f"  {sel}: error - {e}")

        # Deep scan: find all elements containing "Started running"
        print("\n" + "=" * 80)
        print("SEARCHING FOR 'Started running' TEXT...")
        print("=" * 80)
        started_els = await page.locator("text=Started running").count()
        print(f"Found {started_els} elements with 'Started running'")
        if started_els > 0:
            for i in range(min(3, started_els)):
                el = page.locator("text=Started running").nth(i)
                text = await el.inner_text()
                print(f"  [{i}] text: {text}")
                # Get parent chain
                parent_html = await el.evaluate("""
                    el => {
                        let html = '';
                        let node = el;
                        for (let i = 0; i < 5; i++) {
                            node = node.parentElement;
                            if (!node) break;
                            html += `\\n  Parent ${i+1}: <${node.tagName} class="${node.className}" role="${node.getAttribute('role') || ''}">`;
                        }
                        return html;
                    }
                """)
                print(f"  Parent chain: {parent_html}")

        # Find all links to facebook pages
        print("\n" + "=" * 80)
        print("SEARCHING FOR FACEBOOK PAGE LINKS...")
        print("=" * 80)
        fb_links = await page.evaluate("""
            () => {
                const links = [];
                document.querySelectorAll('a[href]').forEach(a => {
                    const href = a.href || '';
                    const text = (a.innerText || '').trim();
                    if (href.includes('facebook.com/') &&
                        !href.includes('/ads/library') &&
                        !href.includes('/login') &&
                        !href.includes('/help') &&
                        !href.includes('/privacy') &&
                        !href.includes('/policies') &&
                        text.length > 1 && text.length < 200) {
                        links.push({href: href, text: text.substring(0, 100)});
                    }
                });
                return links.slice(0, 10);
            }
        """)
        print(f"Found {len(fb_links)} FB page links:")
        for l in fb_links:
            print(f"  {l['text']} -> {l['href']}")

        # Find external website links
        print("\n" + "=" * 80)
        print("SEARCHING FOR EXTERNAL WEBSITE LINKS...")
        print("=" * 80)
        ext_links = await page.evaluate("""
            () => {
                const links = [];
                document.querySelectorAll('a[href]').forEach(a => {
                    const href = a.href || '';
                    if (href.startsWith('http') &&
                        !href.includes('facebook.com') &&
                        !href.includes('instagram.com') &&
                        !href.includes('fb.com') &&
                        !href.includes('fbcdn.net')) {
                        links.push({href: href, text: (a.innerText || '').trim().substring(0, 80)});
                    }
                });
                return links.slice(0, 15);
            }
        """)
        print(f"Found {len(ext_links)} external links:")
        for l in ext_links:
            print(f"  {l['text']} -> {l['href']}")

        # Try to find the ad card structure by looking at what contains "Active" or "Started"
        print("\n" + "=" * 80)
        print("MAPPING AD CARD STRUCTURE (via JS)...")
        print("=" * 80)
        card_data = await page.evaluate("""
            () => {
                const results = [];
                // Find all text nodes containing "Started running"
                const walker = document.createTreeWalker(
                    document.body, NodeFilter.SHOW_TEXT,
                    { acceptNode: n => n.textContent.includes('Started running') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
                );
                let node;
                let count = 0;
                while ((node = walker.nextNode()) && count < 3) {
                    count++;
                    // Walk up to find the ad container
                    let container = node.parentElement;
                    let depth = 0;
                    let cardInfo = { depth_to_container: 0, container_tag: '', container_classes: '' };

                    // Walk up until we find a significant container
                    for (let i = 0; i < 20; i++) {
                        if (!container.parentElement) break;
                        container = container.parentElement;
                        depth++;
                        // Check if this looks like an ad card boundary
                        const kids = container.children.length;
                        const width = container.offsetWidth;
                        if (width > 600 && kids >= 3 && depth >= 3) {
                            cardInfo.depth_to_container = depth;
                            cardInfo.container_tag = container.tagName;
                            cardInfo.container_classes = container.className.substring(0, 200);
                            cardInfo.container_role = container.getAttribute('role') || '';
                            cardInfo.container_width = width;
                            cardInfo.container_children = kids;

                            // Now extract all the data from this container
                            const text = container.innerText;
                            cardInfo.full_text = text.substring(0, 1000);

                            // Get all links
                            const links = [];
                            container.querySelectorAll('a[href]').forEach(a => {
                                links.push({href: a.href, text: (a.innerText || '').trim().substring(0, 80)});
                            });
                            cardInfo.links = links;

                            // Get the outer HTML structure (first 2000 chars)
                            cardInfo.outer_html_preview = container.outerHTML.substring(0, 2000);
                            break;
                        }
                    }
                    results.push(cardInfo);
                }
                return results;
            }
        """)
        for i, card in enumerate(card_data):
            print(f"\n--- AD CARD {i+1} ---")
            print(f"Container: <{card.get('container_tag', '?')}> classes={card.get('container_classes', '')[:100]}")
            print(f"Role: {card.get('container_role', '')}, Width: {card.get('container_width', 0)}, Children: {card.get('container_children', 0)}")
            print(f"Depth from 'Started running' to container: {card.get('depth_to_container', 0)}")
            print(f"\nFULL TEXT:\n{card.get('full_text', '')[:600]}")
            print(f"\nLINKS:")
            for l in card.get('links', []):
                print(f"  {l['text'][:50]} -> {l['href'][:100]}")
            print(f"\nHTML PREVIEW:\n{card.get('outer_html_preview', '')[:800]}")

        # Search for platform indicators
        print("\n" + "=" * 80)
        print("PLATFORM INDICATORS...")
        print("=" * 80)
        platforms = await page.evaluate("""
            () => {
                const items = [];
                // Check for platform-related images
                document.querySelectorAll('img').forEach(img => {
                    const alt = img.alt || '';
                    const src = img.src || '';
                    if (alt.toLowerCase().match(/facebook|instagram|messenger|audience/)) {
                        items.push({type: 'img', alt: alt, src: src.substring(0, 100)});
                    }
                });
                // Check for platform-related SVGs or icons
                document.querySelectorAll('svg title, [aria-label*="Facebook"], [aria-label*="Instagram"]').forEach(el => {
                    items.push({type: el.tagName, text: el.textContent || el.getAttribute('aria-label') || ''});
                });
                return items.slice(0, 20);
            }
        """)
        for p in platforms:
            print(f"  {p}")

        print("\n" + "=" * 80)
        print("DONE — closing browser")
        print("=" * 80)
        await browser.close()

asyncio.run(main())
