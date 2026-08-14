// Which comparables are good enough to put a number in Pedro's mouth.
//
// The strategy has said since 2026-08-13 that only gold and strong evidence
// reaches him:
//
//   "Since 2026-08-13 only gold and strong ship. A deal on good, fair or last
//    resort evidence is still judged and recorded, but it never reaches Pedro,
//    because valuing a house off another street or another year is exactly how
//    the bad batches happened."
//
// The tiers, from course_comps.py on the engine:
//
//   gold         sold within 6 months,  within 400m
//   strong       sold within 12 months, within 400m
//   good         sold within 12 months, within 800m   <- another street
//   fair         sold within 24 months, within 400m   <- another year
//   last_resort  sold within 24 months, within 800m   <- both
//
// WHY THIS EXISTS ON THIS SIDE AS WELL AS THE ENGINE. The engine already
// enforces it (shortlist_gate.py `require_comps_tier`). But on 2026-08-14,
// 110 of the 180 houses on Pedro's board were fair, good or last_resort. They
// had arrived through the RETIRED hand push
// (scripts/push-course-deals-to-pedro.mjs), which bypassed the gate entirely,
// and nothing on the CRM side ever re-checked them. 39 Orion Way was one of
// them: valued on `good` evidence at GBP 139,000 when the same street said
// GBP 92,667, and we opened at GBP 96,375, above the finished value.
//
// A rule enforced in one place only holds until somebody finds another door.
// So the last gate before Pedro checks it too.

/** The only tiers allowed to reach a phone call. */
export const SHIPPABLE_TIERS = Object.freeze(['gold', 'strong'])

/** Every tier the engine can produce, best first, for reporting. */
export const ALL_TIERS = Object.freeze([
  'gold', 'strong', 'good', 'fair', 'last_resort',
])

/** Is this property's valuation resting on evidence we are willing to act on?
 *
 *  A property with NO tier recorded is refused. An unrecorded tier is not a
 *  good one: it means the deal predates the standard, which is exactly the
 *  population that needed catching.
 */
export function meetsEvidenceStandard(property) {
  const tier = String(property?.deal?.comps_tier ?? '').trim().toLowerCase()
  return SHIPPABLE_TIERS.includes(tier)
}

/** Count what was held back, by tier, for the run's own log line. */
export function belowStandardByTier(properties) {
  const out = {}
  for (const p of properties ?? []) {
    if (meetsEvidenceStandard(p)) continue
    const tier = String(p?.deal?.comps_tier ?? '').trim().toLowerCase() || 'none recorded'
    out[tier] = (out[tier] ?? 0) + 1
  }
  return out
}
