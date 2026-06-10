"""Tests for the valuation engine — written FIRST (TDD).

The three named fixtures are the real properties from Hugo's 2026-06-10 bug
report, with their actual Land Registry comps from scraper.db. The old engine
produced offers ABOVE asking on all three; these tests pin the correct
behaviour forever.

Run:  .venv/bin/python -m pytest test_valuation.py -q
"""
import datetime
import pytest

from valuation import value_property, sdlt_additional, DEFAULT_CONFIG

TODAY = datetime.date(2026, 6, 10)


def comp(comp_type, price, date_info, distance_m=0, distance_label="Same road",
         source="Land Registry", sqm="", address="X street"):
    return {
        "comp_type": comp_type, "price": price, "date_info": date_info,
        "distance_m": str(distance_m), "distance_label": distance_label,
        "source": source, "floor_area_sqm": str(sqm), "address": address,
    }


# ── Real case 1: Clyde Street, Gateshead ─────────────────────────────────────
# Asking OIEO £85,000 but the street's 2-beds sell at £40-55k. Old engine said
# "offer £125,125–£134,063". Correct: overpriced, offer way below asking.
CLYDE_SUBJECT = {
    "price": "£85,000", "price_qualifier": "Offers in Excess of",
    "bedrooms": "2", "property_type": "Flat", "floor_area_sqm": "",
    "is_auction": "0", "address": "Clyde Street, Gateshead, NE8",
}
CLYDE_COMPS = [
    comp("sale_same", "£44,000", "2024-10-29", sqm=66, address="30 CLYDE STREET"),
    comp("sale_same", "£50,000", "2024-06-13", sqm=66, address="36 CLYDE STREET"),
    comp("sale_same", "£40,000", "2024-06-11", sqm=66, address="30 CLYDE STREET"),
    comp("sale_same", "£55,000", "2022-10-24", sqm=65, address="12 CLYDE STREET"),
    comp("sale_same", "£53,000", "2020-11-09", sqm=69, address="8 CLYDE STREET"),   # >60mo — must be dropped
    comp("sale_target", "£60,000", "2023-05-10", sqm=67, address="32 CLYDE STREET"),
]


class TestClydeStreet:
    def setup_method(self):
        self.r = value_property(CLYDE_SUBJECT, CLYDE_COMPS, today=TODAY)

    def test_cmv_reflects_street_not_asking(self):
        assert self.r["cmv"]["estimate"] is not None
        assert 40_000 <= self.r["cmv"]["estimate"] <= 55_000

    def test_offer_never_above_asking(self):
        assert self.r["offer"]["max"] is not None
        assert self.r["offer"]["max"] <= 85_000
        assert self.r["offer"]["open"] <= self.r["offer"]["max"]

    def test_offer_is_fraction_of_cmv_not_gdv(self):
        # 75% of CMV (~£47k) is ~£35k; the old GDV-based bug produced £134k
        assert self.r["offer"]["max"] <= 0.80 * self.r["cmv"]["estimate"]

    def test_verdict_overpriced(self):
        assert self.r["offer"]["verdict"] == "overpriced"

    def test_gdv_insufficient_single_comp(self):
        assert self.r["gdv"]["estimate"] is None
        assert self.r["gdv"]["confidence"] == "insufficient"

    def test_stale_comp_excluded(self):
        # the 2020 sale is older than 60 months
        assert self.r["cmv"]["n_used"] == 4


# ── Real case 2: 114 Westminster Street, Gateshead (auction, guide £45k) ────
# Neighbours sold at £75-83k — the guide is far below market. Old engine said
# "offer £127,750". Correct: worth ~£80k, bid capped sensibly, flagged.
WESTMINSTER_SUBJECT = {
    "price": "£45,000", "price_qualifier": "Guide Price",
    "bedrooms": "2", "property_type": "Apartment", "floor_area_sqm": "",
    "is_auction": "1", "address": "114 Westminster Street, Gateshead NE8 4QH",
}
WESTMINSTER_COMPS = [
    comp("sale_same", "£80,000", "2025-12-12", 82, "~100m", sqm=70, address="10 HYDE PARK ST"),
    comp("sale_same", "£83,000", "2025-05-30", 82, "~100m", sqm=67, address="12 HYDE PARK ST"),
    comp("sale_same", "£75,000", "2022-11-10", 82, "~100m", sqm=65, address="14 HYDE PARK ST"),
    comp("sale_same", "£75,000", "2022-11-10", 82, "~100m", sqm=70, address="14 HYDE PARK ST"),  # duplicate sale
    comp("sale_same", "£48,000", "2022-08-05", 82, "~100m", sqm=67, address="101 HYDE PARK ST"),  # distress-priced
    comp("sale_target", "£66,000", "2025-10-31", 82, "~100m", sqm=68, address="20 HYDE PARK ST"),
    comp("sale_target", "£83,000", "2025-05-30", 82, "~100m", sqm=64, address="22 HYDE PARK ST"),
    comp("sale_target", "£80,000", "2024-03-22", 82, "~100m", sqm=64, address="24 HYDE PARK ST"),
    comp("sale_target", "£60,000", "2022-09-09", 82, "~100m", sqm=62, address="26 HYDE PARK ST"),
    comp("sale_target", "£48,000", "2022-08-05", 82, "~100m", sqm=64, address="101 HYDE PARK ST"),
]


