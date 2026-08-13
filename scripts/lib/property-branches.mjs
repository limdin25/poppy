// Grouping scraped properties by the estate agency BRANCH that listed them.
//
// Pure functions, no I/O, so tests/property-branches.test.ts can prove them
// without a database. The branch is the unit of everything downstream: one
// contact, one queue row, one phone call, one AI-or-human decision.

/**
 * The last 9 digits of a phone number, which is what identifies a UK branch
 * regardless of how the number was written down.
 *
 *   "0191 625 0242"  -> "916250242"
 *   "+441916250242"  -> "916250242"
 *   "01916250242"    -> "916250242"
 *
 * The scraper stores whatever Rightmove printed; api/properties/ingest.ts
 * normalises to E.164. Both end up here. Mirrors the SQL expression in
 * brrr_properties_agent_phone_tail_idx exactly, so the index and this agree.
 *
 * @returns the 9 digits, or '' when there are not enough to identify anything.
 */
export function phoneTail9(raw) {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '')
  return digits.length >= 9 ? digits.slice(-9) : ''
}

/**
 * Group properties into branches.
 *
 * @param properties rows from brrr_properties
 * @returns Map of tail9 -> { tail9, phone, agency, properties[] }, biggest first
 */
export function groupByBranch(properties) {
  const byTail = new Map()
  for (const p of properties ?? []) {
    const tail = phoneTail9(p.agent_phone)
    if (!tail) continue                       // no usable number, nothing to ring
    let branch = byTail.get(tail)
    if (!branch) {
      branch = { tail9: tail, phone: p.agent_phone, agency: p.agent_name || 'Estate agent', properties: [] }
      byTail.set(tail, branch)
    }
    // Prefer a named agency over a blank one, whichever row carries it.
    if (!branch.agency || branch.agency === 'Estate agent') {
      if (p.agent_name) branch.agency = p.agent_name
    }
    branch.properties.push(p)
  }
  // Hugo, 2026-08-13: "price reduced decides queue order". A branch holding
  // any price-cut listing rings before every branch holding none, because a
  // recorded cut is the vendor saying out loud they will take less. Within
  // each half, most stock first: a branch with 12 houses is worth more per
  // call than one with a single listing, and the queue is priority-ordered.
  const hasCut = (x) => (x.properties.some((p) => p?.deal?.price_reduced) ? 1 : 0)
  return [...byTail.values()].sort((a, b) =>
    (hasCut(b) - hasCut(a)) || (b.properties.length - a.properties.length))
}

const num = (v) => {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * The house the agent opens on: the biggest offer we would make at this branch,
 * because that is the one worth the conversation. Ties broken by the valuation
 * engine's own pursue flag, then by the newest listing.
 */
export function headlineProperty(properties) {
  const list = [...(properties ?? [])]
  if (list.length === 0) return null
  list.sort((a, b) => {
    // valuation.py NESTS the band (deal.offer.max); the retired browser page
    // flattened it (deal.offer_max). Reading only the flat key made every
    // nested row sort as zero, so the headline fell to newest-listing order.
    const offerMax = (x) => num(x.deal?.offer?.max) || num(x.deal?.offer_max)
    const byOffer = offerMax(b) - offerMax(a)
    if (byOffer !== 0) return byOffer
    const pursue = (x) => (x.deal?.pursue === true || x.deal?.pursue === 'true' ? 1 : 0)
    const byPursue = pursue(b) - pursue(a)
    if (byPursue !== 0) return byPursue
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
  })
  return list[0]
}
