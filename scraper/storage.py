"""SQLite storage: schema, dedup, sessions, queries, CSV export."""
from __future__ import annotations
import sqlite3, hashlib, csv, os, re, datetime, threading, json
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "scraper.db"
EXPORT_DIR = Path(__file__).parent / "exports"
CONFIG_PATH = Path(__file__).parent / "data" / "config.json"
_LOCK = threading.Lock()


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(d: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Merge so partial saves don't wipe other fields.
    cur = load_config()
    cur.update({k: v for k, v in d.items() if v is not None})
    CONFIG_PATH.write_text(json.dumps(cur, indent=2), encoding="utf-8")

LEAD_FIELDS = ["name", "rating", "reviews_count", "category", "address",
               "status", "phone", "website", "maps_url", "keyword",
               "location", "session_id", "scraped_at"]


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=30000")  # wait up to 30s for a lock instead of erroring (safe for parallel instances)
    return c


def init_db():
    with _LOCK, _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS leads (
          id INTEGER PRIMARY KEY,
          dedup_hash TEXT UNIQUE,
          name TEXT, rating REAL, reviews_count INTEGER,
          category TEXT, address TEXT, status TEXT,
          phone TEXT, website TEXT, maps_url TEXT,
          keyword TEXT, location TEXT,
          session_id INTEGER, scraped_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY, started_at TEXT, ended_at TEXT,
          queries_total INTEGER, leads_new INTEGER, duplicates INTEGER, errors INTEGER
        );
        CREATE TABLE IF NOT EXISTS scraped_queries (
          id INTEGER PRIMARY KEY, query_hash TEXT UNIQUE,
          keyword TEXT, location TEXT, last_scraped_at TEXT, lead_count INTEGER
        );
        """)


def lead_hash(name: str, phone: str, address: str) -> str:
    name = (name or "").strip().lower()
    digits = re.sub(r"\D", "", phone or "")
    last7 = digits[-7:] if len(digits) >= 7 else digits
    addr = (address or "").strip().lower()[:10]
    return hashlib.sha1(f"{name}{last7}{addr}".encode()).hexdigest()


def query_hash(keyword: str, location: str) -> str:
    return hashlib.sha1(f"{(keyword or '').strip().lower()}|{(location or '').strip().lower()}".encode()).hexdigest()


def insert_lead(lead: dict) -> bool:
    """Returns True if newly inserted, False if duplicate.
    On duplicate, fills in any field that was previously NULL/empty so reruns
    of an improved parser enrich existing rows instead of being lost."""
    h = lead_hash(lead.get("name", ""), lead.get("phone", ""), lead.get("address", ""))
    cols = ["dedup_hash"] + LEAD_FIELDS
    vals = [h] + [lead.get(f) for f in LEAD_FIELDS]
    placeholders = ",".join("?" * len(cols))
    with _LOCK, _conn() as c:
        try:
            c.execute(f"INSERT INTO leads ({','.join(cols)}) VALUES ({placeholders})", vals)
            return True
        except sqlite3.IntegrityError:
            # Build a "set field = COALESCE(NULLIF(field,''), ?)" patch only for
            # fields where the *new* value is non-empty.
            updates, update_vals = [], []
            for f in LEAD_FIELDS:
                v = lead.get(f)
                if v in (None, ""):
                    continue
                updates.append(f"{f} = COALESCE(NULLIF({f}, ''), ?)")
                update_vals.append(v)
            if updates:
                update_vals.append(h)
                c.execute(f"UPDATE leads SET {', '.join(updates)} WHERE dedup_hash = ?",
                          update_vals)
            return False


def start_session() -> int:
    with _LOCK, _conn() as c:
        cur = c.execute(
            "INSERT INTO sessions (started_at, queries_total, leads_new, duplicates, errors) VALUES (?,0,0,0,0)",
            (datetime.datetime.now().isoformat(timespec="seconds"),))
        return cur.lastrowid


def update_session(session_id: int, **kwargs):
    if not kwargs:
        return
    sets = ",".join(f"{k}=?" for k in kwargs)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE sessions SET {sets} WHERE id=?", list(kwargs.values()) + [session_id])


def end_session(session_id: int):
    with _LOCK, _conn() as c:
        c.execute("UPDATE sessions SET ended_at=? WHERE id=?",
                  (datetime.datetime.now().isoformat(timespec="seconds"), session_id))


def list_sessions():
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT s.*, (SELECT COUNT(*) FROM leads WHERE session_id=s.id) AS leads_count "
            "FROM sessions s ORDER BY id DESC LIMIT 100")]


def mark_query_scraped(keyword: str, location: str, lead_count: int):
    h = query_hash(keyword, location)
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute("""INSERT INTO scraped_queries (query_hash, keyword, location, last_scraped_at, lead_count)
                     VALUES (?,?,?,?,?)
                     ON CONFLICT(query_hash) DO UPDATE SET last_scraped_at=excluded.last_scraped_at,
                     lead_count=excluded.lead_count""",
                  (h, keyword, location, now, lead_count))


def list_scraped_queries():
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM scraped_queries ORDER BY last_scraped_at DESC LIMIT 500")]


def is_query_scraped(keyword: str, location: str) -> bool:
    with _LOCK, _conn() as c:
        r = c.execute("SELECT 1 FROM scraped_queries WHERE query_hash=?",
                      (query_hash(keyword, location),)).fetchone()
        return r is not None


def recent_leads(limit=50):
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT name, phone, rating, location, scraped_at FROM leads ORDER BY id DESC LIMIT ?", (limit,))]


def export_csv(session_id: int | None = None) -> str:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    if session_id is None:
        path = EXPORT_DIR / f"leads_all_{ts}.csv"
        sql = "SELECT * FROM leads ORDER BY id"
        params: tuple = ()
    else:
        path = EXPORT_DIR / f"leads_session_{session_id}_{ts}.csv"
        sql = "SELECT * FROM leads WHERE session_id=? ORDER BY id"
        params = (session_id,)
    with _LOCK, _conn() as c:
        rows = c.execute(sql, params).fetchall()
    cols = ["id"] + LEAD_FIELDS
    # UTF-8 with BOM so Excel opens cleanly
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([r[k] if k in r.keys() else "" for k in cols])
    return str(path)


def clear_history():
    with _LOCK, _conn() as c:
        c.executescript("DELETE FROM leads; DELETE FROM sessions; DELETE FROM scraped_queries;")
