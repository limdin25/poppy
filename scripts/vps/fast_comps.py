"""Sold comparables for every shortlisted property, without a browser.

WHY THIS EXISTS. The Flask comps job (POST /api/comps/fetch) drives a proxied
Playwright browser at 3 to 6 seconds a property, does up to 45 EPC lookups each
with another 0.3 to 0.6s of sleep between them, and falls back to scraping
Zoopla sold pages. On 2026-08-10 it was started on 538 properties, managed 39,
and then hung with no database write for over an hour. At its best measured rate
it would have taken most of a day.

Almost none of that work needs a browser. The Land Registry search is a LOCAL
SQLite lookup ("instant", per its own docstring). The only network calls are the
EPC certificate lookups, and those are keyed by POSTCODE, so a ring of sales on
one street asks the same question over and over.

So this does the sold-comps half only: Land Registry across the same 200/500/800
ring ladder, EPC to estimate bedrooms, cached by postcode and shared across every
property, spread over a few threads. No browser, no Zoopla, no rental comps.

WHAT IS LOST. Rental comps (browser only) and the Zoopla fallback that tops up
a thin ring. A property whose Land Registry ring is thin will end up with fewer
comps and the valuation engine will call it `insufficient` rather than guess,
which is the behaviour we want: it refuses rather than inventing a number.

    .venv/bin/python fast_comps.py --limit=10      # try a few
    .venv/bin/python fast_comps.py                 # everything outstanding
"""
import sys, threading, time, concurrent.futures
sys.path.insert(0, "/root/scraper")

# FIRST, before anything that reads os.environ. CompsFetcher.EPC_API_TOKEN is a
# CLASS attribute evaluated at import time, so importing the scraper before the
# secrets are loaded pins the token to "" for the life of the process. Every EPC
# lookup then fails silently, no bedroom count is ever estimated, and every
# property comes back with zero usable comps while looking like it worked.
import env_loader  # noqa: F401

import rightmove_storage as storage
from rightmove_scraper import CompsFetcher

LIMIT = None
for a in sys.argv[1:]:
    if a.startswith("--limit="):
        LIMIT = int(a.split("=", 1)[1])
WORKERS = 6

props = storage.properties_needing_comps()
if LIMIT:
    props = props[:LIMIT]
print(f"{len(props)} properties need sold comps, {WORKERS} workers", flush=True)


class _NoProxy:
    def __init__(self): self.host = ""
    def next_proxy(self, *a, **k): return None
    def playwright_proxy(self, *a, **k): return None


_quiet = threading.Event()
f = CompsFetcher(proxy_mgr=_NoProxy(), emit=lambda *_a, **_k: None,
                 stop_event=threading.Event(), pause_event=_quiet)

# THE WHOLE SPEEDUP. _epc_search hits the API once per postcode; a 200m ring is
# mostly one or two postcodes, and neighbouring properties share them. Shared
# across threads and across properties for the life of the run.
_epc_lock = threading.Lock()
_epc_cache = {}
_orig_epc_search = f._epc_search


def _cached_epc_search(postcode):
    key = (postcode or "").upper().replace(" ", "")
    with _epc_lock:
        if key in _epc_cache:
            return _epc_cache[key]
    out = _orig_epc_search(postcode)
    with _epc_lock:
        _epc_cache[key] = out
    return out


f._epc_search = _cached_epc_search

done = threading.Lock()
counts = {"ok": 0, "thin": 0, "skip": 0, "err": 0, "n": 0}


def one(prop):
    pid = prop["property_id"]
    address = prop.get("address", "") or ""
    try:
        beds = int(prop.get("bedrooms") or 1)
    except (TypeError, ValueError):
        beds = 1
    target = beds + 1
    outcode = f._extract_outcode(address)
    if not outcode:
        with done:
            counts["skip"] += 1; counts["n"] += 1
        return
    full_pc = f._extract_full_postcode(address)
    search_pc = full_pc or outcode
    ptypes = f._lr_types_for(prop.get("property_type"))

    same, tgt, seen = [], [], set()
    try:
        for radius in (200, 500, 800):
            rows = f._search_land_registry(search_pc, address, radius=radius,
                                           property_types=ptypes,
                                           include_street=(radius == 200))
            fresh = []
            for lr in rows:
                key = (lr.get("address", "").lower(), lr.get("price", ""), lr.get("date", ""))
                if key not in seen:
                    seen.add(key); fresh.append(lr)
            for lr in fresh[:30]:
                pc = lr.get("postcode", "") or f._extract_full_postcode(lr.get("address", ""))
                if pc:
                    pc_fmt = pc if " " in pc else (pc[:-3] + " " + pc[-3:])
                    epc = f._epc_find_match(pc_fmt, lr.get("address", ""))
                    if epc:
                        lr["floor_area_sqm"] = epc.get("floor_area") or ""
                        rooms = epc.get("habitable_rooms")
                        if rooms:
                            lr["beds"] = str(max(1, int(rooms) - 1))
                        elif lr["floor_area_sqm"]:
                            sqm = float(lr["floor_area_sqm"])
                            lr["beds"] = "1" if sqm <= 50 else ("2" if sqm <= 75 else "3")
                if lr.get("beds") == str(beds):
                    same.append(lr)
                elif lr.get("beds") == str(target):
                    tgt.append(lr)
            if len(same) >= 5 and len(tgt) >= 5:
                break

        subj_sqm = 0.0
        try:
            subj_sqm = float(prop.get("floor_area_sqm") or 0)
        except (TypeError, ValueError):
            pass

        def rank(r):
            dist = int(r.get("distance_m") or 999999)
            pen = 0
            if subj_sqm > 0:
                try:
                    c = float(r.get("floor_area_sqm") or 0)
                except (TypeError, ValueError):
                    c = 0
                if c > 0 and not (0.7 * subj_sqm <= c <= 1.4 * subj_sqm):
                    pen = 1
            return (pen, dist)

        same.sort(key=rank); tgt.sort(key=rank)
        same, tgt = same[:5], tgt[:5]

        # Only clear the existing comps once we have something to replace them
        # with, so a failure cannot leave a property worse off than it started.
        if same or tgt:
            storage.clear_comps(pid)
            for comp, ctype in [(c, "sale_same") for c in same] + [(c, "sale_target") for c in tgt]:
                storage.insert_comp(pid, ctype, comp.get("address", ""), comp.get("price", ""),
                                    comp.get("beds", ""), comp.get("property_type", ""),
                                    comp.get("url", ""), comp.get("date", ""),
                                    comp.get("distance_m", ""), comp.get("distance_label", ""),
                                    comp.get("source", "Land Registry"),
                                    comp.get("floor_area_sqm", ""))
        with done:
            counts["n"] += 1
            if len(same) >= 3 and len(tgt) >= 3:
                counts["ok"] += 1
            else:
                counts["thin"] += 1
            if counts["n"] % 25 == 0:
                print(f"  {counts['n']}/{len(props)}  usable={counts['ok']} thin={counts['thin']} "
                      f"skip={counts['skip']} err={counts['err']} epc_postcodes={len(_epc_cache)}", flush=True)
    except Exception as e:
        with done:
            counts["err"] += 1; counts["n"] += 1
        print(f"  ! {pid}: {type(e).__name__}: {e}", flush=True)


t0 = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
    list(pool.map(one, props))
mins = (time.time() - t0) / 60
print(f"\ndone in {mins:.1f} min. usable={counts['ok']} thin={counts['thin']} "
      f"skipped={counts['skip']} errors={counts['err']} unique EPC postcodes={len(_epc_cache)}")
