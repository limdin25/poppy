"""Standalone reproducer for the proxy/Playwright issue.
Run: python playwright_test.py
"""
import asyncio, time
from playwright.async_api import async_playwright

PROXY = {
    "server":   "http://geo.iproyal.com:12321",
    "username": "Vdu0HAQu8LyxX4Hk",
    "password": "x0Hjd96ossGJWxg2_country-gb_city-manchester",
}

URL = "https://www.google.com/maps/search/plumbers+manchester/"


async def main():
    async with async_playwright() as pw:
        t = time.time()
        print(f"[{time.time()-t:5.1f}s] launching chromium…")
        browser = await pw.chromium.launch(
            headless=False,
            proxy=PROXY,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-quic",
                # Force HTTP/1.1. Residential proxies often can't tunnel h2
                # frames to google.com cleanly — TLS completes but h2 frames
                # silently disappear, which is why we saw REQ but no RES.
                # curl worked because it negotiated http/1.1 by default.
                "--disable-http2",
            ],
        )
        print(f"[{time.time()-t:5.1f}s] launched, creating context…")
        ctx = await browser.new_context(
            ignore_https_errors=True,
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"),
        )
        page = await ctx.new_page()

        # Log every navigation event so we see what Chromium thinks it's doing.
        page.on("request",  lambda r: print(f"[{time.time()-t:5.1f}s] REQ  {r.method} {r.url[:100]}"))
        page.on("response", lambda r: print(f"[{time.time()-t:5.1f}s] RES  {r.status} {r.url[:100]}"))
        page.on("requestfailed", lambda r: print(f"[{time.time()-t:5.1f}s] FAIL {r.url[:100]}  {r.failure}"))

        print(f"[{time.time()-t:5.1f}s] goto {URL}")
        try:
            await page.goto(URL, wait_until="commit", timeout=60_000)
            print(f"[{time.time()-t:5.1f}s] commit fired, page.url = {page.url}")
        except Exception as e:
            print(f"[{time.time()-t:5.1f}s] goto threw: {type(e).__name__}: {e}")

        # Hold the window open 10s so you can see it.
        await asyncio.sleep(10)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
