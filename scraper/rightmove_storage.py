"""SQLite storage for Rightmove scraper: listings, sessions, CSV export."""
import sqlite3, hashlib, csv, datetime, threading, json
from typing import Optional
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "scraper.db"
EXPORT_DIR = Path(__file__).parent / "exports"
CONFIG_PATH = Path(__file__).parent / "data" / "rm_config.json"
_LOCK = threading.Lock()

RM_FIELDS = [
    "listing_url", "price", "price_qualifier", "address",
    "bedrooms", "property_type", "property_id",
    "search_url", "session_id", "scraped_at",
    "is_auction", "listed_date", "days_on_market", "is_tenanted",
]

DETAIL_FIELDS = [
    "is_auction", "listed_date", "days_on_market", "is_tenanted",
    "floor_area_sqft", "floor_area_sqm",
    "agent_name", "agent_phone", "agent_branch_url",
]


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(d: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    cur = load_config()
    cur.update({k: v for k, v in d.items() if v is not None})
    CONFIG_PATH.write_text(json.dumps(cur, indent=2), encoding="utf-8")


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db():
    with _LOCK, _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS rm_listings (
          id INTEGER PRIMARY KEY,
          dedup_hash TEXT UNIQUE,
          listing_url TEXT,
          price TEXT,
          price_qualifier TEXT,
          address TEXT,
          bedrooms TEXT,
          property_type TEXT,
          property_id TEXT,
          search_url TEXT,
          session_id INTEGER,
          scraped_at TEXT
        );
        CREATE TABLE IF NOT EXISTS rm_sessions (
          id INTEGER PRIMARY KEY,
          started_at TEXT,
          ended_at TEXT,
          urls_total INTEGER,
          listings_new INTEGER,
          duplicates INTEGER,
          errors INTEGER
        );
        CREATE TABLE IF NOT EXISTS rm_scraped_urls (
          id INTEGER PRIMARY KEY,
          url_hash TEXT UNIQUE,
          search_url TEXT,
          last_scraped_at TEXT,
          listing_count INTEGER
        );
        CREATE TABLE IF NOT EXISTS rm_floorplans (
          id INTEGER PRIMARY KEY,
          property_id TEXT,
          image_url TEXT,
          page_number INTEGER,
          fetched_at TEXT,
          UNIQUE(property_id, page_number)
        );
        CREATE TABLE IF NOT EXISTS rm_reviews (
          id INTEGER PRIMARY KEY,
          property_id TEXT UNIQUE,
          status TEXT,
          reviewed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS rm_comps (
          id INTEGER PRIMARY KEY,
          property_id TEXT,
          comp_type TEXT,
          address TEXT,
          price TEXT,
          bedrooms TEXT,
          property_type TEXT,
          url TEXT,
          date_info TEXT,
          fetched_at TEXT
        );
        """)
        for col in DETAIL_FIELDS:
            try:
                c.execute(f"ALTER TABLE rm_listings ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass
        for col in ["distance_m", "distance_label", "source", "floor_area_sqm"]:
            try:
                c.execute(f"ALTER TABLE rm_comps ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass


def listing_hash(property_id: str) -> str:
    pid = (property_id or "").strip()
    return hashlib.sha1(pid.encode()).hexdigest()


def url_hash(search_url: str) -> str:
    return hashlib.sha1((search_url or "").strip().encode()).hexdigest()


def insert_listing(listing: dict) -> bool:
    h = listing_hash(listing.get("property_id", ""))
    cols = ["dedup_hash"] + RM_FIELDS
    vals = [h] + [listing.get(f) for f in RM_FIELDS]
    placeholders = ",".join("?" * len(cols))
    with _LOCK, _conn() as c:
        try:
            c.execute(f"INSERT INTO rm_listings ({','.join(cols)}) VALUES ({placeholders})", vals)
            return True
        except sqlite3.IntegrityError:
            updates, update_vals = [], []
            for f in RM_FIELDS:
                v = listing.get(f)
                if v in (None, ""):
                    continue
                updates.append(f"{f} = COALESCE(NULLIF({f}, ''), ?)")
                update_vals.append(v)
            if updates:
                update_vals.append(h)
                c.execute(f"UPDATE rm_listings SET {', '.join(updates)} WHERE dedup_hash = ?",
                          update_vals)
            return False


def start_session() -> int:
    with _LOCK, _conn() as c:
        cur = c.execute(
            "INSERT INTO rm_sessions (started_at, urls_total, listings_new, duplicates, errors) "
            "VALUES (?,0,0,0,0)",
            (datetime.datetime.now().isoformat(timespec="seconds"),))
        return cur.lastrowid


def update_session(session_id: int, **kwargs):
    if not kwargs:
        return
    sets = ",".join(f"{k}=?" for k in kwargs)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE rm_sessions SET {sets} WHERE id=?",
                  list(kwargs.values()) + [session_id])


def end_session(session_id: int):
    with _LOCK, _conn() as c:
        c.execute("UPDATE rm_sessions SET ended_at=? WHERE id=?",
                  (datetime.datetime.now().isoformat(timespec="seconds"), session_id))


def list_sessions():
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT s.*, (SELECT COUNT(*) FROM rm_listings WHERE session_id=s.id) AS listings_count "
            "FROM rm_sessions s ORDER BY id DESC LIMIT 100")]


def mark_url_scraped(search_url: str, listing_count: int):
    h = url_hash(search_url)
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute(
            """INSERT INTO rm_scraped_urls (url_hash, search_url, last_scraped_at, listing_count)
               VALUES (?,?,?,?)
               ON CONFLICT(url_hash) DO UPDATE SET last_scraped_at=excluded.last_scraped_at,
               listing_count=excluded.listing_count""",
            (h, search_url, now, listing_count))


def is_url_scraped(search_url: str) -> bool:
    with _LOCK, _conn() as c:
        r = c.execute("SELECT 1 FROM rm_scraped_urls WHERE url_hash=?",
                      (url_hash(search_url),)).fetchone()
        return r is not None


def list_scraped_urls():
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM rm_scraped_urls ORDER BY last_scraped_at DESC LIMIT 500")]


def recent_listings(limit=50):
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT listing_url, price, price_qualifier, address, bedrooms, property_type, property_id, scraped_at, "
            "is_auction, listed_date, days_on_market, is_tenanted, "
            "agent_name, agent_phone, agent_branch_url "
            "FROM rm_listings ORDER BY id DESC LIMIT ?", (limit,))]


def all_listing_urls():
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT listing_url, price, address, property_id FROM rm_listings ORDER BY id")]


def export_csv(session_id: Optional[int] = None) -> str:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    if session_id is None:
        path = EXPORT_DIR / f"rm_listings_all_{ts}.csv"
        sql = "SELECT * FROM rm_listings ORDER BY id"
        params: tuple = ()
    else:
        path = EXPORT_DIR / f"rm_listings_session_{session_id}_{ts}.csv"
        sql = "SELECT * FROM rm_listings WHERE session_id=? ORDER BY id"
        params = (session_id,)
    with _LOCK, _conn() as c:
        rows = c.execute(sql, params).fetchall()
        table_cols = [r["name"] for r in c.execute("PRAGMA table_info(rm_listings)")]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(table_cols)
        for r in rows:
            w.writerow([r[k] if k in r.keys() else "" for k in table_cols])
    return str(path)


def clear_history():
    with _LOCK, _conn() as c:
        c.executescript(
            "DELETE FROM rm_listings; DELETE FROM rm_sessions; DELETE FROM rm_scraped_urls; DELETE FROM rm_floorplans; DELETE FROM rm_reviews; DELETE FROM rm_comps;"
        )


def insert_floorplan(property_id: str, image_url: str, page_number: int):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute(
            """INSERT INTO rm_floorplans (property_id, image_url, page_number, fetched_at)
               VALUES (?,?,?,?)
               ON CONFLICT(property_id, page_number) DO UPDATE SET image_url=excluded.image_url, fetched_at=excluded.fetched_at""",
            (property_id, image_url, page_number, now))


def update_listing_details(property_id: str, details: dict):
    sets, vals = [], []
    for f in DETAIL_FIELDS:
        v = details.get(f)
        if v is not None:
            sets.append(f"{f} = ?")
            vals.append(str(v))
    if not sets:
        return
    vals.append(property_id)
    with _LOCK, _conn() as c:
        c.execute(
            f"UPDATE rm_listings SET {', '.join(sets)} WHERE property_id = ?",
            vals)


def get_floorplans(property_id: str):
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT image_url, page_number FROM rm_floorplans WHERE property_id=? ORDER BY page_number",
            (property_id,))]


def properties_without_floorplans():
    """Get listing property_ids that haven't had floor plans fetched yet."""
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            """SELECT l.property_id, l.listing_url, l.price, l.price_qualifier, l.address,
                      l.bedrooms, l.property_type, l.is_auction, l.is_tenanted
               FROM rm_listings l
               LEFT JOIN rm_floorplans f ON l.property_id = f.property_id
               WHERE f.id IS NULL
               GROUP BY l.property_id""")]


