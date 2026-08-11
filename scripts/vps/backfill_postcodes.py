"""Give every shortlisted listing a postcode, so its comparables can be found.

THE PROBLEM THIS SOLVES. The comps fetcher pulls sold prices out of the local
Land Registry database by postcode, and skips any property whose address does
not contain one ("no postcode found in address, skipping"). Measured on
2026-08-10: of 1,618 candidate properties only 168 carry a full postcode. The
other 1,450, sitting behind 472 estate agency branches, could never be valued,
and an unvalued property is refused by send_to_elsie because its offer band
would fall back to a percentage of the ASKING price, which is the exact bug the
valuation engine was written to kill.

So the addresses are resolved rather than the pipeline weakened: Google
geocodes "Aldrens Lane, Lancaster" to a point, and postcodes.io turns that point
into the real postcode next to it. Both steps are cheap and the results are
cached, because a street asked twice is the same street.

The postcode is APPENDED to the stored address rather than kept somewhere new,
because that is where every existing reader already looks for it.

    .venv/bin/python backfill_postcodes.py --limit=20
    .venv/bin/python backfill_postcodes.py
"""
import concurrent.futures, json, os, re, sqlite3, sys, threading, time, urllib.parse, urllib.request

DB = "/root/scraper/data/scraper.db"
GKEY = os.environ.get("GOOGLE_GEOCODE_KEY", "")
PC = re.compile(r"\b([A-Z]{1,2}[0-9][0-9A-Z]?)\s*[0-9][A-Z]{2}\b", re.I)

LIMIT = None
for a in sys.argv[1:]:
    if a.startswith("--limit="):
        LIMIT = int(a.split("=", 1)[1])

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
rows = con.execute("""
    SELECT l.property_id, l.address
      FROM rm_listings l
      JOIN rm_floorplan_ai a ON a.property_id = l.property_id
      LEFT JOIN rm_elsie_sent s ON s.property_id = l.property_id
     WHERE a.can_add_bedroom = 1 AND COALESCE(a.vetoed,'') = ''
       AND s.property_id IS NULL
       AND l.agent_phone IS NOT NULL AND l.agent_phone != ''
""").fetchall()
todo = [r for r in rows if r["address"] and not PC.search(r["address"])]
if LIMIT:
    todo = todo[:LIMIT]
print(f"{len(todo)} listings have no postcode", flush=True)

lock = threading.Lock()
cache = {}
stat = {"ok": 0, "no_geo": 0, "no_pc": 0, "err": 0, "n": 0}
writes = []


def get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "unico-postcode-backfill"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def resolve(addr):
    """Street text -> real postcode. Cached: one street, one lookup."""
    key = addr.strip().lower()
    with lock:
        if key in cache:
            return cache[key]
    out = None
    try:
        q = urllib.parse.quote(addr + ", UK")
        d = get(f"https://maps.googleapis.com/maps/api/geocode/json?address={q}&region=gb&key={GKEY}")
        res = (d.get("results") or [None])[0]
        if res:
            # Google sometimes hands back the postcode itself. Take it if so.
            for c in res.get("address_components", []):
                if "postal_code" in c.get("types", []) and PC.search(c.get("long_name", "")):
                    out = c["long_name"]
                    break
            if not out:
                loc = res["geometry"]["location"]
                p = get(f"https://api.postcodes.io/postcodes?lat={loc['lat']}&lon={loc['lng']}&limit=1")
                hits = p.get("result") or []
                if hits:
                    out = hits[0]["postcode"]
    except Exception:
        out = None
    with lock:
        cache[key] = out
    return out


def one(r):
    pid, addr = r["property_id"], r["address"]
    try:
        pc = resolve(addr)
    except Exception:
        pc = None
    with lock:
        stat["n"] += 1
        if pc:
            stat["ok"] += 1
            writes.append((f"{addr}, {pc}", pid))
        else:
            stat["no_pc"] += 1
        if stat["n"] % 100 == 0:
            print(f"  {stat['n']}/{len(todo)}  resolved={stat['ok']} unresolved={stat['no_pc']} "
                  f"unique streets={len(cache)}", flush=True)


t0 = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(one, todo))

# One writer, at the end, so a half-finished run cannot leave the table torn.
cur = con.cursor()
cur.executemany("UPDATE rm_listings SET address = ? WHERE property_id = ?", writes)
con.commit()
print(f"\ndone in {(time.time()-t0)/60:.1f} min. {len(writes)} addresses now carry a postcode, "
      f"{stat['no_pc']} could not be resolved, {len(cache)} unique streets looked up.")
