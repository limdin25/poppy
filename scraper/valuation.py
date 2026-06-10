"""Valuation + offer engine for the BRRR sourcing workflow.

Research-backed redesign (2026-06-10) replacing the broken client-side maths
that priced offers off GDV (and a default £250/sqft). Method follows the
RICS comparable approach + small-sample AVM practice:

  - Offers derive from CURRENT market value (same-bed sold comps) ONLY.
    GDV never touches the offer — it only checks the deal stacks.
  - Never offer above asking. No default £/sqft anywhere: thin evidence
    returns null + reason, never an invented number.
  - Median-based (never raw mean), sale-date adjustment, distress-sale
    filtering, Double-MAD outlier rejection, FSD-style confidence bands.

Full spec: docs/BRRR_QUALIFIER_PLAN.md in the Poppy repo (valuation section).
Deviation from spec (documented): HPI adjustment uses a flat annual growth
approximation (cfg) rather than live UKHPI per local authority; the
'insufficient' spread threshold is 0.45 (spec 0.35) so borderline evidence
yields a LOW-confidence flagged number instead of nothing.
"""
import datetime
import math
import re
from statistics import median

DEFAULT_CONFIG = {
    "annual_growth": 0.035,        # HPI-lite time adjustment, compounded
    "max_comp_age_months": 60,     # hard recency cap
    "max_comp_distance_m": 800,    # ~0.5 mile hard cap
    "distress_floor": 0.70,        # adj price below 0.70 × cluster median = suspected distress
    "offer_open_pct": 0.70,        # open 30% below CMV
    "offer_max_pct": 0.75,         # walk-away: 25% below CMV
    "low_conf_deepen": 0.05,       # LOW confidence: deepen both by 5pts
    "refurb": 10_000,
    "refurb_contingency": 1.15,
    "refurb_contingency_suspicious": 1.20,
    "fixed_costs": 2_500,          # legals + survey + broker
    "refi_costs": 2_000,
    "bridge_cost_pct_of_price": 0.06,  # 2% arrangement + 1%/mo × 6mo on a 75% bridge
    "refi_ltv": 0.75,
    "gdv_stress": 0.95,
    "icr_stress_rate": 0.055,
    "icr_ratio": 1.25,             # ltd-co
    "auction_hammer_uplift": 1.20,
}


# ── parsing helpers ──────────────────────────────────────────────────────────

def parse_money(text):
    if text is None:
        return None
    digits = re.sub(r"[^0-9.]", "", str(text))
    if not digits:
        return None
    try:
        v = float(digits)
    except ValueError:
        return None
    return v if v > 0 else None


def parse_sale_date(date_info, today):
    """ISO dates ('2024-10-29') from the comps fetcher; legacy 'Sold 2024'
    falls back to July of that year (spec §0.3)."""
    if not date_info:
        return None
    s = str(date_info).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = re.search(r"(20\d{2})", s)
    if m:
        year = int(m.group(1))
        if year < today.year:
            return datetime.date(year, 7, 1)
        return datetime.date(year, max(1, today.month - 3), 1)
    return None


def months_between(d1, d2):
    return max(0.0, (d2 - d1).days / 30.44)


def distance_bucket(distance_m, distance_label):
    label = (distance_label or "").lower()
    if "same road" in label or "same building" in label:
        return "road", 1.0
    try:
        d = float(distance_m)
    except (TypeError, ValueError):
        d = None
    if d is not None and d > 0:
        if d <= 250:
            return "near", 0.85
        if d <= 800:
            return "half_mile", 0.6
        return None, 0.0  # too far
    # no numeric distance — trust the label
    m = re.search(r"~?(\d+)\s*m", label)
    if m:
        d = float(m.group(1))
        if d <= 250:
            return "near", 0.85
        if d <= 800:
            return "half_mile", 0.6
        return None, 0.0
    return "half_mile", 0.6  # unknown — conservative weight


def _norm_address(addr):
    return re.sub(r"[^a-z0-9]", "", (addr or "").lower())


def weighted_median(values_weights):
    pairs = sorted(values_weights, key=lambda p: p[0])
    total = sum(w for _, w in pairs)
    if total <= 0:
        return median([v for v, _ in pairs])
    half = total / 2
    cum = 0.0
    for v, w in pairs:
        cum += w
        if cum >= half:
            return v
    return pairs[-1][0]


