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
        -- Rent-to-rent: agents we've already messaged. Manual-remove only.
        CREATE TABLE IF NOT EXISTS zp_blacklist (
            agent_key TEXT PRIMARY KEY,
            agent_name TEXT,
            property_id TEXT,
            address TEXT,
            added_at TEXT
        );
        """)
        # Columns added after the initial release (idempotent).
        for col, ddl in [
            ("listing_type", "ALTER TABLE zp_listings ADD COLUMN listing_type TEXT DEFAULT 'sale'"),
            ("rent_pcm", "ALTER TABLE zp_listings ADD COLUMN rent_pcm INTEGER"),
            ("agent_key", "ALTER TABLE zp_listings ADD COLUMN agent_key TEXT"),
        ]:
            try:
                c.execute(ddl)
            except sqlite3.OperationalError:
                pass  # already exists


# ── Listings ────────────────────────────────────────────────────────────────
def upsert_listing(row, search_url=None):
    """Insert/update a parsed listing (sale or rent). Returns True if NEW."""
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
               bedrooms, bathrooms, receptions, property_type, listing_type,
               rent_pcm, agent_name, agent_key, search_url, first_seen, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(property_id) DO UPDATE SET
              listing_url=excluded.listing_url, price=excluded.price,
              address=excluded.address, bedrooms=excluded.bedrooms,
              bathrooms=excluded.bathrooms, receptions=excluded.receptions,
              property_type=excluded.property_type, listing_type=excluded.listing_type,
              rent_pcm=excluded.rent_pcm,
              agent_name=COALESCE(excluded.agent_name, zp_listings.agent_name),
              agent_key=COALESCE(excluded.agent_key, zp_listings.agent_key),
              updated_at=excluded.updated_at
        """, (row["property_id"], row.get("listing_url"), row.get("price"),
              row.get("price_qualifier"), row.get("address"), row.get("bedrooms"),
              row.get("bathrooms"), row.get("receptions"), row.get("property_type"),
              row.get("listing_type", "sale"), row.get("rent_pcm"),
              row.get("agent_name"), row.get("agent_key"), search_url, now, now))
        # New SALE listings start 'pending' (-> Floor plans). Rentals skip that.
        if not existing and row.get("listing_type", "sale") == "sale":
            c.execute("""INSERT OR IGNORE INTO zp_reviews (property_id, status, reviewed_at)
                         VALUES (?, 'pending', ?)""", (row["property_id"], now))
        return existing is None


# ── Rentals: one cheapest property per non-blacklisted agent ────────────────
def rental_agents_to_message():
    """The 'new agents' list: the cheapest rental per agent we haven't messaged.

    One row per agent_key (lowest rent_pcm), excluding blacklisted agents and
    rows with no agent. This is exactly what 'message all new agents' fires at.
    """
    with _LOCK, _conn() as c:
        init_db()
        return [dict(r) for r in c.execute("""
            SELECT l.* FROM zp_listings l
            JOIN (
                SELECT agent_key, MIN(COALESCE(rent_pcm, 999999)) AS min_rent
                FROM zp_listings
                WHERE listing_type='rent' AND agent_key IS NOT NULL
                  AND agent_key NOT IN (SELECT agent_key FROM zp_blacklist)
                GROUP BY agent_key
            ) m ON l.agent_key = m.agent_key
               AND COALESCE(l.rent_pcm, 999999) = m.min_rent
            WHERE l.listing_type='rent'
            GROUP BY l.agent_key
            ORDER BY l.rent_pcm ASC""")]


def rental_counts():
    with _LOCK, _conn() as c:
        init_db()
        total = c.execute("SELECT COUNT(*) n FROM zp_listings WHERE listing_type='rent'").fetchone()["n"]
        agents = c.execute("""SELECT COUNT(DISTINCT agent_key) n FROM zp_listings
                              WHERE listing_type='rent' AND agent_key IS NOT NULL""").fetchone()["n"]
        blacklisted = c.execute("SELECT COUNT(*) n FROM zp_blacklist").fetchone()["n"]
        to_message = len(rental_agents_to_message())
        return {"total": total, "agents": agents, "blacklisted": blacklisted,
                "to_message": to_message}


