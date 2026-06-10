"""Standalone scraper worker — runs ONE slice of locations as a 2nd parallel
instance, writing to the same shared database. Usage:

    .venv/bin/python run_slice.py data/slice_b.txt

Mirrors the app's Google-Maps scrape settings (keyword 'plumber', 120 cap,
URL/fast mode, no proxy). Disjoint slices mean it never overlaps instance #1.
"""
import sys, asyncio, threading
import storage
from proxies import ProxyManager
from scraper import Scraper


def emit(ev):
    t = ev.get("type")
    if t == "log":
        print(f"[{ev.get('level', 'info')}] {ev.get('msg', '')}", flush=True)
    elif t in ("done", "captcha"):
        print(f"== {t} ==", flush=True)


async def main(slice_path):
    locs = [l.strip() for l in open(slice_path).read().splitlines() if l.strip()]
    jobs = [("plumber", loc) for loc in locs]
    print(f"instance-B starting: {len(jobs)} areas from {slice_path}", flush=True)

    storage.init_db()
    pm = ProxyManager("", "", "", "", 25, sticky=False)
    sc = Scraper(
        proxy_mgr=pm,
        emit=emit,
        stop_event=threading.Event(),
        pause_event=threading.Event(),
        max_per_query=120,
        delay_min=1, delay_max=2,
        headless=True,
        full_details=False,
    )
    await sc.run(jobs, force_rescrape=False)
    print("instance-B finished.", flush=True)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