class TestWestminsterStreet:
    def setup_method(self):
        self.r = value_property(WESTMINSTER_SUBJECT, WESTMINSTER_COMPS, today=TODAY)

    def test_cmv_near_street_levels(self):
        assert 70_000 <= self.r["cmv"]["estimate"] <= 90_000

    def test_duplicate_comp_deduped(self):
        addrs = [a["address"] for a in self.r["cmv"]["audit"]]
        assert len([a for a in addrs if "14 HYDE" in a]) == 1

    def test_distress_sale_excluded_from_estimate(self):
        excluded = [a for a in self.r["cmv"]["audit"] if not a["included"]]
        assert any("distress" in (a.get("reason") or "") for a in excluded)

    def test_auction_mode(self):
        assert self.r["offer"]["mode"] == "auction"
        # max bid never exceeds 75% of CMV
        assert self.r["offer"]["max"] <= 0.76 * self.r["cmv"]["estimate"]
        # and the engine knows the likely hammer is above guide
        assert self.r["offer"]["expected_hammer"] == pytest.approx(45_000 * 1.2, rel=0.01)

    def test_cheap_asking_flagged_not_trusted(self):
        assert any("suspicious" in f or "cheap" in f for f in self.r["offer"]["flags"])

    def test_gdv_conversion_adds_no_value_flagged(self):
        # 3-beds sell for no more than 2-beds here — must be flagged
        assert self.r["gdv"]["estimate"] is not None
        assert any("conversion_adds_no_value" in f for f in self.r["gdv"]["flags"])


# ── Real case 3: Betsham Street, Manchester (asking £150k) ───────────────────
# Only two usable 2-bed sales, both 3+ years old, sizes wildly different.
# Old engine said "offer £145,600–£156,000" (above asking!). Correct: the
# honest answer is insufficient evidence — do not generate an offer.
BETSHAM_SUBJECT = {
    "price": "£150,000", "price_qualifier": "",
    "bedrooms": "2", "property_type": "Flat", "floor_area_sqm": "",
    "is_auction": "0", "address": "Betsham Street, Manchester M15",
}
BETSHAM_COMPS = [
    comp("sale_same", "£170,000", "2023-03-21", sqm=115, address="21 BETSHAM ST"),
    comp("sale_same", "£140,000", "2022-08-01", sqm=58, address="1 BETSHAM ST"),
    comp("sale_same", "£130,000", "2020-12-21", sqm=59, address="5 BETSHAM ST"),  # >60mo
    comp("sale_target", "£285,000", "2023-08-22", sqm=103, address="10 BETSHAM ST"),
    comp("sale_target", "£225,000", "2023-04-28", sqm=107, address="22 BETSHAM ST"),
    comp("sale_target", "£235,000", "2022-03-25", sqm=102, address="24 BETSHAM ST"),
]


class TestBetshamStreet:
    def setup_method(self):
        self.r = value_property(BETSHAM_SUBJECT, BETSHAM_COMPS, today=TODAY)

    def test_insufficient_cmv_evidence(self):
        assert self.r["cmv"]["estimate"] is None
        assert self.r["cmv"]["confidence"] == "insufficient"

    def test_no_offer_without_cmv(self):
        assert self.r["offer"]["open"] is None
        assert self.r["offer"]["max"] is None
        assert self.r["offer"]["verdict"] == "insufficient_data"


# ── Invariants and units ─────────────────────────────────────────────────────