# ── Agent blacklist (manual-remove only) ────────────────────────────────────
def blacklist_agent(agent_key, agent_name="", property_id="", address=""):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        init_db()
        c.execute("""INSERT INTO zp_blacklist (agent_key, agent_name, property_id, address, added_at)
                     VALUES (?,?,?,?,?) ON CONFLICT(agent_key) DO NOTHING""",
                  (agent_key, agent_name, property_id, address, now))


def unblacklist_agent(agent_key):
    with _LOCK, _conn() as c:
        c.execute("DELETE FROM zp_blacklist WHERE agent_key=?", (agent_key,))


def get_blacklist():
    """Blacklisted agents with days-since (for the blacklist page)."""
    now = datetime.datetime.now()
    with _LOCK, _conn() as c:
        init_db()
        out = []
        for r in c.execute("SELECT * FROM zp_blacklist ORDER BY added_at DESC"):
            d = dict(r)
            try:
                added = datetime.datetime.fromisoformat(d["added_at"])
                d["days_on_blacklist"] = (now - added).days
            except Exception:
                d["days_on_blacklist"] = None
            out.append(d)
        return out


def is_blacklisted(agent_key):
    with _LOCK, _conn() as c:
        return c.execute("SELECT 1 FROM zp_blacklist WHERE agent_key=?",
                         (agent_key,)).fetchone() is not None


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


# insert_comp / clear_comps mirror rightmove_storage so the portal-agnostic
# CompsFetcher can write Zoopla comps via its injectable `storage` param.
def insert_comp(property_id, comp_type, address, price, bedrooms, property_type,
                url, date_info, distance_m="", distance_label="", source="Zoopla",
                floor_area_sqm=""):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute("""INSERT INTO zp_comps
            (property_id, comp_type, address, price, bedrooms, property_type, url,
             date_info, distance_m, distance_label, source, floor_area_sqm, fetched_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (property_id, comp_type, address, price, bedrooms, property_type, url,
             date_info, distance_m, distance_label, source, floor_area_sqm, now))


def clear_comps(property_id):
    with _LOCK, _conn() as c:
        c.execute("DELETE FROM zp_comps WHERE property_id=?", (property_id,))


def properties_needing_comps():
    """Zoopla 'potential' listings that have no comps yet."""
    with _LOCK, _conn() as c:
        return [dict(r) for r in c.execute("""
            SELECT l.property_id, l.listing_url, l.price, l.price_qualifier,
                   l.address, l.bedrooms, l.property_type
            FROM zp_listings l JOIN zp_reviews r ON l.property_id = r.property_id
            LEFT JOIN zp_comps c ON l.property_id = c.property_id
            WHERE r.status = 'potential' AND c.id IS NULL
            GROUP BY l.property_id ORDER BY r.reviewed_at DESC""")]


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


# ── Enquiries sent (reCAPTCHA-solved Zoopla "Email agent") ──────────────────
def _ensure_enquiry_table(c):
    c.execute("""CREATE TABLE IF NOT EXISTS zp_enquired (
        property_id TEXT PRIMARY KEY, enquired_at TEXT, ok INTEGER,
        dry_run INTEGER DEFAULT 0, error TEXT)""")


def set_enquired(property_id, ok, dry_run=False, error=""):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        _ensure_enquiry_table(c)
        c.execute("""INSERT INTO zp_enquired (property_id, enquired_at, ok, dry_run, error)
            VALUES (?,?,?,?,?) ON CONFLICT(property_id) DO UPDATE SET
              enquired_at=excluded.enquired_at, ok=excluded.ok,
              dry_run=excluded.dry_run, error=excluded.error""",
            (property_id, now, 1 if ok else 0, 1 if dry_run else 0, error))


def get_enquired_map():
    with _LOCK, _conn() as c:
        _ensure_enquiry_table(c)
        return {r["property_id"]: r["enquired_at"] for r in c.execute(
            "SELECT property_id, enquired_at FROM zp_enquired WHERE ok=1 AND dry_run=0")}
