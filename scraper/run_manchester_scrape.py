"""Run the Rightmove scraper for Manchester rental listings."""
import asyncio, threading, json, sys
from proxies import ProxyManager
from rightmove_scraper import RightmoveScraper
import rightmove_storage

SEARCH_URL = (
    "https://www.rightmove.co.uk/property-to-rent/find.html?"
    "sortType=6&areaSizeUnit=sqft&channel=RENT&index=0"
    "&locationIdentifier=USERDEFINEDAREA%5E%7B%22polylines%22%3A%22khneIllvLwDwXs%40_%5DrV%7BmAlLiRdJwXtLcH%7CG%7BK%7CGgBrWb%40rFdIjEbPxJ%60nBbDfQRx%7E%40aLh%7E%40oChCaSlEeKs%40%7DVkDk%5CePkDaH%7D%40u%5EeJkLaDyQwEmExCzK%22%7D"
    "&transactionType=LETTING"
)


def main():
    rightmove_storage.init_db()

    # Load proxy from main scraper's config (has working iProyal proxy)
    main_config = "/Users/hugo/Whats/scraper/data/config.json"
    try:
        cfg = json.loads(open(main_config).read())
    except Exception:
        cfg = {}

    proxy = ProxyManager(
        cfg.get("host", ""), cfg.get("port", ""),
        cfg.get("username", ""), cfg.get("password", ""),
        int(cfg.get("rotate_every") or 25),
        sticky=bool(cfg.get("sticky", False)),
    )

    stop_event = threading.Event()
    pause_event = threading.Event()
    count = {"n": 0}

    def emit(ev):
        if ev.get("type") == "rm_listing":
            count["n"] += 1
            addr = ev.get("address", "?")[:50]
            price = ev.get("price", "")
            date = ev.get("listed_date", "")
            print(f"  [{count['n']}] {price} | {addr} | {date}")
        elif ev.get("type") == "log":
            level = ev.get("level", "info")
            if level in ("error", "warn", "info"):
                print(f"  [{level.upper()}] {ev.get('msg', '')}")

    scraper = RightmoveScraper(
        proxy, emit, stop_event, pause_event,
        max_pages=100,
        delay_min=2.0, delay_max=4.0,
        headless=False,
    )

    print(f"Scraping Manchester rentals from Rightmove...")
    print(f"URL: {SEARCH_URL[:80]}...")
    print()

    asyncio.run(scraper.run([SEARCH_URL], force_rescrape=True))

    # Export results
    total = rightmove_storage.count_listings()
    print(f"\nTotal listings in DB: {total}")

    fname = rightmove_storage.export_csv()
    if fname:
        print(f"Exported to: {fname}")


if __name__ == "__main__":
    main()