def filter_properties(props: list, exclude_auction=False, exclude_tenanted=False) -> list:
    out = props
    if exclude_auction:
        out = [p for p in out if p.get("is_auction") != "1"]
    if exclude_tenanted:
        out = [p for p in out if p.get("is_tenanted") != "1"]
    return out


def properties_with_floorplans():
    """Get all properties that HAVE floor plans fetched, with their review status."""
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            """SELECT l.property_id, l.listing_url, l.price, l.price_qualifier, l.address,
                      l.bedrooms, l.property_type, r.status,
                      l.is_auction, l.listed_date, l.days_on_market, l.is_tenanted,
                      l.floor_area_sqft, l.floor_area_sqm,
                      l.agent_name, l.agent_phone, l.agent_branch_url
               FROM rm_listings l
               INNER JOIN rm_floorplans f ON l.property_id = f.property_id
               LEFT JOIN rm_reviews r ON l.property_id = r.property_id
               WHERE l.is_tenanted != '1'
               GROUP BY l.property_id
               ORDER BY
                 CASE WHEN r.status IS NULL THEN 0
                      WHEN r.status = 'potential' THEN 1
                      WHEN r.status = 'skip' THEN 2
                      ELSE 3 END,
                 l.id""")]


def set_review_if_unset(property_id: str, status: str):
    """Like set_review but only if no row exists yet.

    Used by the FloorplanFetcher to auto-skip no-floorplan listings
    without overwriting a status the user already picked manually.
    """
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute(
            "INSERT OR IGNORE INTO rm_reviews (property_id, status, reviewed_at) VALUES (?,?,?)",
            (property_id, status, now))


