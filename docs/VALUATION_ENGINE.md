# Valuation Engine — research-backed spec (2026-06-10)

Implemented in scraper/valuation.py (tests: scraper/test_valuation.py).
Implementation deviations from this spec are documented in valuation.py docstring.

# Valuation + Offer Engine — Algorithm Spec (UK BRRR Sourcer)

**Core principle:** Offers are derived from **CurrentMarketValue (CMV)** — what the property is worth *today, as it stands*, from same-bed sold comps. **GDV is never an input to the offer.** GDV is only used to check the deal stacks after refurb. Offer is **never above asking**. There is **no default £/sqft anywhere** — thin evidence degrades to a range or a refusal, never to an invented number.

---

## 0. Shared comp pipeline (used by both CMV and GDV)

```
PIPELINE(subject, comps, required_beds):

  # 0.1 — Dedupe
  Drop duplicate comps: same normalised address + same sale_year + price within ±1%
  (Rightmove sold prices ARE Land Registry data; keep the Land Registry copy).

  # 0.2 — Hard filters (a comp failing ANY is excluded, with reason recorded)
  - type_match:     comp.type == subject.type (flat vs house — NEVER mix)
  - beds:           comp.beds == required_beds        (±1 allowed only in Ring 2 below)
  - recency:        sale_year >= valuation_year − 5   (absolute hard cap: 60 months)
  - distance:       label ∈ {same_road, ~200m, ≤0.5mi}  (scraper output already satisfies this)
  - new_build:      exclude known new-build first sales
  - non_arms_length: exclude Land Registry Category B rows if category is available

  # 0.3 — Sale-date assumption (we only have sale YEAR)
  assumed_month(sale_year) =
      July of sale_year                        if sale_year < valuation_year
      max(January, valuation_month − 3)        if sale_year == valuation_year
  months_since_sale = months between assumed_month and valuation_month

  # 0.4 — HPI time adjustment (ALWAYS, full ratio — appraisers under-adjust by ~50%)
  adj_price = price × HPI(local_authority, type, latest_month)
                    / HPI(local_authority, type, assumed_month)
  Index fallback chain: LA+type → LA all-property → region → UK.
  Skip the adjustment only if |ratio − 1| < 1%.
  Source: landregistry.data.gov.uk/data/ukhpi/region/{la-slug}/month/{YYYY-MM}.json
  (fields housePriceIndexTerraced / SemiDetached / Detached / FlatMaisonette).

  # 0.5 — Widening ladder (stop at first ring with n ≥ 5; accept ring if n ≥ 3 when exhausted)
  Ring 0: same road or ≤200m, sale ≤ 24 months          → confidence ceiling HIGH
  Ring 1: + sales ≤ 48 months (HPI-indexed)             → confidence ceiling MEDIUM
  Ring 2: + ±1 bed comps (similarity weight 0.7)        → confidence ceiling LOW
  Ring 3: + sales ≤ 60 months                           → confidence ceiling LOW
  If after Ring 3 n < 3 → return INSUFFICIENT.

  # 0.6 — Distress / hidden-auction / short-lease filter (run on adj values)
  cluster_median = median(adj values)
  Exclude any comp with adj < 0.70 × cluster_median   (reason: "suspected distress/auction sale")
  For FLATS additionally flag (don't auto-exclude) comps at 0.70–0.80 × cluster_median
  as "possible short lease — verify before trusting".
  Never let this filter take n below 3.

  # 0.7 — Outlier rejection (Double-MAD, on time-adjusted values)
  Only if n ≥ 5.  m = median; MAD_low / MAD_high computed separately below/above m,
  scaled ×1.4826.  Reject |x − m| / MAD_side > 3.0.
  Max rejections = floor(n/4)  (1 for n=5–7, 2 for n=8–10). Never go below 3 remaining.
  If MAD = 0, skip. At n = 3–4: never reject — flag and widen the output range instead.

  # 0.8 — Weights
  w = w_dist × w_age × w_sim
  w_dist: same road 1.0 | ~200m 0.85 | ≤0.5mi 0.6
  w_age:  0.5 ^ (months_since_sale / 12)          # 12-month half-life
  w_sim:  exact beds 1.0 | ±1 bed 0.7

  # 0.9 — Central estimate (NEVER raw mean)
  n ≤ 5:   weighted median of adj values
  n 6–9:   trimmed weighted mean dropping 1 highest + 1 lowest
  n = 10:  trimmed weighted mean dropping 2 highest + 2 lowest
  Also compute plain median; if |trimmed_mean − median| / median > 0.10
  → degrade confidence one band (disagreement = unstable evidence).

  # 0.10 — Mode
  PRIMARY mode = whole-price comparison (UK buyers price on bed count).
  £/sqft is a CROSS-CHECK only (see §1.2) and is computable only when subject.sqft is known
  AND ≥3 surviving comps have sqft within 0.7–1.4 × subject.sqft.

  # 0.11 — Confidence score (FSD proxy)
  spread_pct = (1.4826 × MAD of adj values) / median
  penalty    = 1.0 if n ≥ 8 | 1.15 if n = 5–7 | 1.35 if n = 3–4
  FSD = spread_pct × sqrt(1 + 1/n) × penalty
        + 0.03 if median comp age > 9 months
        + 0.05 if £/sqft cross-check unavailable (no trusted areas)
        + 0.05 if any widening ring ≥ 2 was used

  BAND RULES (apply ring ceiling from 0.5, then the lower of band vs ceiling):
    HIGH:         n ≥ 5  AND FSD ≤ 0.13 AND Ring 0 only
    MEDIUM:       n ≥ 4  AND FSD ≤ 0.20
    LOW:          n = 3, OR 0.20 < FSD ≤ 0.35
    INSUFFICIENT: n < 3, OR FSD > 0.35
  Reported range: 68% = estimate × (1 ± FSD), floored at ±15% when n ≤ 4.

  RETURN {estimate, range_68, confidence, n_used, n_rejected[+reasons],
          median_age_months, spread_pct, mode, ring_used, comp_audit_table}
```

