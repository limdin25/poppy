"""TDD for the Zoopla scraper's pure parsing + storage round-trip.

No browser, no network. Run: cd scraper && .venv/bin/python -m pytest test_zoopla.py -q
"""
import os
import tempfile
import importlib

import pytest

from zoopla_scraper import (
    listing_id_from_url, parse_price, parse_int_label, parse_property_type,
    parse_zoopla_card, is_cloudflare,
    parse_rent_pcm, parse_zoopla_rent_card, agent_key, _clean_agent,
)


# ── URL / price / labels ─────────────────────────────────────────────────────
def test_listing_id_from_url():
    assert listing_id_from_url("https://www.zoopla.co.uk/for-sale/details/62846722/") == "62846722"
    assert listing_id_from_url("https://www.zoopla.co.uk/for-sale/details/46944431/?x=1") == "46944431"
    assert listing_id_from_url("https://www.zoopla.co.uk/for-sale/property/coventry/") is None
    assert listing_id_from_url("") is None


def test_parse_price():
    assert parse_price("£180,000\n\nSee monthly cost") == 180000
    assert parse_price("£1,250,000") == 1250000
    assert parse_price("Offers over £95,000") == 95000
    assert parse_price("POA") is None
    assert parse_price("") is None


def test_parse_int_label():
    t = "£180,000 See monthly cost 2 beds 2 baths 2 receptions Shakleton Road"
    assert parse_int_label(t, "beds?", "bedrooms?") == 2
    assert parse_int_label(t, "baths?") == 2
    assert parse_int_label(t, "receptions?") == 2
    assert parse_int_label("3 bed terraced house", "beds?", "bedrooms?") == 3
    assert parse_int_label("no beds here", "garages?") is None


def test_parse_property_type():
    assert parse_property_type("Spacious end of terrace property") == "Terraced"
    assert parse_property_type("2 bed flat for sale") == "Flat"
    assert parse_property_type("modern apartment") == "Flat"
    assert parse_property_type("semi-detached house") == "Semi-Detached"
    assert parse_property_type("detached bungalow") == "Bungalow"   # bungalow wins (listed first)
    assert parse_property_type("a lovely home") is None


# ── Card parsing (real captured shapes) ──────────────────────────────────────
def test_parse_card_terraced_investment():
    card = {
        "id": "62846722",
        "url": "https://www.zoopla.co.uk/for-sale/details/62846722/",
        "price": "£180,000\n\nSee monthly cost",
        "title": "Shakleton Road, Earlsdon CV5",
        "full_text": "Highlight 1/14 £180,000 See monthly cost 2 beds 2 baths 2 receptions "
                     "Shakleton Road, Earlsdon CV5 excellent investment property terraced",
    }
    row = parse_zoopla_card(card)
    assert row["property_id"] == "62846722"
    assert row["source"] == "zoopla"
    assert row["price"] == "£180,000"
    assert row["address"] == "Shakleton Road, Earlsdon CV5"
    assert row["bedrooms"] == 2
    assert row["bathrooms"] == 2
    assert row["receptions"] == 2
    assert row["property_type"] == "Terraced"


def test_parse_card_end_of_terrace():
    card = {
        "id": "72453146",
        "url": "https://www.zoopla.co.uk/for-sale/details/72453146/?search=abc",
        "price": "£250,000\n\nSee monthly cost",
        "title": "Priors Harnall CV1",
        "full_text": "£250,000 3 beds 2 baths 1 reception Priors Harnall CV1 "
                     "no upward chain Spacious end of terrace property",
    }
    row = parse_zoopla_card(card)
    assert row["property_id"] == "72453146"
    assert row["listing_url"] == "https://www.zoopla.co.uk/for-sale/details/72453146/"
    assert row["bedrooms"] == 3
    assert row["property_type"] == "Terraced"


def test_parse_card_id_from_url_when_missing():
    card = {"url": "https://www.zoopla.co.uk/for-sale/details/99/", "full_text": "1 bed flat"}
    row = parse_zoopla_card(card)
    assert row["property_id"] == "99"
    assert row["bedrooms"] == 1


def test_parse_card_returns_none_without_id():
    assert parse_zoopla_card({"full_text": "no id here"}) is None


def test_is_cloudflare():
    assert is_cloudflare("Just a moment...") is True
    assert is_cloudflare("Property for sale in Coventry - Zoopla") is False


# ── Storage round-trip (temp DB) ─────────────────────────────────────────────
@pytest.fixture
def store(tmp_path, monkeypatch):
    import zoopla_storage as zs
    monkeypatch.setattr(zs, "DB_PATH", tmp_path / "test.db")
    zs.init_db()
    return zs


def test_upsert_new_then_dup(store):
    row = parse_zoopla_card({
        "id": "111", "url": "https://www.zoopla.co.uk/for-sale/details/111/",
        "price": "£100,000", "title": "Test Road, CV1", "full_text": "2 beds flat",
    })
    assert store.upsert_listing(row, "search1") is True      # new
    assert store.upsert_listing(row, "search1") is False     # duplicate
    got = store.get_listing("111")
    assert got["address"] == "Test Road, CV1"
    assert got["bedrooms"] == 2


def test_new_listing_is_pending_then_potential(store):
    row = parse_zoopla_card({"id": "222", "url": ".../details/222/", "full_text": "1 bed flat", "price": "£90,000"})
    store.upsert_listing(row)
    assert [r["property_id"] for r in store.listings_for_review("pending")] == ["222"]
    store.set_review("222", "potential")
    assert store.listings_for_review("pending") == []
    assert [p["property_id"] for p in store.shortlist_with_comps()] == ["222"]


