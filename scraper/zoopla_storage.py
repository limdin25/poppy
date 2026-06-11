"""Zoopla SQLite storage — mirrors rightmove_storage with zp_* tables.

Shares the same scraper.db file. Kept separate from rm_* so the existing
Rightmove pipeline is never touched; the comps/valuation layers read whichever
listing dict they're handed, so they work for both sources unchanged.
"""
import datetime
import threading
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "scraper.db"
_LOCK = threading.RLock()


def _conn():
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db():
    with _LOCK, _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS zp_listings (
            property_id TEXT PRIMARY KEY,
            listing_url TEXT,
            price TEXT,
            price_qualifier TEXT,
            address TEXT,
            bedrooms INTEGER,
            bathrooms INTEGER,
            receptions INTEGER,
            property_type TEXT,
            floor_area_sqm REAL,
            floor_area_sqft REAL,
            days_on_market TEXT,
            agent_name TEXT,
            agent_phone TEXT,
            agent_branch_url TEXT,
            is_auction INTEGER DEFAULT 0,
            is_tenanted INTEGER DEFAULT 0,
            search_url TEXT,
            first_seen TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS zp_reviews (
            property_id TEXT PRIMARY KEY,
            status TEXT,              -- pending | potential | skip
            reviewed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS zp_floorplans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            property_id TEXT,
            image_url TEXT,
            position INTEGER,
            UNIQUE(property_id, image_url)
        );
        CREATE TABLE IF NOT EXISTS zp_comps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            property_id TEXT,
            comp_type TEXT, address TEXT, price TEXT, bedrooms TEXT,
            property_type TEXT, url TEXT, date_info TEXT, distance_m TEXT,
            distance_label TEXT, source TEXT, floor_area_sqm TEXT,
            fetched_at TEXT
        );
        CREATE TABLE IF NOT EXISTS zp_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            urls_total INTEGER, started_at TEXT, finished_at TEXT
        );
        """)


# ── Listings ────────────────────────────────────────────────────────────────
def upsert_listing(row, search_url=None):
    """Insert/update a parsed listing. Returns True if it was NEW."""
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        init_table = c.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='zp_listings'").fetchone()
        if not init_table:
            init_db()
        existing = c.execute(
            "SELECT property_id FROM zp_listings WHERE property_id=?",
            (row["property_id"],)).fetchone()
        c.execute("""
            INSERT INTO zp_listings
              (property_id, listing_url, price, price_qualifier, address,
               bedrooms, bathrooms, receptions, property_type, search_url,
               first_seen, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(property_id) DO UPDATE SET
              listing_url=excluded.listing_url, price=excluded.price,
              address=excluded.address, bedrooms=excluded.bedrooms,
              bathrooms=excluded.bathrooms, receptions=excluded.receptions,
              property_type=excluded.property_type, updated_at=excluded.updated_at
        """, (row["property_id"], row.get("listing_url"), row.get("price"),
              row.get("price_qualifier"), row.get("address"), row.get("bedrooms"),
              row.get("bathrooms"), row.get("receptions"), row.get("property_type"),
              search_url, now, now))
        # New listings start life as 'pending' review (-> Floor plans tab)
        if not existing:
            c.execute("""INSERT OR IGNORE INTO zp_reviews (property_id, status, reviewed_at)
                         VALUES (?, 'pending', ?)""", (row["property_id"], now))
        return existing is None


def get_listing(property_id):
    with _LOCK, _conn() as c:
        r = c.execute("SELECT * FROM zp_listings WHERE property_id=?", (property_id,)).fetchone()
        return dict(r) if r else None


def update_listing_details(property_id, details):
    if not details:
        return
    cols = {k: details[k] for k in (
        "floor_area_sqm", "floor_area_sqft", "days_on_market", "agent_name",
        "agent_phone", "agent_branch_url", "is_auction", "is_tenanted")
        if k in details and details[k] is not None}
    if not cols:
        return
    sets = ", ".join(f"{k}=?" for k in cols)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE zp_listings SET {sets}, updated_at=? WHERE property_id=?",
                  (*cols.values(), datetime.datetime.now().isoformat(timespec="seconds"),
                   property_id))


# ── Reviews (Floor plans / potential / skip) ────────────────────────────────
def set_review(property_id, status):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute("""INSERT INTO zp_reviews (property_id, status, reviewed_at) VALUES (?,?,?)
                     ON CONFLICT(property_id) DO UPDATE SET status=excluded.status,
                       reviewed_at=excluded.reviewed_at""", (property_id, status, now))


def listings_for_review(status="pending"):
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute("""
            SELECT l.*, r.status, r.reviewed_at
            FROM zp_listings l JOIN zp_reviews r ON l.property_id = r.property_id
            WHERE r.status = ? ORDER BY r.reviewed_at DESC""", (status,))]


def shortlist_with_comps():
    with _LOCK, _conn() as c:
        props = [dict(r) for r in c.execute("""
            SELECT l.*, r.reviewed_at FROM zp_listings l
            JOIN zp_reviews r ON l.property_id = r.property_id
            WHERE r.status = 'potential' ORDER BY r.reviewed_at DESC""")]
        for p in props:
            p["comps"] = [dict(r) for r in c.execute(
                "SELECT * FROM zp_comps WHERE property_id=? ORDER BY comp_type", (p["property_id"],))]
        return props


# ── Floor plans ─────────────────────────────────────────────────────────────
def insert_floorplan(property_id, image_url, position=1):
    with _LOCK, _conn() as c:
        c.execute("""INSERT OR IGNORE INTO zp_floorplans (property_id, image_url, position)
                     VALUES (?,?,?)""", (property_id, image_url, position))


def get_floorplans(property_id):
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM zp_floorplans WHERE property_id=? ORDER BY position", (property_id,))]


def get_comps(property_id):
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM zp_comps WHERE property_id=? ORDER BY comp_type, id", (property_id,))]


# ── Sessions ────────────────────────────────────────────────────────────────
def create_session(search_urls):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        init_db()
        cur = c.execute("INSERT INTO zp_sessions (urls_total, started_at) VALUES (?,?)",
                        (len(search_urls), now))
        return cur.lastrowid


def finish_session(session_id):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute("UPDATE zp_sessions SET finished_at=? WHERE id=?", (now, session_id))


def counts():
    with _LOCK, _conn() as c:
        init_db()
        total = c.execute("SELECT COUNT(*) n FROM zp_listings").fetchone()["n"]
        pending = c.execute("SELECT COUNT(*) n FROM zp_reviews WHERE status='pending'").fetchone()["n"]
        potential = c.execute("SELECT COUNT(*) n FROM zp_reviews WHERE status='potential'").fetchone()["n"]
        return {"total": total, "pending": pending, "potential": potential}