def sdlt_additional(price):
    """England additional-dwelling SDLT, marginal bands (2025/26)."""
    bands = [(125_000, 0.05), (250_000, 0.07), (925_000, 0.10), (1_500_000, 0.15), (float("inf"), 0.17)]
    tax, prev = 0.0, 0.0
    for limit, rate in bands:
        portion = min(price, limit) - prev
        if portion <= 0:
            break
        tax += portion * rate
        prev = limit
    return tax


# ── shared comp pipeline (spec §0) ───────────────────────────────────────────

def run_pipeline(comps, today, cfg, subject_sqm=None):
    """Returns dict with estimate (or None), confidence, audit table etc."""
    audit = []
    candidates = []

    # parse + hard filters
    seen = []  # for dedupe: (addr_norm, year, price)
    for c in comps:
        price = parse_money(c.get("price"))
        sale_date = parse_sale_date(c.get("date_info"), today)
        row = {
            "address": c.get("address") or "",
            "price": price,
            "date": str(c.get("date_info") or ""),
            "included": False,
            "reason": None,
            "adj_price": None,
            "weight": None,
        }
        if price is None or sale_date is None:
            row["reason"] = "unparseable price/date"
            audit.append(row)
            continue
        age_months = months_between(sale_date, today)
        if age_months > cfg["max_comp_age_months"]:
            row["reason"] = "older than %d months" % cfg["max_comp_age_months"]
            audit.append(row)
            continue
        bucket, w_dist = distance_bucket(c.get("distance_m"), c.get("distance_label"))
        if bucket is None:
            row["reason"] = "too far (>0.5 mile)"
            audit.append(row)
            continue
        # dedupe: same address + same year + price within 1%
        key_addr, key_year = _norm_address(c.get("address")), sale_date.year
        dup = False
        for (a, y, p) in seen:
            if a == key_addr and y == key_year and abs(p - price) <= 0.01 * p:
                dup = True
                break
        if dup:
            continue  # silently dropped — same sale recorded twice
        seen.append((key_addr, key_year, price))

        # time adjustment (HPI-lite)
        ratio = (1 + cfg["annual_growth"]) ** (age_months / 12.0)
        adj = price * ratio if abs(ratio - 1) >= 0.01 else price
        sqm = parse_money(c.get("floor_area_sqm"))
        candidates.append({
            "row": row, "adj": adj, "age": age_months,
            "bucket": bucket, "w_dist": w_dist, "sqm": sqm,
        })
        row["adj_price"] = round(adj)

    def result_insufficient():
        return {"estimate": None, "low": None, "high": None, "confidence": "insufficient",
                "n_used": 0, "ring_used": None, "spread_pct": None,
                "median_age_months": None, "audit": audit}

    if not candidates:
        return result_insufficient()

    # widening ladder (time-based rings; distance handled by weights)
    rings = [
        (24, lambda c: c["bucket"] in ("road", "near")),   # ring 0 → ceiling high
        (48, lambda c: True),                              # ring 1 → ceiling medium
        (cfg["max_comp_age_months"], lambda c: True),      # ring 2 → ceiling low
    ]
    chosen, ring_used = [], None
    for i, (max_age, pred) in enumerate(rings):
        chosen = [c for c in candidates if c["age"] <= max_age and pred(c)]
        ring_used = i
        if len(chosen) >= 5:
            break
    if len(chosen) < 3:
        for c in candidates:
            c["row"]["reason"] = c["row"]["reason"] or "insufficient evidence (need 3+ comps)"
            audit.append(c["row"])
        return result_insufficient()
    for c in candidates:
        if c not in chosen:
            c["row"]["reason"] = "outside selected evidence ring"
            audit.append(c["row"])

    # distress filter (never below 3 comps)
    cluster_median = median([c["adj"] for c in chosen])
    distressed = [c for c in chosen if c["adj"] < cfg["distress_floor"] * cluster_median]
    if distressed and len(chosen) - len(distressed) >= 3:
        for c in distressed:
            c["row"]["reason"] = "suspected distress/auction sale (%.0f%% of cluster median)" % (
                100 * c["adj"] / cluster_median)
            audit.append(c["row"])
        chosen = [c for c in chosen if c not in distressed]

    # Double-MAD outlier rejection (n ≥ 5; max floor(n/4); keep ≥3)
    if len(chosen) >= 5:
        vals = [c["adj"] for c in chosen]
        m = median(vals)
        low_devs = [m - v for v in vals if v < m]
        high_devs = [v - m for v in vals if v > m]
        mad_low = median(low_devs) * 1.4826 if low_devs else 0
        mad_high = median(high_devs) * 1.4826 if high_devs else 0
        max_rejects = len(chosen) // 4
        scored = []
        for c in chosen:
            dev = c["adj"] - m
            mad_side = mad_high if dev > 0 else mad_low
            score = abs(dev) / mad_side if mad_side > 0 else 0
            scored.append((score, c))
        scored.sort(key=lambda s: -s[0])
        rejected = 0
        for score, c in scored:
            if score > 3.0 and rejected < max_rejects and len(chosen) - rejected > 3:
                c["row"]["reason"] = "statistical outlier (%.1f MAD)" % score
                audit.append(c["row"])
                chosen = [x for x in chosen if x is not c]
                rejected += 1

    # weights: distance × age (12-month half-life)
    for c in chosen:
        c["w"] = c["w_dist"] * (0.5 ** (c["age"] / 12.0))

    # central estimate — never a raw mean
    vals = [c["adj"] for c in chosen]
    n = len(chosen)
    plain_median = median(vals)
    if n <= 5:
        estimate = weighted_median([(c["adj"], c["w"]) for c in chosen])
    else:
        drop = 1 if n <= 9 else 2
        ordered = sorted(chosen, key=lambda c: c["adj"])[drop:-drop]
        wsum = sum(c["w"] for c in ordered)
        estimate = (sum(c["adj"] * c["w"] for c in ordered) / wsum) if wsum > 0 else plain_median

    degrade = 0
    if plain_median > 0 and abs(estimate - plain_median) / plain_median > 0.10:
        degrade += 1  # estimator disagreement = unstable evidence

    # £/sqft cross-check (never primary, never defaulted)
    crosscheck_available = False
    if subject_sqm and subject_sqm > 0:
        sized = [c for c in chosen if c["sqm"] and 0.7 * subject_sqm <= c["sqm"] <= 1.4 * subject_sqm]
        if len(sized) >= 3:
            crosscheck_available = True
            ppsms = sorted(c["adj"] / c["sqm"] for c in sized)
            lo, hi = ppsms[0] * subject_sqm, ppsms[-1] * subject_sqm
            if not (lo <= estimate <= hi):
                estimate = min(max(estimate, lo), hi)
                degrade += 1

    # confidence (FSD proxy)
    devs = [abs(v - plain_median) for v in vals]
    mad = median(devs) * 1.4826 if devs else 0
    spread = mad / plain_median if plain_median > 0 else 0
    penalty = 1.0 if n >= 8 else (1.15 if n >= 5 else 1.35)
    median_age = median([c["age"] for c in chosen])
    fsd = spread * math.sqrt(1 + 1.0 / n) * penalty
    if median_age > 9:
        fsd += 0.03
    if not crosscheck_available:
        fsd += 0.05
    if ring_used >= 2:
        fsd += 0.05

    if n < 3 or fsd > 0.45:
        band = "insufficient"
    elif n >= 5 and fsd <= 0.13:
        band = "high"
    elif n >= 4 and fsd <= 0.20:
        band = "medium"
    else:
        band = "low"
    ceiling = ["high", "medium", "low"][min(ring_used, 2)]
    order = ["high", "medium", "low", "insufficient"]
    band = order[min(max(order.index(band), order.index(ceiling)) + degrade, 3)]

    if band == "insufficient":
        for c in chosen:
            c["row"]["reason"] = "evidence too scattered (spread %.0f%%)" % (100 * fsd)
            audit.append(c["row"])
        return result_insufficient()

    for c in chosen:
        c["row"]["included"] = True
        c["row"]["weight"] = round(c["w"], 3)
        audit.append(c["row"])

    rng = max(fsd, 0.15 if n <= 4 else fsd)
    return {
        "estimate": int(round(estimate)),
        "low": int(round(estimate * (1 - rng))),
        "high": int(round(estimate * (1 + rng))),
        "confidence": band,
        "n_used": n,
        "ring_used": ring_used,
        "spread_pct": round(spread, 3),
        "median_age_months": round(median_age, 1),
        "audit": audit,
    }