def test_counts(store):
    store.upsert_listing(parse_zoopla_card({"id": "1", "url": ".../details/1/", "price": "£1", "full_text": "1 bed"}))
    store.upsert_listing(parse_zoopla_card({"id": "2", "url": ".../details/2/", "price": "£2", "full_text": "2 beds"}))
    store.set_review("2", "potential")
    c = store.counts()
    assert c["total"] == 2 and c["pending"] == 1 and c["potential"] == 1


# ── Rentals: rent parsing, agent, one-per-agent, blacklist ───────────────────
def test_parse_rent_pcm():
    assert parse_rent_pcm("£1,000 pcm") == 1000
    assert parse_rent_pcm("£500 pcm (£115 pw)") == 500          # pcm wins
    assert parse_rent_pcm("£230 pw") == round(230 * 52 / 12)    # weekly -> monthly
    assert parse_rent_pcm("£1,250") == 1250
    assert parse_rent_pcm("POA") is None


def test_clean_agent_skips_carousel_alt():
    assert _clean_agent(["Property 1 of 10. ", "Keystone Homes"]) == "Keystone Homes"
    assert _clean_agent(["Photo of bedroom", "M&M Lettings"]) == "M&M Lettings"
    assert _clean_agent(["Property 2 of 4"]) is None


def test_agent_key_normalises():
    assert agent_key("Keystone Homes") == "keystonehomes"
    assert agent_key("M&M Sales, Lettings & Management Ltd") == "mmsaleslettingsmanagementltd"
    assert agent_key("keystone homes") == agent_key("Keystone Homes")
    assert agent_key("") is None


def test_parse_rent_card():
    card = {
        "id": "72161377",
        "url": "https://www.zoopla.co.uk/to-rent/details/72161377/",
        "rent": "£1,000 pcm",
        "title": "Lilac Avenue, Coventry CV6",
        "full_text": "£1,000 pcm (£230 pw) 2 beds 1 bath 1 reception Lilac Avenue, Coventry CV6 flat",
        "agent_alts": ["Property 1 of 10. ", "Keystone Homes"],
    }
    row = parse_zoopla_rent_card(card)
    assert row["listing_type"] == "rent"
    assert row["rent_pcm"] == 1000
    assert row["price"] == "£1,000 pcm"
    assert row["bedrooms"] == 2
    assert row["agent_name"] == "Keystone Homes"
    assert row["agent_key"] == "keystonehomes"


def test_rentals_one_cheapest_per_agent(store):
    # Keystone has two rentals; we keep only the cheaper. M&M has one.
    for pid, rent, ak, an in [("a1", 1000, "keystonehomes", "Keystone Homes"),
                              ("a2", 800, "keystonehomes", "Keystone Homes"),
                              ("b1", 500, "mmlettings", "M&M Lettings")]:
        store.upsert_listing({"property_id": pid, "listing_type": "rent",
                              "listing_url": f".../{pid}/", "price": f"£{rent} pcm",
                              "rent_pcm": rent, "address": "x", "agent_name": an,
                              "agent_key": ak})
    rows = store.rental_agents_to_message()
    by_agent = {r["agent_key"]: r for r in rows}
    assert set(by_agent) == {"keystonehomes", "mmlettings"}
    assert by_agent["keystonehomes"]["property_id"] == "a2"   # the £800 one
    assert by_agent["mmlettings"]["rent_pcm"] == 500


def test_blacklist_excludes_agent(store):
    for pid, ak, an in [("a1", "keystonehomes", "Keystone Homes"),
                        ("b1", "mmlettings", "M&M Lettings")]:
        store.upsert_listing({"property_id": pid, "listing_type": "rent",
                              "listing_url": f".../{pid}/", "rent_pcm": 700,
                              "address": "x", "agent_name": an, "agent_key": ak})
    assert len(store.rental_agents_to_message()) == 2
    store.blacklist_agent("keystonehomes", "Keystone Homes", "a1", "x")
    rows = store.rental_agents_to_message()
    assert [r["agent_key"] for r in rows] == ["mmlettings"]      # keystone excluded
    assert store.is_blacklisted("keystonehomes") is True
    # blacklist view shows days-since
    bl = store.get_blacklist()
    assert bl[0]["agent_key"] == "keystonehomes"
    assert bl[0]["days_on_blacklist"] == 0
    # manual removal restores them
    store.unblacklist_agent("keystonehomes")
    assert len(store.rental_agents_to_message()) == 2


def test_blacklist_confirmed_flag(store):
    # confirmed=True only when the 'email sent' page showed
    store.blacklist_agent("a1", "Agent One", "p1", "addr", confirmed=True)
    store.blacklist_agent("a2", "Agent Two", "p2", "addr", confirmed=False)
    bl = {b["agent_key"]: b for b in store.get_blacklist()}
    assert bl["a1"]["confirmed"] == 1
    assert bl["a2"]["confirmed"] == 0
    # a later confirmed send upgrades an unconfirmed entry, never downgrades
    store.blacklist_agent("a2", "Agent Two", "p2", "addr", confirmed=True)
    assert {b["agent_key"]: b["confirmed"] for b in store.get_blacklist()}["a2"] == 1
    store.blacklist_agent("a1", "Agent One", "p1", "addr", confirmed=False)
    assert {b["agent_key"]: b["confirmed"] for b in store.get_blacklist()}["a1"] == 1  # stays confirmed
