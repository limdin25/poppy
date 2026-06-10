"""SQLite storage for Facebook Ad Library scraper: schema, dedup, sessions, CSV export."""
import sqlite3, hashlib, csv, os, datetime, threading, json
from typing import Optional
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "scraper.db"
EXPORT_DIR = Path(__file__).parent / "exports"
CONFIG_PATH = Path(__file__).parent / "data" / "fb_config.json"
_LOCK = threading.Lock()

FB_LEAD_FIELDS = [
    "page_name", "page_url", "website", "start_date",
    "is_active", "platforms", "keyword", "country",
    "category", "active_ad_count", "ad_library_url",
    "session_id", "scraped_at",
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
        CREATE TABLE IF NOT EXISTS fb_ads (
          id INTEGER PRIMARY KEY,
          dedup_hash TEXT UNIQUE,
          page_name TEXT,
          page_url TEXT,
          website TEXT,
          start_date TEXT,
          is_active INTEGER,
          platforms TEXT,
          keyword TEXT,
          country TEXT,
          category TEXT,
          active_ad_count INTEGER,
          ad_library_url TEXT,
          session_id INTEGER,
          scraped_at TEXT
        );
        CREATE TABLE IF NOT EXISTS fb_sessions (
          id INTEGER PRIMARY KEY,
          started_at TEXT,
          ended_at TEXT,
          queries_total INTEGER,
          leads_new INTEGER,
          duplicates INTEGER,
          errors INTEGER
        );
        CREATE TABLE IF NOT EXISTS fb_scraped_queries (
          id INTEGER PRIMARY KEY,
          query_hash TEXT UNIQUE,
          keyword TEXT,
          country TEXT,
          last_scraped_at TEXT,
          lead_count INTEGER
        );
        """)
        # Migrations for columns added after initial release
        for col, coltype in [("active_ad_count", "INTEGER"), ("ad_library_url", "TEXT")]:
            try:
                c.execute(f"SELECT {col} FROM fb_ads LIMIT 1")
            except sqlite3.OperationalError:
                c.execute(f"ALTER TABLE fb_ads ADD COLUMN {col} {coltype}")


def ad_hash(page_name: str, keyword: str, country: str) -> str:
    name = (page_name or "").strip().lower()
    kw = (keyword or "").strip().lower()
    co = (country or "").strip().lower()
    return hashlib.sha1(f"{name}|{kw}|{co}".encode()).hexdigest()


def query_hash(keyword: str, country: str) -> str:
    return hashlib.sha1(
        f"{(keyword or '').strip().lower()}|{(country or '').strip().lower()}".encode()
    ).hexdigest()


def insert_ad(ad: dict) -> bool:
    h = ad_hash(ad.get("page_name", ""), ad.get("keyword", ""), ad.get("country", ""))
    cols = ["dedup_hash"] + FB_LEAD_FIELDS
    vals = [h] + [ad.get(f) for f in FB_LEAD_FIELDS]
    placeholders = ",".join("?" * len(cols))
    with _LOCK, _conn() as c:
        try:
            c.execute(f"INSERT INTO fb_ads ({','.join(cols)}) VALUES ({placeholders})", vals)
            return True
        except sqlite3.IntegrityError:
            updates, update_vals = [], []
            for f in FB_LEAD_FIELDS:
                v = ad.get(f)
                if v in (None, ""):
                    continue
                updates.append(f"{f} = COALESCE(NULLIF({f}, ''), ?)")
                update_vals.append(v)
            if updates:
                update_vals.append(h)
                c.execute(f"UPDATE fb_ads SET {', '.join(updates)} WHERE dedup_hash = ?",
                          update_vals)
            return False


def start_session() -> int:
    with _LOCK, _conn() as c:
        cur = c.execute(
            "INSERT INTO fb_sessions (started_at, queries_total, leads_new, duplicates, errors) "
            "VALUES (?,0,0,0,0)",
            (datetime.datetime.now().isoformat(timespec="seconds"),))
        return cur.lastrowid


def update_session(session_id: int, **kwargs):
    if not kwargs:
        return
    sets = ",".join(f"{k}=?" for k in kwargs)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE fb_sessions SET {sets} WHERE id=?",
                  list(kwargs.values()) + [session_id])


def end_session(session_id: int):
    with _LOCK, _conn() as c:
        c.execute("UPDATE fb_sessions SET ended_at=? WHERE id=?",
                  (datetime.datetime.now().isoformat(timespec="seconds"), session_id))


def list_sessions():
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT s.*, (SELECT COUNT(*) FROM fb_ads WHERE session_id=s.id) AS leads_count "
            "FROM fb_sessions s ORDER BY id DESC LIMIT 100")]


def mark_query_scraped(keyword: str, country: str, lead_count: int):
    h = query_hash(keyword, country)
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute(
            """INSERT INTO fb_scraped_queries (query_hash, keyword, country, last_scraped_at, lead_count)
               VALUES (?,?,?,?,?)
               ON CONFLICT(query_hash) DO UPDATE SET last_scraped_at=excluded.last_scraped_at,
               lead_count=excluded.lead_count""",
            (h, keyword, country, now, lead_count))


def list_scraped_queries():
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM fb_scraped_queries ORDER BY last_scraped_at DESC LIMIT 500")]


def is_query_scraped(keyword: str, country: str) -> bool:
    with _LOCK, _conn() as c:
        r = c.execute("SELECT 1 FROM fb_scraped_queries WHERE query_hash=?",
                      (query_hash(keyword, country),)).fetchone()
        return r is not None


def recent_ads(limit=50):
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT page_name, page_url, website, start_date, is_active, platforms, "
            "keyword, country, active_ad_count, ad_library_url "
            "FROM fb_ads ORDER BY id DESC LIMIT ?", (limit,))]


def unique_pages(session_id: Optional[int] = None):
    """Get unique page_name + page_url + country, optionally filtered by session."""
    with _LOCK, _conn() as c:
        if session_id:
            rows = c.execute(
                "SELECT DISTINCT page_name, page_url, country FROM fb_ads "
                "WHERE session_id=? AND page_url != '' AND page_url IS NOT NULL",
                (session_id,)).fetchall()
        else:
            rows = c.execute(
                "SELECT DISTINCT page_name, page_url, country FROM fb_ads "
                "WHERE page_url != '' AND page_url IS NOT NULL").fetchall()
        return [dict(r) for r in rows]


def update_ad_count(page_url: str, count: int):
    """Set active_ad_count for all rows matching this page_url."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE fb_ads SET active_ad_count=? WHERE page_url=?",
                  (count, page_url))


def update_ad_library_url(page_url: str, ad_library_url: str):
    """Set ad_library_url for all rows matching this page_url."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE fb_ads SET ad_library_url=? WHERE page_url=?",
                  (ad_library_url, page_url))


def export_csv(session_id: Optional[int] = None) -> str:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    if session_id is None:
        path = EXPORT_DIR / f"fb_ads_all_{ts}.csv"
        sql = "SELECT * FROM fb_ads ORDER BY id"
        params: tuple = ()
    else:
        path = EXPORT_DIR / f"fb_ads_session_{session_id}_{ts}.csv"
        sql = "SELECT * FROM fb_ads WHERE session_id=? ORDER BY id"
        params = (session_id,)
    with _LOCK, _conn() as c:
        rows = c.execute(sql, params).fetchall()
    cols = ["id"] + FB_LEAD_FIELDS
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([r[k] if k in r.keys() else "" for k in cols])
    return str(path)


def clear_history():
    with _LOCK, _conn() as c:
        c.executescript(
            "DELETE FROM fb_ads; DELETE FROM fb_sessions; DELETE FROM fb_scraped_queries;"
        )
