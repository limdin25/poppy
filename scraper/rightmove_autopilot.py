#!/usr/bin/env python3
"""rightmove_autopilot.py — daily Rightmove scrape + floor-plan chain.

Triggered by the rightmove-autopilot.timer systemd unit once a day.

Pipeline (executed serially in this single script):
  1. Augment each saved search URL with `maxDaysSinceAdded=1` so we only
     hit listings added in the last 24h.
  2. POST /api/rightmove/start to begin the listing scrape. The scraper
     already dedupes by listing URL, so re-running daily only inserts
     genuinely new rows.
  3. Poll /api/rightmove/status until running=False. Scrape typically
     takes 30-90 min depending on Rightmove load + number of URLs.
  4. POST /api/floorplans/fetch with:
       exclude_tenanted=true  (Hugo's BRRRR rule: never buy tenanted)
       exclude_auction=false  (auction sales can still BRRRR)
       headless=true          (no visible browser window on the server)
     The fetcher visits each property page, grabs floor plan images +
     EPC floor area + agent details. Properties without a floor plan
     get auto-skipped (set_review_if_unset to 'skip') so they don't
     clutter /floorplans.
  5. Poll /api/floorplans/status until done. Floor-plan fetcher usually
     runs ~60-120 min for a batch of new listings.

Total wall time: 1.5-3 hours per day. The systemd unit has a 6-hour
TimeoutStartSec to give the whole pipeline plenty of headroom before
systemd would kill it.

Concurrency safety: if a manual run is already in progress when the
timer fires (Hugo testing during the day), we exit silently. The "/start"
endpoints return 400 "already running" which we treat as a no-op tick.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

API_BASE = "http://127.0.0.1:5001"
CONFIG_PATH = "/opt/margarita/scraper/data/rm_config.json"

# Floor-plan fetch options — Hugo's defaults for the daily run.
FP_OPTIONS = {
    "exclude_tenanted": True,
    "exclude_auction": False,
    "headless": True,
}

POLL_INTERVAL_SEC = 30           # how often we hit /status
RM_MAX_RUNTIME_SEC = 4 * 3600    # bail after 4h on rightmove (it should never take this long)
FP_MAX_RUNTIME_SEC = 4 * 3600    # ditto for floorplans


def augment_url(url: str) -> str:
    """Add maxDaysSinceAdded=1 to a Rightmove search URL.

    Idempotent: if the parameter is already present we just overwrite it
    with 1 so manual edits (e.g. maxDaysSinceAdded=7) get normalised back
    to the autopilot's 24-hour window.
    """
    parts = urllib.parse.urlsplit(url)
    qs = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    qs["maxDaysSinceAdded"] = "1"
    new_query = urllib.parse.urlencode(qs)
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, new_query, parts.fragment)
    )


def post_json(path: str, payload: dict) -> tuple[bool, str]:
    """POST JSON to a Flask endpoint. Returns (ok, body). 'already running'
    is treated as ok=True so a chained call from a manual run is a no-op."""
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return True, r.read().decode()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")
        if "already running" in body:
            return True, f"already running ({path})"
        return False, f"{e.code}: {body}"
    except Exception as e:
        return False, str(e)


def get_running(path: str) -> bool | None:
    """Poll a /status endpoint. Returns the 'running' flag or None on error."""
    try:
        with urllib.request.urlopen(f"{API_BASE}{path}", timeout=10) as r:
            data = json.loads(r.read().decode())
            return bool(data.get("running", False))
    except Exception:
        return None


def wait_until_done(path: str, label: str, max_runtime: int) -> bool:
    """Poll until the named job stops running. Returns True on clean exit,
    False if we hit max_runtime. The first poll happens after a 30s grace
    period so we don't immediately race the worker thread that just spawned."""
    print(f"[autopilot] waiting for {label} to finish…")
    time.sleep(POLL_INTERVAL_SEC)
    deadline = time.time() + max_runtime
    while time.time() < deadline:
        running = get_running(path)
        if running is None:
            print(f"[autopilot] {label} status probe failed — retry in {POLL_INTERVAL_SEC}s")
        elif not running:
            print(f"[autopilot] {label} done.")
            return True
        time.sleep(POLL_INTERVAL_SEC)
    print(f"[autopilot] {label} EXCEEDED {max_runtime}s — abandoning.")
    return False


def step_rightmove(cfg: dict) -> bool:
    urls = [u.strip() for u in cfg.get("search_urls", "").splitlines() if u.strip()]
    if not urls:
        print("[autopilot] No search URLs in config — abort.")
        return False
    augmented = [augment_url(u) for u in urls]
    # force_rescrape=True is essential here. Without it the scraper's
    # rm_scraped_urls cache makes the daily run a no-op from day 2
    # onwards — the search URLs (already with maxDaysSinceAdded=1) are
    # remembered as "already done" so the worker logs
    # "Skipping already scraped" for every one and the session ends with
    # 0 listings new + 0 duplicates + 0 errors. Listing-level dedup
    # (the part Hugo cares about) is separate and still works: the
    # scraper checks each individual property URL against rm_listings
    # before inserting. Found 2026-06-02 — daily runs since May 31 had
    # been zero-results because of this.
    payload = {**cfg, "search_urls": "\n".join(augmented), "force_rescrape": True}
    print(f"[autopilot] /api/rightmove/start with {len(augmented)} URLs (maxDaysSinceAdded=1)")
    ok, body = post_json("/api/rightmove/start", payload)
    print(f"[autopilot] rightmove start → ok={ok} body={body}")
    if not ok:
        return False
    return wait_until_done("/api/rightmove/status", "rightmove scrape", RM_MAX_RUNTIME_SEC)


def step_floorplans() -> bool:
    print(f"[autopilot] /api/floorplans/fetch with {FP_OPTIONS}")
    ok, body = post_json("/api/floorplans/fetch", FP_OPTIONS)
    print(f"[autopilot] floorplans fetch → ok={ok} body={body}")
    if not ok:
        # If there's nothing to fetch (no new listings without floorplans)
        # the endpoint returns 400 "no properties to fetch floor plans
        # for" — that's a perfectly clean outcome for a slow day.
        if "no properties" in body.lower():
            print("[autopilot] nothing to fetch — clean exit.")
            return True
        return False
    return wait_until_done("/api/floorplans/status", "floorplan fetcher", FP_MAX_RUNTIME_SEC)


def main() -> int:
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
    except FileNotFoundError:
        print(f"[autopilot] config missing at {CONFIG_PATH} — abort.")
        return 1

    if not step_rightmove(cfg):
        return 1
    if not step_floorplans():
        # Don't fail the whole pipeline on floor-plan trouble — the
        # listings are already saved and the daily scrape was useful.
        # The floor-plan fetcher can be re-run manually from /floorplans.
        print("[autopilot] floor-plan step did not complete cleanly — continuing.")
    print("[autopilot] daily run finished.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