def set_review(property_id: str, status: str):
    """Set review status: 'potential' or 'skip'."""
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute(
            """INSERT INTO rm_reviews (property_id, status, reviewed_at) VALUES (?,?,?)
               ON CONFLICT(property_id) DO UPDATE SET status=excluded.status, reviewed_at=excluded.reviewed_at""",
            (property_id, status, now))


def get_shortlist():
    """Get all properties marked as 'potential'."""
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            """SELECT l.property_id, l.listing_url, l.price, l.price_qualifier, l.address,
                      l.bedrooms, l.property_type, r.reviewed_at
               FROM rm_listings l
               INNER JOIN rm_reviews r ON l.property_id = r.property_id
               WHERE r.status = 'potential'
               ORDER BY r.reviewed_at DESC""")]


def shortlist_count():
    with _LOCK, _conn() as c:
        r = c.execute("SELECT COUNT(*) as cnt FROM rm_reviews WHERE status='potential'").fetchone()
        return r["cnt"] if r else 0


def review_stats():
    with _LOCK, _conn() as c:
        total = c.execute(
            """SELECT COUNT(DISTINCT f.property_id) FROM rm_floorplans f
               INNER JOIN rm_listings l ON f.property_id = l.property_id
               WHERE l.is_tenanted != '1'""").fetchone()[0]
        potential = c.execute(
            """SELECT COUNT(*) FROM rm_reviews r
               INNER JOIN rm_listings l ON r.property_id = l.property_id
               WHERE r.status='potential' AND l.is_tenanted != '1'""").fetchone()[0]
        skipped = c.execute(
            """SELECT COUNT(*) FROM rm_reviews r
               INNER JOIN rm_listings l ON r.property_id = l.property_id
               WHERE r.status='skip' AND l.is_tenanted != '1'""").fetchone()[0]
        return {"total": total, "potential": potential, "skipped": skipped, "unreviewed": total - potential - skipped}


def get_search_url_for_property(property_id: str) -> str:
    with _LOCK, _conn() as c:
        r = c.execute("SELECT search_url FROM rm_listings WHERE property_id=?", (property_id,)).fetchone()
        return r["search_url"] if r else ""