class TestInvariants:
    def test_no_comps_no_numbers(self):
        r = value_property(CLYDE_SUBJECT, [], today=TODAY)
        assert r["cmv"]["estimate"] is None
        assert r["gdv"]["estimate"] is None
        assert r["offer"]["verdict"] == "insufficient_data"

    def test_offer_never_derived_from_gdv(self):
        # CMV comps say ~£50k; GDV comps say ~£200k. Offer must track CMV.
        subject = dict(CLYDE_SUBJECT, price="£60,000", price_qualifier="")
        comps = [
            comp("sale_same", "£50,000", "2025-06-01", address="1 A ST"),
            comp("sale_same", "£52,000", "2025-03-01", address="2 A ST"),
            comp("sale_same", "£48,000", "2024-11-01", address="3 A ST"),
            comp("sale_target", "£200,000", "2025-05-01", address="4 A ST"),
            comp("sale_target", "£210,000", "2025-02-01", address="5 A ST"),
            comp("sale_target", "£190,000", "2024-10-01", address="6 A ST"),
        ]
        r = value_property(subject, comps, today=TODAY)
        assert r["offer"]["max"] <= 0.80 * r["cmv"]["estimate"]
        assert r["offer"]["max"] < 100_000  # nowhere near GDV-based maths

    def test_offer_capped_at_asking_when_cmv_higher(self):
        subject = dict(CLYDE_SUBJECT, price="£40,000", price_qualifier="", is_auction="0")
        comps = [
            comp("sale_same", "£80,000", "2025-06-01", address="1 B ST"),
            comp("sale_same", "£82,000", "2025-03-01", address="2 B ST"),
            comp("sale_same", "£78,000", "2024-11-01", address="3 B ST"),
        ]
        r = value_property(subject, comps, today=TODAY)
        assert r["offer"]["max"] <= 40_000
        assert any("suspicious" in f or "cheap" in f for f in r["offer"]["flags"])

    def test_gdv_capped_vs_cmv(self):
        # GDV comps 3x the CMV — must be capped at 1.30 × CMV and flagged
        subject = dict(CLYDE_SUBJECT, price="£50,000", price_qualifier="")
        comps = [
            comp("sale_same", "£50,000", "2025-06-01", address="1 C ST"),
            comp("sale_same", "£52,000", "2025-03-01", address="2 C ST"),
            comp("sale_same", "£48,000", "2024-11-01", address="3 C ST"),
            comp("sale_target", "£150,000", "2025-05-01", 300, "~300m", address="4 OTHER ST"),
            comp("sale_target", "£160,000", "2025-02-01", 300, "~300m", address="5 OTHER ST"),
            comp("sale_target", "£155,000", "2024-10-01", 300, "~300m", address="6 OTHER ST"),
        ]
        r = value_property(subject, comps, today=TODAY)
        assert r["gdv"]["estimate"] <= 1.31 * r["cmv"]["estimate"]
        assert any("uplift_exceeds" in f for f in r["gdv"]["flags"])

    def test_ladder_is_monotonic_and_rounded(self):
        subject = dict(CLYDE_SUBJECT, price="£100,000", price_qualifier="")
        comps = [
            comp("sale_same", "£100,000", "2025-06-01", address="1 D ST"),
            comp("sale_same", "£104,000", "2025-03-01", address="2 D ST"),
            comp("sale_same", "£98,000", "2024-11-01", address="3 D ST"),
            comp("sale_same", "£101,000", "2024-09-01", address="4 D ST"),
            comp("sale_same", "£99,000", "2024-07-01", address="5 D ST"),
        ]
        r = value_property(subject, comps, today=TODAY)
        ladder = r["offer"]["ladder"]
        assert ladder == sorted(ladder)
        assert all(step % 500 == 0 for step in ladder[:-1])
        assert ladder[-1] % 50 == 0
        assert ladder[0] == r["offer"]["open"]
        assert ladder[-1] == r["offer"]["max"]


class TestSDLT:
    def test_bands(self):
        assert sdlt_additional(45_000) == pytest.approx(2_250)
        assert sdlt_additional(125_000) == pytest.approx(6_250)
        assert sdlt_additional(150_000) == pytest.approx(6_250 + 1_750)
        assert sdlt_additional(300_000) == pytest.approx(6_250 + 8_750 + 5_000)


class TestStack:
    def test_stack_with_real_gdv(self):
        # Buy 105k, GDV 235k — classic stacking deal
        subject = dict(BETSHAM_SUBJECT)
        comps = [
            comp("sale_same", "£140,000", "2025-06-01", address="1 E ST"),
            comp("sale_same", "£145,000", "2025-03-01", address="2 E ST"),
            comp("sale_same", "£138,000", "2024-11-01", address="3 E ST"),
            comp("sale_target", "£235,000", "2025-05-01", address="4 E ST"),
            comp("sale_target", "£240,000", "2025-02-01", address="5 E ST"),
            comp("sale_target", "£230,000", "2024-10-01", address="6 E ST"),
        ]
        r = value_property(subject, comps, today=TODAY)
        assert r["stack"]["verdict"] in ("stacks_full_recycle", "stacks", "marginal")
        assert r["stack"]["ceiling"] is not None
        assert r["stack"]["ceiling"] > r["offer"]["max"]  # ceiling above our offer = healthy

    def test_no_gdv_no_stack(self):
        r = value_property(CLYDE_SUBJECT, CLYDE_COMPS, today=TODAY)
        assert r["stack"]["verdict"] == "insufficient_data"


class TestRent:
    def test_rent_median(self):
        comps = CLYDE_COMPS + [
            comp("rent", "£625", "pcm", 50, "~50m"),
            comp("rent", "£650", "pcm", 50, "~50m"),
            comp("rent", "£2,500", "pcm", 1959, "~2000m"),  # different market — outlier
        ]
        r = value_property(CLYDE_SUBJECT, comps, today=TODAY)
        assert r["rent"]["estimate"] is not None
        assert 600 <= r["rent"]["estimate"] <= 700


class TestPursue:
    def test_overpriced_not_pursued(self):
        r = value_property(CLYDE_SUBJECT, CLYDE_COMPS, today=TODAY)
        assert r["pursue"] is False

    def test_insufficient_not_pursued(self):
        r = value_property(BETSHAM_SUBJECT, BETSHAM_COMPS, today=TODAY)
        assert r["pursue"] is False

    def test_bargain_pursued(self):
        r = value_property(WESTMINSTER_SUBJECT, WESTMINSTER_COMPS, today=TODAY)
        assert r["pursue"] is True