# ── the public entry point ───────────────────────────────────────────────────

def value_property(subject, comps, today=None, config=None):
    cfg = dict(DEFAULT_CONFIG, **(config or {}))
    today = today or datetime.date.today()
    warnings = []

    subject_sqm = parse_money(subject.get("floor_area_sqm"))
    asking = parse_money(subject.get("price"))
    qualifier = (subject.get("price_qualifier") or "").lower()
    is_auction = str(subject.get("is_auction") or "") == "1" or "auction" in qualifier

    same_bed = [c for c in comps if c.get("comp_type") == "sale_same"]
    target_bed = [c for c in comps if c.get("comp_type") == "sale_target"]
    if not target_bed:  # legacy bucket was target-bed in the old fetcher
        target_bed = [c for c in comps if c.get("comp_type") == "sale"]
    rents = [c for c in comps if c.get("comp_type") == "rent"]

    # 1. Current market value
    cmv = run_pipeline(same_bed, today, cfg, subject_sqm)

    # 2. GDV — same rigor, then sanity caps
    gdv = run_pipeline(target_bed, today, cfg, subject_sqm)
    gdv["flags"] = []
    gdv["stress"] = None
    if gdv["estimate"] is not None:
        raw = gdv["estimate"]
        # street ceiling: highest same-road sale ≤24mo (else ≤48mo) across BOTH comp sets
        ceiling = None
        for window in (24, 48):
            road_sales = []
            for c in same_bed + target_bed:
                d = parse_sale_date(c.get("date_info"), today)
                p = parse_money(c.get("price"))
                bucket, _ = distance_bucket(c.get("distance_m"), c.get("distance_label"))
                if d and p and bucket == "road" and months_between(d, today) <= window:
                    road_sales.append(p * (1 + cfg["annual_growth"]) ** (months_between(d, today) / 12.0))
            if road_sales:
                ceiling = max(road_sales)
                break
        if ceiling and gdv["estimate"] > 1.05 * ceiling:
            gdv["estimate"] = int(round(1.05 * ceiling))
            gdv["flags"].append("street_ceiling_cap")
        if cmv["estimate"]:
            if raw > 1.30 * cmv["estimate"]:
                gdv["flags"].append("uplift_exceeds_light_refurb_cap")
                gdv["estimate"] = min(gdv["estimate"], int(round(1.30 * cmv["estimate"])))
            elif raw > 1.25 * cmv["estimate"]:
                gdv["flags"].append("uplift_review")
            if gdv["estimate"] < 1.05 * cmv["estimate"]:
                gdv["flags"].append("conversion_adds_no_value")
        gdv["stress"] = int(round(gdv["estimate"] * cfg["gdv_stress"]))

    # 3. Rent estimate (median of nearby rental comps)
    rent_vals = []
    for c in rents:
        bucket, _ = distance_bucket(c.get("distance_m"), c.get("distance_label"))
        v = parse_money(c.get("price"))
        if bucket is not None and v and 100 <= v <= 5_000:
            rent_vals.append(v)
    rent = {"estimate": int(median(rent_vals)) if len(rent_vals) >= 2 else None, "n_used": len(rent_vals)}

    # 4. Offer band — CMV only, never GDV
    offer = {"open": None, "max": None, "ladder": [], "verdict": "insufficient_data",
             "flags": [], "mode": "auction" if is_auction else "negotiated",
             "expected_hammer": None, "ask_gap": None}
    stack = {"verdict": "insufficient_data", "total_in": None, "refi_loan": None,
             "left_in": None, "left_in_stress": None, "ceiling": None, "flags": []}

    if cmv["estimate"] is not None:
        est = cmv["estimate"]
        open_pct, max_pct = cfg["offer_open_pct"], cfg["offer_max_pct"]
        if cmv["confidence"] == "low":
            open_pct -= cfg["low_conf_deepen"]
            max_pct -= cfg["low_conf_deepen"]
            offer["flags"].append("indicative_valuation_verify_comps")

        suspicious = asking is not None and asking < 0.90 * est
        if suspicious:
            offer["flags"].append("suspiciously_cheap_asking")

        # stack ceiling first (it can cap the offer)
        refi_basis = max(gdv["estimate"], est) if gdv["estimate"] else None
        refurb_mult = cfg["refurb_contingency_suspicious"] if suspicious else cfg["refurb_contingency"]
        refurb_adj = cfg["refurb"] * refurb_mult
        if refi_basis:
            target_loan = cfg["refi_ltv"] * refi_basis * cfg["gdv_stress"]
            p = max(0.0, target_loan - refurb_adj - cfg["fixed_costs"] - cfg["refi_costs"])
            for _ in range(3):
                p = max(0.0, (target_loan - refurb_adj - cfg["fixed_costs"] - cfg["refi_costs"]
                              - sdlt_additional(p)) / (1 + cfg["bridge_cost_pct_of_price"]))
            stack["ceiling"] = int(p // 250 * 250)

        if is_auction:
            max_bid = max_pct * est
            if stack["ceiling"] is not None and stack["ceiling"] < max_bid:
                max_bid = stack["ceiling"]
                offer["flags"].append("stack_limited")
            offer["max"] = int(max_bid // 50 * 50)
            offer["open"] = None
            if asking:
                offer["expected_hammer"] = int(round(asking * cfg["auction_hammer_uplift"]))
                offer["flags"].append("auction_guide_price")
        else:
            eff_max = max_pct * est
            if asking is not None:
                eff_max = min(eff_max, asking)
            if stack["ceiling"] is not None and stack["ceiling"] < eff_max:
                eff_max = stack["ceiling"]
                offer["flags"].append("stack_limited")
            opening = open_pct * est
            if suspicious and asking is not None:
                opening = min(opening, 0.95 * asking)
            opening = min(opening, eff_max)
            # Ackerman-style ladder: open → 2 climbing steps → precise final
            fracs = [0.0, 1.0 / 3, 2.0 / 3, 1.0]
            raw_steps = [opening + f * (eff_max - opening) for f in fracs]
            steps = [int(s // 500 * 500) for s in raw_steps[:-1]] + [int(raw_steps[-1] // 50 * 50)]
            ladder = []
            for s in steps:
                if not ladder or s > ladder[-1]:
                    ladder.append(s)
            offer["ladder"] = ladder
            offer["open"] = ladder[0]
            offer["max"] = ladder[-1]

        # verdict — pure feasibility (discount vs CMV is fixed by construction)
        ref_price = asking
        floor_price = asking if ("over" in qualifier or "excess" in qualifier) else None
        if ref_price:
            gap = max(0.0, 1 - (offer["max"] or 0) / ref_price)
            offer["ask_gap"] = round(gap, 3)
            if asking < 0.80 * est:
                offer["verdict"] = "great_deal_suspicious" if suspicious else "great_deal"
            elif gap <= 0.10:
                offer["verdict"] = "great_deal"
            elif gap <= 0.25:
                offer["verdict"] = "fair"
            else:
                offer["verdict"] = "overpriced"
            if floor_price and (offer["max"] or 0) < floor_price:
                demote = {"great_deal": "fair", "great_deal_suspicious": "fair", "fair": "overpriced"}
                offer["verdict"] = demote.get(offer["verdict"], offer["verdict"])
        else:
            offer["verdict"] = "fair"
            offer["flags"].append("no_asking_price")

        # 5. Deal stack at our maximum money-in
        if gdv["estimate"] is not None and offer["max"]:
            p = float(offer["max"])
            refi_basis = max(gdv["estimate"], est)
            total_in = (p + refurb_adj + sdlt_additional(p) + cfg["fixed_costs"]
                        + cfg["bridge_cost_pct_of_price"] * p + cfg["refi_costs"])
            refi_base = cfg["refi_ltv"] * refi_basis
            refi_stress = refi_base * cfg["gdv_stress"]
            left_base = max(0.0, total_in - refi_base)
            left_stress = max(0.0, total_in - refi_stress)
            stack.update({
                "total_in": int(total_in), "refi_loan": int(refi_base),
                "left_in": int(left_base), "left_in_stress": int(left_stress),
            })
            if left_stress == 0:
                stack["verdict"] = "stacks_full_recycle"
            elif left_base == 0:
                stack["verdict"] = "stacks"
                stack["flags"].append("fails_5pct_downval_stress")
            elif left_base <= 0.10 * gdv["estimate"]:
                stack["verdict"] = "marginal"
            else:
                stack["verdict"] = "fails"
            if gdv["confidence"] == "low" and stack["verdict"] in ("stacks_full_recycle", "stacks"):
                stack["verdict"] = "marginal"
                stack["flags"].append("gdv_low_confidence")
            # ICR gate
            if rent["estimate"] is not None and rent["n_used"] >= 2:
                required = refi_base * cfg["icr_stress_rate"] * cfg["icr_ratio"] / 12
                if rent["estimate"] < required:
                    stack["verdict"] = "fails"
                    stack["flags"].append("icr_fail_rent_%d_needs_%d" % (rent["estimate"], int(required)))
            else:
                stack["flags"].append("rent_unverified")
            if refurb_adj > 0.25 * gdv["estimate"]:
                stack["flags"].append("heavy_refurb_reclassify")
        elif gdv["estimate"] is None:
            offer["flags"].append("deal_stack_unverified")

    # Pursue rule — should the AI bother calling the agent about this one?
    pursue = (offer["verdict"] in ("great_deal", "great_deal_suspicious", "fair")
              and stack["verdict"] != "fails")

    return {"cmv": cmv, "gdv": gdv, "offer": offer, "stack": stack,
            "rent": rent, "pursue": pursue, "warnings": warnings}
