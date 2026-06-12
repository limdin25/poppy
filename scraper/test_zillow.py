"""TDD for the Zillow parser + storage (no browser, no network).

Run: cd scraper && .venv/bin/python -m pytest test_zillow.py -q
"""
import pytest
from zillow.scraper import (
    zpid_from_url, parse_price, parse_int, parse_baths, agent_key, phone_key,
    parse_listed_by, parse_search_card, is_perimeterx, resolve_agent_key,
)


def test_zpid_from_url():
    assert zpid_from_url("https://www.zillow.com/homedetails/1724-Canon-Yeomans-Trl-Austin-TX-78748/29513162_zpid/") == "29513162"
    assert zpid_from_url("https://www.zillow.com/austin-tx/") is None
    assert zpid_from_url("") is None


def test_parse_price():
    assert parse_price("$310,000") == 310000
    assert parse_price("$1,250,000 4 bds") == 1250000
    assert parse_price("Est. payment") is None


def test_parse_int_and_baths():
    t = "$310,000 4 bds2 ba1,900 sqftActive"
    assert parse_int(t, "bds", "bd") == 4
    assert parse_int(t, "sqft") == 1900
    assert parse_baths(t) == 2.0
    assert parse_baths("3 bds2.5 ba") == 2.5


def test_agent_and_phone_keys():
    assert agent_key("Lindsay Neuren") == "lindsayneuren"
    assert agent_key("COMPASS RE Texas, LLC") == "compassretexasllc"
    assert phone_key("(512) 913-6987") == "5129136987"
    assert phone_key("+1 (512) 913-6987") == "5129136987"   # US country code dropped
    assert agent_key("") is None
    assert phone_key("") is None


def test_resolve_agent_key_prefers_phone():
    # Same agent, name written differently on two listings, same direct line ->
    # ONE key, so she is never enquired twice.
    a = resolve_agent_key("Lindsay Neuren", "(512) 913-6987")
    b = resolve_agent_key("Lindsay Neuren | Speed & Neuren Group", "512-913-6987")
    assert a == b == "5129136987"
    # No phone -> fall back to the name.
    assert resolve_agent_key("John Smith", None) == "johnsmith"
    assert resolve_agent_key("John Smith", "") == "johnsmith"
    # Two different agents at the same brokerage have different direct numbers,
    # so the company repeats but the agents stay distinct.
    assert resolve_agent_key("Agent A", "(512) 111-1111") != resolve_agent_key("Agent B", "(512) 222-2222")


def test_same_agent_two_listings_one_enquiry(store):
    # Lindsay has two listings under slightly different name strings but the same
    # phone; a colleague at the same brokerage has a different phone.
    rows = [("1", 300000, "Lindsay Neuren", "(512) 913-6987"),
            ("2", 250000, "Lindsay Neuren | Speed & Neuren Group", "512-913-6987"),
            ("3", 400000, "Colleague Carl", "(512) 555-5555")]
    for zpid, p, name, phone in rows:
        store.upsert_listing({"zpid": zpid, "listing_url": f".../{zpid}_zpid/",
                              "price_num": p, "address": "x", "agent_name": name,
                              "agent_phone": phone,
                              "agent_key": resolve_agent_key(name, phone)})
    out = store.agents_to_enquire()
    keys = sorted(r["agent_key"] for r in out)
    assert keys == ["5125555555", "5129136987"]          # two agents, not three
    lindsay = [r for r in out if r["agent_key"] == "5129136987"][0]
    assert lindsay["zpid"] == "2"                          # her cheaper listing


def test_parse_listed_by():
    name, phone, bro = parse_listed_by("Listed by: Lindsay Neuren (512) 913-6987, Compass RE Texas, LLC")
    assert name == "Lindsay Neuren"
    assert phone == "(512) 913-6987"
    assert "Compass RE Texas" in bro


def test_parse_listed_by_no_phone():
    name, phone, bro = parse_listed_by("Listed by: John Smith, Keller Williams")
    assert name == "John Smith"
    assert phone is None


def test_parse_search_card():
    card = {
        "zpid": "331624801",
        "url": "https://www.zillow.com/homedetails/15217-Upland-Willow-Rd-Austin-TX-78724/331624801_zpid/",
        "price": "$310,000",
        "address": "15217 Upland Willow Rd, Austin, TX 78724",
        "brokerage": "LPT REALTY, LLC",
        "full_text": "$310,000 4 bds2 ba1,900 sqftActive 15217 Upland Willow Rd, Austin, TX 78724 LPT REALTY, LLC",
    }
    row = parse_search_card(card)
    assert row["zpid"] == "331624801"
    assert row["price"] == "$310,000"
    assert row["price_num"] == 310000
    assert row["beds"] == 4
    assert row["baths"] == 2.0
    assert row["sqft"] == 1900
    assert row["brokerage"] == "LPT REALTY, LLC"
    assert row["agent_key"] is None   # filled later from the detail page


def test_parse_card_zpid_from_url():
    row = parse_search_card({"url": ".../99887766_zpid/", "full_text": "$200,000 3 bds"})
    assert row["zpid"] == "99887766"


def test_is_perimeterx():
    assert is_perimeterx("Access to this page has been denied") is True
    assert is_perimeterx("Home", "Please press & hold") is True
    assert is_perimeterx("1724 Canon Yeomans Trl, Austin, TX | Zillow") is False


# ── storage: one-per-agent + blacklist ──────────────────────────────────────
@pytest.fixture
def store(tmp_path, monkeypatch):
    from zillow import storage as s
    monkeypatch.setattr(s, "DB_PATH", tmp_path / "t.db")
    s.init_db()
    return s


def test_one_listing_per_agent_cheapest(store):
    for zpid, p, ak, an in [("1", 300000, "lindsay", "Lindsay"),
                            ("2", 250000, "lindsay", "Lindsay"),
                            ("3", 400000, "john", "John")]:
        store.upsert_listing({"zpid": zpid, "listing_url": f".../{zpid}_zpid/",
                              "price": f"${p}", "price_num": p, "address": "x",
                              "agent_name": an, "agent_key": ak})
    rows = {r["agent_key"]: r for r in store.agents_to_enquire()}
    assert set(rows) == {"lindsay", "john"}
    assert rows["lindsay"]["zpid"] == "2"   # the $250k one


def test_blacklist_excludes_and_confirms(store):
    for zpid, ak in [("1", "lindsay"), ("2", "john")]:
        store.upsert_listing({"zpid": zpid, "listing_url": f".../{zpid}_zpid/",
                              "price_num": 300000, "address": "x", "agent_name": ak, "agent_key": ak})
    assert len(store.agents_to_enquire()) == 2
    store.blacklist_agent("lindsay", "Lindsay", "(512) 913-6987", "1", "x", confirmed=True)
    rows = store.agents_to_enquire()
    assert [r["agent_key"] for r in rows] == ["john"]
    bl = store.get_blacklist()
    assert bl[0]["agent_key"] == "lindsay" and bl[0]["confirmed"] == 1
    store.unblacklist_agent("lindsay")
    assert len(store.agents_to_enquire()) == 2