def insert_comp(property_id: str, comp_type: str, address: str, price: str,
                bedrooms: str, property_type: str, url: str, date_info: str,
                distance_m: str = "", distance_label: str = "", source: str = "Rightmove",
                floor_area_sqm: str = ""):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute(
            """INSERT INTO rm_comps (property_id, comp_type, address, price, bedrooms, property_type, url, date_info, fetched_at, distance_m, distance_label, source, floor_area_sqm)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (property_id, comp_type, address, price, bedrooms, property_type, url, date_info, now, distance_m, distance_label, source, floor_area_sqm))


def get_comps(property_id: str):
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM rm_comps WHERE property_id=? ORDER BY comp_type, id",
            (property_id,))]


def clear_comps(property_id: str):
    with _LOCK, _conn() as c:
        c.execute("DELETE FROM rm_comps WHERE property_id=?", (property_id,))


def properties_needing_comps():
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            """SELECT l.property_id, l.listing_url, l.price, l.price_qualifier, l.address,
                      l.bedrooms, l.property_type, r.reviewed_at
               FROM rm_listings l
               INNER JOIN rm_reviews r ON l.property_id = r.property_id
               LEFT JOIN rm_comps c ON l.property_id = c.property_id
               WHERE r.status = 'potential' AND c.id IS NULL
               GROUP BY l.property_id
               ORDER BY r.reviewed_at DESC""")]


def shortlist_with_comps():
    with _LOCK, _conn() as c:
        props = [dict(r) for r in c.execute(
            """SELECT l.property_id, l.listing_url, l.price, l.price_qualifier, l.address,
                      l.bedrooms, l.property_type, r.reviewed_at,
                      l.floor_area_sqft, l.floor_area_sqm
               FROM rm_listings l
               INNER JOIN rm_reviews r ON l.property_id = r.property_id
               WHERE r.status = 'potential'
               ORDER BY r.reviewed_at DESC""")]
        for p in props:
            p["comps"] = [dict(r) for r in c.execute(
                """SELECT comp_type, address, price, bedrooms, property_type, url, date_info, distance_m, distance_label, source, floor_area_sqm
                   FROM rm_comps WHERE property_id=?
                   ORDER BY comp_type,
                     CASE WHEN distance_label LIKE '%Same building%' THEN 0 WHEN distance_label LIKE '%Same road%' THEN 1 ELSE 2 END,
                     CAST(COALESCE(NULLIF(SUBSTR(date_info, -4), ''), '0') AS INTEGER) DESC,
                     CAST(COALESCE(NULLIF(distance_m,''),'999999') AS INTEGER)""",
                (p["property_id"],))]
        return props


def export_shortlist_csv() -> str:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    path = EXPORT_DIR / f"rm_shortlist_{ts}.csv"
    data = get_shortlist()
    cols = ["property_id", "listing_url", "price", "price_qualifier", "address", "bedrooms", "property_type", "reviewed_at"]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in data:
            w.writerow([r.get(k, "") for k in cols])
    return str(path)


# ───────────────── Elsie integration (BRRR qualifier) ─────────────────

def get_listing(property_id: str):
    with _LOCK, _conn() as c:
        r = c.execute("SELECT * FROM rm_listings WHERE property_id=?", (property_id,)).fetchone()
        return dict(r) if r else None


def _ensure_elsie_table(c):
    c.execute("""CREATE TABLE IF NOT EXISTS rm_elsie_sent (
        property_id TEXT PRIMARY KEY,
        sent_at TEXT,
        ok INTEGER,
        error TEXT)""")


def set_elsie_sent(property_id: str, ok: bool, error: str = ""):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        _ensure_elsie_table(c)
        c.execute(
            """INSERT INTO rm_elsie_sent (property_id, sent_at, ok, error) VALUES (?,?,?,?)
               ON CONFLICT(property_id) DO UPDATE SET sent_at=excluded.sent_at, ok=excluded.ok, error=excluded.error""",
            (property_id, now, 1 if ok else 0, error))


def get_elsie_sent_map():
    """{property_id: sent_at} for properties successfully sent to Elsie."""
    with _LOCK, _conn() as c:
        _ensure_elsie_table(c)
        return {r["property_id"]: r["sent_at"] for r in c.execute(
            "SELECT property_id, sent_at FROM rm_elsie_sent WHERE ok=1")}


# ── Email/form enquiries (separate from the call path above) ────────────────
def _ensure_enquiry_table(c):
    c.execute("""CREATE TABLE IF NOT EXISTS rm_elsie_enquired (
        property_id TEXT PRIMARY KEY,
        enquired_at TEXT,
        ok INTEGER,
        dry_run INTEGER DEFAULT 0,
        error TEXT)""")


def set_elsie_enquired(property_id: str, ok: bool, dry_run: bool = False, error: str = ""):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        _ensure_enquiry_table(c)
        c.execute(
            """INSERT INTO rm_elsie_enquired (property_id, enquired_at, ok, dry_run, error)
               VALUES (?,?,?,?,?)
               ON CONFLICT(property_id) DO UPDATE SET
                 enquired_at=excluded.enquired_at, ok=excluded.ok,
                 dry_run=excluded.dry_run, error=excluded.error""",
            (property_id, now, 1 if ok else 0, 1 if dry_run else 0, error))


def get_elsie_enquired_map():
    """{property_id: enquired_at} for properties a real enquiry was sent for."""
    with _LOCK, _conn() as c:
        _ensure_enquiry_table(c)
        return {r["property_id"]: r["enquired_at"] for r in c.execute(
            "SELECT property_id, enquired_at FROM rm_elsie_enquired WHERE ok=1 AND dry_run=0")}
