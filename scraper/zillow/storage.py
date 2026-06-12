"""Zillow SQLite storage — the US realtor lead-gen channel.

Model differs from the UK property side: here the LEAD is the agent (realtor),
not the property. We enquire as a buyer on one listing per agent to trigger a
callback, then Elsie reveals (in 20s) and pitches the AI receptionist. So the
flow mirrors rent-to-rent: scrape -> one listing per agent -> enquire -> agent
calls back -> blacklist. We also capture the agent's direct phone.

Shares the same scraper.db file (zil_* tables); UK pipelines untouched.
"""
import datetime
import threading
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "scraper.db"
_LOCK = threading.RLock()


def _conn():
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db():
    with _LOCK, _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS zil_listings (
            zpid TEXT PRIMARY KEY,
            listing_url TEXT,
            price TEXT, price_num INTEGER,
            address TEXT, city TEXT, state TEXT,
            beds INTEGER, baths REAL, sqft INTEGER,
            brokerage TEXT,
            agent_name TEXT, agent_phone TEXT, agent_key TEXT,
            search_url TEXT, first_seen TEXT, updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS zil_blacklist (
            agent_key TEXT PRIMARY KEY,
            agent_name TEXT, agent_phone TEXT,
            zpid TEXT, address TEXT,
            confirmed INTEGER DEFAULT 0,
            added_at TEXT
        );
        CREATE TABLE IF NOT EXISTS zil_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            urls_total INTEGER, started_at TEXT, finished_at TEXT
        );
        """)


def upsert_listing(row, search_url=None):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        init_db()
        existing = c.execute("SELECT zpid FROM zil_listings WHERE zpid=?",
                             (row["zpid"],)).fetchone()
        c.execute("""
            INSERT INTO zil_listings
              (zpid, listing_url, price, price_num, address, city, state, beds,
               baths, sqft, brokerage, agent_name, agent_phone, agent_key,
               search_url, first_seen, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(zpid) DO UPDATE SET
              listing_url=excluded.listing_url, price=excluded.price,
              price_num=excluded.price_num, address=excluded.address,
              beds=excluded.beds, baths=excluded.baths, sqft=excluded.sqft,
              brokerage=COALESCE(excluded.brokerage, zil_listings.brokerage),
              agent_name=COALESCE(excluded.agent_name, zil_listings.agent_name),
              agent_phone=COALESCE(excluded.agent_phone, zil_listings.agent_phone),
              agent_key=COALESCE(excluded.agent_key, zil_listings.agent_key),
              updated_at=excluded.updated_at
        """, (row["zpid"], row.get("listing_url"), row.get("price"), row.get("price_num"),
              row.get("address"), row.get("city"), row.get("state"), row.get("beds"),
              row.get("baths"), row.get("sqft"), row.get("brokerage"),
              row.get("agent_name"), row.get("agent_phone"), row.get("agent_key"),
              search_url, now, now))
        return existing is None


def update_agent(zpid, agent_name, agent_phone, agent_key):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute("""UPDATE zil_listings SET agent_name=?, agent_phone=?, agent_key=?,
                     updated_at=? WHERE zpid=?""",
                  (agent_name, agent_phone, agent_key, now, zpid))


def get_listing(zpid):
    with _LOCK, _conn() as c:
        r = c.execute("SELECT * FROM zil_listings WHERE zpid=?", (zpid,)).fetchone()
        return dict(r) if r else None


def agents_to_enquire():
    """One listing per agent we haven't messaged yet (cheapest), excluding
    blacklisted agents and rows with no identifiable agent."""
    with _LOCK, _conn() as c:
        init_db()
        return [dict(r) for r in c.execute("""
            SELECT l.* FROM zil_listings l
            JOIN (
                SELECT agent_key, MIN(COALESCE(price_num, 999999999)) AS min_p
                FROM zil_listings
                WHERE agent_key IS NOT NULL
                  AND agent_key NOT IN (SELECT agent_key FROM zil_blacklist)
                GROUP BY agent_key
            ) m ON l.agent_key = m.agent_key
               AND COALESCE(l.price_num, 999999999) = m.min_p
            GROUP BY l.agent_key
            ORDER BY l.price_num ASC""")]


def listings_without_agent(limit=100):
    """Scraped listings still missing the agent (need a detail-page visit)."""
    with _LOCK, _conn() as c:
        init_db()
        return [dict(r) for r in c.execute(
            "SELECT * FROM zil_listings WHERE agent_key IS NULL ORDER BY first_seen DESC LIMIT ?",
            (limit,))]


def counts():
    with _LOCK, _conn() as c:
        init_db()
        total = c.execute("SELECT COUNT(*) n FROM zil_listings").fetchone()["n"]
        agents = c.execute("SELECT COUNT(DISTINCT agent_key) n FROM zil_listings WHERE agent_key IS NOT NULL").fetchone()["n"]
        blacklisted = c.execute("SELECT COUNT(*) n FROM zil_blacklist").fetchone()["n"]
        return {"total": total, "agents": agents, "blacklisted": blacklisted,
                "to_enquire": len(agents_to_enquire())}


# ── Blacklist (manual-remove only; confirmed = enquiry confirmation showed) ──
def blacklist_agent(agent_key, agent_name="", agent_phone="", zpid="", address="", confirmed=False):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        init_db()
        c.execute("""INSERT INTO zil_blacklist (agent_key, agent_name, agent_phone, zpid, address, confirmed, added_at)
                     VALUES (?,?,?,?,?,?,?)
                     ON CONFLICT(agent_key) DO UPDATE SET
                       confirmed = MAX(zil_blacklist.confirmed, excluded.confirmed)""",
                  (agent_key, agent_name, agent_phone, zpid, address, 1 if confirmed else 0, now))


def unblacklist_agent(agent_key):
    with _LOCK, _conn() as c:
        c.execute("DELETE FROM zil_blacklist WHERE agent_key=?", (agent_key,))


def is_blacklisted(agent_key):
    with _LOCK, _conn() as c:
        return c.execute("SELECT 1 FROM zil_blacklist WHERE agent_key=?", (agent_key,)).fetchone() is not None


def get_blacklist():
    now = datetime.datetime.now()
    with _LOCK, _conn() as c:
        init_db()
        out = []
        for r in c.execute("SELECT * FROM zil_blacklist ORDER BY added_at DESC"):
            d = dict(r)
            try:
                d["days_on_blacklist"] = (now - datetime.datetime.fromisoformat(d["added_at"])).days
            except Exception:
                d["days_on_blacklist"] = None
            out.append(d)
        return out


def create_session(urls):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        init_db()
        return c.execute("INSERT INTO zil_sessions (urls_total, started_at) VALUES (?,?)",
                         (len(urls), now)).lastrowid


def finish_session(sid):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with _LOCK, _conn() as c:
        c.execute("UPDATE zil_sessions SET finished_at=? WHERE id=?", (now, sid))