---

## 1. CurrentMarketValue(subject, same_bed_comps)

```
CMV = PIPELINE(subject, same_bed_comps, required_beds = subject.beds)
```

**1.1 Condition adjustment (only if listing signals it).** If listing text contains "needs modernisation / full refurbishment / cash buyers only / no onward chain – quick sale": CMV_adjusted = CMV × 0.90 (cost-of-works + risk margin proxy), and flag `subject_condition_discounted`. Default: no adjustment (CMV = average street condition).

**1.2 £/sqft cross-check (never primary, never defaulted).** If computable per §0.10: derive local £/sqft range = [min, max] of surviving comps' adj £/sqft. If CMV ÷ subject.sqft falls outside that range → clamp CMV to the nearest bound × subject.sqft, degrade confidence one band, flag `sqft_crosscheck_clamped`. If subject.sqft is unknown or areas untrusted: skip silently (the +0.05 FSD penalty already applies).

**1.3 Insufficient behaviour.** confidence = INSUFFICIENT → CMV = null. No offer is generated (see §3.0). Optionally report HPI local-authority average price for the type as `area_benchmark ±25%` labelled **"benchmark, not a valuation"**.

---

## 2. GDV(subject, target_bed_comps)

```
GDV_raw = PIPELINE(subject_as_converted, target_bed_comps, required_beds = target_beds)
```
Identical rigor: same filters, HPI indexing, Double-MAD, weighted median/trimmed mean, same confidence bands.

**2.1 NO fallback number — ever.** If confidence = INSUFFICIENT → `GDV = null, gdv_status = "insufficient_evidence"`. Regional/national £/sqft spreads 6×+ (NE ~£145/sqft vs inner London ~£724/sqft); any hardcoded default is wrong almost everywhere. Downstream: DealStacks returns `insufficient_data`; the offer engine still runs off CMV alone with flag `deal_stack_unverified`.

**2.2 Sanity caps (applied in order):**
1. **Street ceiling:** `ceiling = max(adj sold price across the UNION of both comp sets, same road only, sold ≤ 24 months)`. If no same-road sale ≤24m, use ≤48m. `GDV_capped = min(GDV_raw, 1.05 × ceiling)`. If capped → flag `street_ceiling_cap`.
2. **CMV-ratio cap (lender light-refurb cap):** if `GDV_capped > 1.30 × CMV` → `GDV_final = 1.30 × CMV`, flag `uplift_exceeds_light_refurb_cap` (too-good-to-be-true: comps likely wrong street/spec/extension). If ratio is 1.25–1.30 → no cap, flag `uplift_review`.
3. **Conversion-uplift floor:** if `GDV_capped < 1.05 × CMV` → flag `conversion_adds_no_value` (expected 2→3 bed uplift band is 10–25%, ~13% typical).
4. **Down-valuation stress:** always also output `GDV_stress = 0.95 × GDV_final`.

**2.3 Confidence interaction:** if GDV confidence = LOW, DealStacks may still run but its best verdict is capped at `marginal`.

---

## 3. OfferBand(CMV, asking, qualifier)

**3.0 Gate.** If CMV is null → `{verdict: "insufficient_data", offers: null}`. Stop.

**3.1 Qualifier normalisation.**

| Qualifier | Treatment |
|---|---|
| plain asking / OIRO / "Guide Price" (non-auction) | `floor_price = null`, expected achieved ≈ asking × 0.97 (info only) |
| Offers Over / OIEO | `floor_price = asking` (hard floor — seller will not take less) |
| Guide Price (auction) / modern method of auction | expected hammer = guide × 1.20; **no negotiated offer band** — output `max_bid = min(0.75 × CMV, stack_ceiling)` and verdict per §3.4 using max_bid; flag `auction` |
| POA / missing | asking = null; pure CMV-based band, flag `no_asking_price` |

**3.2 The band (owner's strategy, codified).**
```
open_offer = 0.70 × CMV          # open 30% below worth-now value
max_offer  = 0.75 × CMV          # climb to 25% below — the walk-away ceiling
LOW confidence → deepen both by 5pts: open = 0.65 × CMV, max = 0.70 × CMV,
                 flag "indicative valuation — verify comps before offering"

Ladder (shrinking Ackerman steps, each justified with printed sold comps):
  step1 = 0.700 × CMV → step2 = 0.725 × CMV → step3 = 0.740 × CMV → step4 = 0.750 × CMV
Rounding: steps 1–3 round DOWN to nearest £500;
          final step rounds DOWN to nearest £50 (precise, non-round → signals hard limit)
          and is delivered with one non-monetary sweetener (no chain / flexible completion / proof of funds).

HARD CAPS (applied to every step):
  ≤ asking            (never offer above asking — non-negotiable invariant)
  ≤ stack_ceiling     (from §4.3, when GDV exists)
effective_max = min(0.75 × CMV, asking, stack_ceiling)
```

**3.3 Asking-vs-CMV divergence rules.**
- **CMV >> asking** (`asking < 0.90 × CMV`): suspicious, not a free lunch. Still cap at asking. Open at `min(0.70 × CMV, 0.95 × asking)`. Flag `suspiciously_cheap_asking` — assume hidden defect (short lease / structural / cash-only); force refurb contingency to +20% in DealStacks (§4.1) and require manual verification before verdict better than `fair`. If `asking < 0.80 × CMV` → verdict = `great_deal` only after manual review; auto-output `great_deal_suspicious`.
- **CMV << asking**: the gap decides feasibility, see §3.4. A discount off an inflated asking is illusory — never measure the deal against asking.

**3.4 Verdict.** Let `ask_gap = 1 − effective_max / asking` (0 if asking ≤ effective_max; if OIEO, compute vs floor_price).
```
insufficient_data:  CMV null (already handled)
great_deal:   ask_gap ≤ 0.10                       # our 25%-below-CMV money is within 10% of asking — winnable
fair:         0.10 < ask_gap ≤ 0.25                # only winnable with motivated-seller evidence
                                                   #   (price reduction ≥7%, listed >12 weeks, probate, chain-free)
overpriced:   ask_gap > 0.25                       # walk; add to watch-list for price cuts
Modifiers:
  OIEO and effective_max < floor_price → demote one band (great_deal→fair, fair→overpriced)
  effective_max bound by stack_ceiling rather than CMV → keep verdict but flag "stack_limited"
Note: discount vs CMV is ≥25% by construction at effective_max, so the verdict is purely
a feasibility measure, never a value measure.
```

---

## 4. DealStacks(offer, refurb, GDV)

**4.0 Gate.** GDV null → `{stack: "insufficient_data"}`. Use `offer = effective_max` (worst-case money in).

**4.1 Total money in.**
```
refurb' = refurb × 1.15 contingency   (× 1.20 if flag suspiciously_cheap_asking)
SDLT    = additional-dwelling rates (England): 5% to £125k, 7% £125–250k,
          10% £250–925k, 15% £925k–1.5M, 17% above (marginal bands)
fixed_costs    = £2,500 (legals £1,500 + survey £500 + broker/valuation £500)
finance_costs  = if bridging: 2% arrangement + 1.0%/month × 6 months on 0.75 × offer; if cash: £0
refi_costs     = £2,000
total_in = offer + refurb' + SDLT + fixed_costs + finance_costs + refi_costs
```

**4.2 75% LTV recycle check.**
```
refi_loan_base   = 0.75 × GDV_final
refi_loan_stress = 0.75 × GDV_stress          # = 0.7125 × GDV_final
left_in_base     = max(0, total_in − refi_loan_base)
left_in_stress   = max(0, total_in − refi_loan_stress)

stacks_full_recycle: left_in_stress == 0                  # all money out even after 5% down-valuation
stacks:              left_in_base == 0, left_in_stress > 0  → flag "fails_5pct_downval_stress"
marginal:            0 < left_in_base ≤ 0.10 × GDV_final
fails:               left_in_base > 0.10 × GDV_final

ICR gate (auto-fail if breached): monthly_rent ≥ refi_loan_base × 5.5% × 1.25 / 12  (ltd-co; also
report the 1.45 personal figure). monthly_rent = median of ≥2 rental comps at target beds;
<2 rental comps → skip gate, flag "rent_unverified".
Quality flags (don't change verdict, must display):
  refurb' > 0.25 × GDV_final            → "heavy_refurb_reclassify"
  refurb  > 0.15 × CMV                  → "heavy_refurb_product_needed"
  (GDV_final − CMV) < 1.30 × refurb     → "value_add_below_1.30_per_£1"
  GDV confidence = LOW                  → verdict capped at marginal
```

**4.3 Stack ceiling (feeds back into §3.2 as a cap on offers).**
```
Solve purchase price p where total_in(p) = 0.75 × GDV_stress, iterating SDLT 3×:
  p₀ = 0.75 × GDV_stress − refurb' − fixed_costs − refi_costs
  pᵢ₊₁ = 0.75 × GDV_stress − refurb' − fixed_costs − refi_costs − SDLT(pᵢ) − finance_costs(pᵢ)
stack_ceiling = p₃ (rounds down to £250). GDV null → stack_ceiling = null.
```

**4.4 Combined pursue rule.** `pursue = verdict ∈ {great_deal, fair} AND stack ∈ {stacks_full_recycle, stacks}`. `fair` additionally requires a motivated-seller signal before the dialler queues the property.

---

## 5. Invariants (regression tests — the old bugs)

1. Offer is a function of **CMV only** — assert no code path multiplies GDV by 0.70–0.75 to produce an offer.
2. `open_offer ≤ max_offer ≤ asking` whenever asking is known — **always**.
3. Grep-level ban: no literal £/sqft constant (e.g. 250) exists anywhere; missing evidence returns `null + reason`, never a number.
4. No valuation from < 3 comps; no output from a single comp; never value at the lowest comp alone.
5. Every emitted value carries `{n_used, median_age_months, ring_used, spread_pct, confidence}` plus the per-comp audit table (address, raw price, sale year, HPI ratio, adj price, weight, included/excluded + reason) — exportable as a valuer evidence pack.

---

# Research lens summaries

## rics-comparable-method

RICS comparable-method mechanics, condensed to implementable rules. Evidence base: minimum 3 completed, verified, arm's-length sold transactions (5+ preferred); never value from one comp. Selection: same property type and tenure, same bed count (+/-1 max), size within ~10-15%/200-300 sqft, within ~0.5 mile urban (1 mile suburban, wider rural), inside the same value-defining micro-area; completed sold prices only - asking prices are bottom-tier guidance, SSTC mid-tier. Recency: 3-6 months ideal, 12 acceptable, 24 the hard limit and only with indexation; adjust every comp for market movement by indexing its price with the local UK HPI from sale month to valuation month. Adjustments: devalue everything to GBP/sqft on a common measurement basis, then adjust for condition (cost of works + risk margin, not bare cost), size/quantum (smaller = higher rate, no linear extrapolation), location/aspect/floor level (qualitative %), lease terms; real-world adjustments run ~5-15% per factor - a comp needing >~20% total adjustment isn't comparable. Reconciliation: RICS forbids neither median nor mean but rejects mechanical averaging - the method is ranked weighting with most weight to the best comp and a stand-back sense check; a quality-weighted median of adjusted GBP/sqft, constrained to the adjusted-comp range, is a faithful codification; explicitly never value at the lowest comp or at the single comp that happens to match the purchase price. Outliers: flag (e.g. beyond 1.5 IQR or +/-20-25% of cluster), seek the cause, adjust or exclude with recorded rationale - never silently. Non-arm's-length: repossessions, power-of-sale transfers, related-party deals, bulk/investor discounts and incentive-laden new-build first sales fail the Red Book 'willing seller, proper marketing, without compulsion' test - filter Land Registry PPD to Category A only (Category B = repossessions, mortgage-identified BTLs, transfers to non-private individuals); auction sales are usable only with caution as secondary evidence. Record 15 data fields plus a weight and rationale per comp, and when evidence is short, widen time/radius/type in defined steps while raising a reported uncertainty band rather than refusing to value. Primary source: RICS professional standard 'Comparable evidence in real estate valuation' (full text extracted), supplemented by the RICS new-build homes guidance note, isurv/L&G case material, and HM Land Registry PPD documentation.

## bmv-offer-math

UK practitioners measure BMV against verified sold-comparable value (avg of 3–5 Land Registry/Rightmove sold comps, same type/area, last 6–12 months, condition-adjusted) — never against asking price, which is treated as seller intent only; an independent buyer-commissioned RICS valuation is a check, not the baseline. Core formula: BMV % = (Comp Value − Price) / Comp Value. Genuine accepted discounts run 15–30% below comp value (tiers: 10–18 standard / 12–22 enhanced / 18–28 prime); below 12% is considered not worth execution risk, and 30%+ claims are a red flag. The BRRR hard ceiling is Purchase + Refurb + Costs ≤ 75% × Post-Refurb Value (PRV from 3 same-street comps, modelled on the lowest), with refurb ≤ 25% PRV and £1 spend adding ≥ £1.30 value; rent must pass 145%/125% ICR at ~5.5% stress. When asking and comps disagree: discounts off inflated askings are illusory, suspiciously low askings are taken as the conservative basis pending RICS confirmation, and the final max offer is the lower of comp-derived BMV price and the deal-stack ceiling. Asking-relative rules: open at ≤90% of asking; >10% below asking is 'cheeky', 25% is lowball; UK-average achieved discounts are 3–6%, so 15%+ discounts only come from motivated-seller/off-market/auction channels. Negotiation ladder (Ackerman adapted for property): set target from comps, open at 80% of target, climb 92.5% → 97.5% → 100% in shrinking increments, finish on a precise non-round number plus a non-monetary sweetener, anchor every exchange to printed sold comps, and never breach the pre-computed walk-away ceiling.

## avm-small-data

Researched small-sample AVM techniques for UK residential property (3-10 comps) using primary sources: FHFA Working Paper 24-07 on time adjustments, HM Land Registry UK HPI JSON API (field names verified by live fetch), Freddie Mac/Veros/AVMetrics FSD documentation, RICS comparable-evidence standard, Fannie Mae comp guidelines, robust-statistics literature on MAD/trimmed means, and Hometrack (UK market-leading AVM) refusal behaviour. Key implementable numbers: index every comp with adjusted = price x HPI_latest/HPI_sale_month at local-authority + property-type level (appraisers under-adjust by ~50%, so apply the full ratio; skip <1% adjustments); use median (n<=5) or 20% trimmed mean (n=6-10), never raw mean; £/sqft only when comp areas are within 0.7-1.4x of subject and areas are trusted (60% of London floor plans overstate, avg 54 sqft error); weight comps by 1/(1+(d_km/0.8)^2) x 0.5^(months/12) x type-similarity; reject outliers with Double-MAD (1.4826 scaling, cutoff 3.0, never below 3 remaining comps, none at n<=4); score confidence as an FSD proxy = robust spread x small-sample penalty, gated at industry bands 13%/20% (high/medium/low) with 68% range = +/-1 FSD; below 3 usable comps or >35% spread, refuse the valuation (as Hometrack does) and return only an HPI area benchmark +/-25% with evidence metadata. A complete drop-in pseudocode pipeline is included in the final finding.

## gdv-estimation

UK practitioners estimate GDV for light-refurb/bedroom-conversion deals from SOLD comparables of the TARGET configuration (e.g. 3-beds when converting a 2-bed): minimum 3, ideally 5+, sold within 6 months, within ~0.5 miles, same property type, finish-matched, adjusted for floor level/outside space/parking/condition — using Land Registry sold prices, never asking prices. This maps to RICS Category A evidence; area £/sqft data is Category B (cross-check only) and regional defaults are Category C (unusable). £/sqft must be derived locally from size-similar comps because smaller properties run structurally higher £/sqft, agents inflate areas, and most residential buyers price on bedroom count, not area. A hardcoded default £/sqft is indefensible: North East averages ~£145/sqft vs inner London ~£724/sqft (K&C ~£1,373) — a 6x+ spread, so any fixed default is wildly wrong almost everywhere; the correct fallback is "insufficient evidence", not a number. Sanity checks: (1) cap GDV at the street ceiling price (max comparable sale on the street in 12-24 months); (2) flag light-refurb GDVs above ~1.25-1.30x current value — that's the uplift cap bridging lenders themselves apply, and works >15-25% of value reclassify as heavy refurb; (3) bedroom-conversion uplift should land in a ~10-25% band (region-dependent, ~13% typical for 2->3 bed); (4) require >=20%-of-GDV profit and deduct 1-2.5%+VAT agent fees and legals. Down-valuation risk is material: ~10-20% of mortgage cases are down-valued, usually 2-5%, and the lender's RICS valuer — not the developer — sets the official GDV, so every deal should be stress-tested at GDV x 0.95 and every GDV stored with its comp evidence as an exportable valuer pack with a comp-count/distance/recency confidence score. Data plumbing note: Land Registry has no bedrooms/floor area and lags up to 2 months, so configuration matching needs EPC floor areas plus portal listing archives joined on address.

## data-quality-pitfalls

UK sold-price data is full of silent traps for automated valuation. Land Registry PPD splits sales into Category A (clean, full-value) and Category B (repossessions, power-of-sale, portfolio/non-private transfers) — B must be filtered out, but ordinary auction and cash-only distress sales still hide inside Category A with no marker, so the working detection rule is to discard comps below ~70-75% of the street/postcode-sector median £/sqft and aggregate with medians or interquartile means. New builds carry a 14-52% premium (highest in the North East) that deflates within 2-5 years; PPD's old/new flag lets you exclude them. Flat values fall off a cliff below 80 years' lease (10-20%+ discount, marriage value, lender refusal below ~70 years), and PPD records only freehold/leasehold — not remaining term — so cheap flat comps must be lease-checked before use. Sold prices lag reality: registration takes 2 weeks-2 months and HMLR officially flags the latest 2 months as incomplete, making effective data freshness 3-6 months. Asking-price qualifiers carry signal: OIEO is a floor, auction Guide Prices are pitched ~10% below value (reserve within 10% by ASA rule) and lots hammer 15-25% above guide, plain asking prices run ~2-4% above achieved, and ~34% of listings get cut ~7%. 'Cash buyers only' means non-mortgageable (structural, non-standard construction, short lease, legal defects) trading 5-15%+ below clean value. Regionally, £/sqft medians differ enormously — Gateshead ~£178/sqft, Coventry ~£256/sqft, Manchester ~£288/sqft (new-build flats ~£418/sqft) — with the middle half of sales in one borough spanning a 1.4-1.7x range, so comps must be computed at street/postcode-sector level using EPC-derived floor areas (~79% match rate, reject areas outside 9-974 m²), and a low absolute price in a cheap market is not evidence of below-market value.


---

# Comp fetching (feeds this engine) — upgraded 2026-06-10

Primary source: local Land Registry DB (`scraper/data/land_registry.db`, 5.9M
England sales, new-builds excluded at query time) + the government EPC register
(bedroom estimate = habitable rooms − 1, floor areas). Fetch strategy per
property: street-name search first, then a **widening radius ladder 200m →
500m → 800m** around the postcode until 5 same-bed + 5 target-bed comps are
found (the engine distance-weights, so far comps inform without dominating).
Listings with only an outcode get their radius anchor from the street's own
sales (modal full postcode). Comp type follows the subject (flats never
compared to houses). Final selection prefers size-similar comps (0.7–1.4× the
subject's floor area) at equal distance. Zoopla sold pages remain the fallback
when Land Registry + EPC can't fill the buckets.

Proof case (Betsham St, M15 — listing has no full postcode): before = 2 usable
comps → insufficient; after = 5 same-bed incl. 2024/2025 sales 35m away →
CMV £164k, offer £106.5k→£115k, verdict fair.
