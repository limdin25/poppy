// The Serviced Accommodation desk's listings (Hugo, 2026-09-23).
//
// Pedro rings letting agents about city-centre flats to rent and asks whether
// the landlord would, in principle, let it on a company let to a serviced
// accommodation company. We do NOT take the flat: Hugo sells the deal and
// brings the company. This file decides WHICH listings reach Pedro.
//
// Pure functions, no I/O, so tests/sa-listings.test.ts proves them without a
// network or a database. The I/O lives in scripts/sa-scrape-and-assign.mjs.
//
// THE RULES
//   - City centres only: the postcodes in SA_AREAS, nothing around them.
//   - A rental a company could actually take: 1 to 3 bedrooms, not a room,
//     not a student let, not a build-to-rent block, not already advertised as
//     a short let or serviced (those are the competition, not the landlord).
//   - ONE listing per agency. An agency is its phone number: two branches
//     sharing one switchboard are one agency to the person who answers.
//   - After an agency is dealt a listing it gets nothing for 14 days (Hugo:
//     "the agencies is gonna be unique for like two weeks and then it repeats
//     again"). An agency that said it never does company lets is never dealt
//     again.

/** Days an agency rests after it is dealt a listing. */
export const AGENCY_REST_DAYS = 14

/** The outcome that retires an agency for good (api/crm/sa-outcome.ts). */
export const NEVER_AGAIN = 'no_company_lets'

/** City-centre postcodes, per city. A London district like W1 is a Rightmove
 *  REGION ("W1, West London"), everywhere else an OUTCODE; resolveHit() takes
 *  either. London and Scotland are in: Hugo, 2026-09-23, the strategy is short
 *  stays within the limits and longer stays for the rest of the year. */
export const SA_AREAS = {
  London: ['W1', 'WC1', 'WC2', 'EC1', 'EC2', 'EC3', 'EC4', 'SW1', 'SE1', 'E1', 'E14', 'NW1'],
  Manchester: ['M1', 'M2', 'M3', 'M4'],
  Liverpool: ['L1', 'L2', 'L3'],
  Birmingham: ['B1', 'B2', 'B3', 'B4', 'B5'],
  Leeds: ['LS1', 'LS2'],
  Sheffield: ['S1', 'S3'],
  Newcastle: ['NE1'],
  Nottingham: ['NG1'],
  Leicester: ['LE1'],
  Bristol: ['BS1', 'BS2'],
  Cardiff: ['CF10'],
  Edinburgh: ['EH1', 'EH2', 'EH3'],
  Glasgow: ['G1', 'G2', 'G3'],
  Aberdeen: ['AB10', 'AB11'],
  Dundee: ['DD1'],
  York: ['YO1'],
  Coventry: ['CV1'],
  Southampton: ['SO14'],
  Portsmouth: ['PO1'],
  Hull: ['HU1'],
  Derby: ['DE1'],
  Preston: ['PR1'],
  Chester: ['CH1'],
  Norwich: ['NR1', 'NR2'],
  Reading: ['RG1'],
  'Milton Keynes': ['MK9'],
  Exeter: ['EX1', 'EX4'],
  Plymouth: ['PL1'],
  Sunderland: ['SR1'],
  Blackpool: ['FY1'],
  Wolverhampton: ['WV1'],
  Bath: ['BA1'],
  Brighton: ['BN1', 'BN2'],
  Oxford: ['OX1'],
  Cambridge: ['CB1', 'CB2'],
  Bradford: ['BD1'],
  Stoke: ['ST1'],
  Swansea: ['SA1'],
  Belfast: ['BT1', 'BT2'],
}

/** Every (city, postcode) pair, in SA_AREAS order. */
export function areaList() {
  return Object.entries(SA_AREAS).flatMap(([city, codes]) => codes.map((code) => ({ city, code })))
}

/**
 * Pick the Rightmove location for a postcode out of a typeahead answer.
 * Exact OUTCODE first; failing that a REGION named "<code>, ..." (London
 * districts). Anything else is refused rather than guessed: "W1" must never
 * quietly become W11.
 * @returns 'OUTCODE^1341' | 'REGION^91991' | null
 */
export function resolveHit(code, matches) {
  const want = String(code).toUpperCase()
  const list = Array.isArray(matches) ? matches : []
  const out = list.find((m) => String(m?.type).toUpperCase() === 'OUTCODE'
    && String(m?.displayName ?? '').toUpperCase() === want)
  if (out) return `OUTCODE^${out.id}`
  const reg = list.find((m) => String(m?.type).toUpperCase() === 'REGION'
    && String(m?.displayName ?? '').toUpperCase().startsWith(`${want},`))
  return reg ? `REGION^${reg.id}` : null
}

/** The to-rent search page for one location, newest first. */
export function searchUrl(locationId, index = 0) {
  const q = new URLSearchParams({
    locationIdentifier: locationId,
    radius: '0.0',
    sortType: '6',
    index: String(index),
    minBedrooms: '1',
    maxBedrooms: '3',
    includeLetAgreed: 'false',
    dontShow: 'houseShare,retirement,student',
  })
  return `https://www.rightmove.co.uk/property-to-rent/find.html?${q.toString()}`
}

/** The property list out of a to-rent results page (Next.js __NEXT_DATA__). */
export function parseSearchPage(html) {
  const m = /id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})\s*<\/script>/.exec(String(html ?? ''))
  if (!m) return []
  try {
    const data = JSON.parse(m[1])
    const props = data?.props?.pageProps?.searchResults?.properties
    return Array.isArray(props) ? props : []
  } catch {
    return []
  }
}

/**
 * A UK phone as E.164, the format wk_contacts.phone holds.
 *   "0161 696 1562" -> "+441616961562"
 * @returns the E.164 string, or '' for anything that is not a UK number.
 */
export function toE164Uk(raw) {
  let d = String(raw ?? '').replace(/[^0-9+]/g, '')
  if (d.startsWith('+44')) d = d.slice(3)
  else if (d.startsWith('0044')) d = d.slice(4)
  else if (d.startsWith('44') && d.length === 12) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  else return ''
  if (d.startsWith('0')) d = d.slice(1)
  if (!/^[1-9][0-9]{8,9}$/.test(d)) return ''
  return `+44${d}`
}

/** Monthly rent from Rightmove's price block. Weekly is converted. */
export function monthlyRent(price) {
  const amount = Number(price?.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const freq = String(price?.frequency ?? 'monthly').toLowerCase()
  if (freq === 'weekly') return Math.round((amount * 52) / 12)
  if (freq === 'monthly') return Math.round(amount)
  if (freq === 'yearly' || freq === 'annually') return Math.round(amount / 12)
  return null
}

/** Agencies that are not a landlord's agent: a portal that relays enquiries,
 *  a national short-stay operator, a room-share site. Ringing them reaches
 *  nobody who can speak for the landlord. */
const NOT_AN_AGENT = /openrent|accommodation\.co\.uk|spareroom|ideal ?flatmate|uniplaces|homelet|rightmove|zoopla|student|covering national|\bnationwide\b|housing (group|association|trust)/i

/** City-centre stock is flats. A house turns up only where a postcode runs out
 *  into the suburbs (NR2, SA1, ST1), which is not the pitch. */
const A_FLAT = /flat|apartment|penthouse|duplex|maisonette|studio/i

/** Listings that are already short stays, rooms, or co-living. */
const NOT_A_FLAT_TO_LET = /short[\s-]?(term[\s-]?)?let|serviced|holiday|airbnb|per night|nightly|co-?living|room to (rent|let)|rooms? available|house ?share|flat ?share|student/i

const NOT_A_HOME = /\b(parking|garage|land|commercial|office|retail)\b/i

/**
 * Does this search row belong in front of Pedro? Returns the reason it does
 * not, or null when it does. The reason is what the dry run prints.
 */
export function refuseReason(p) {
  if (!p || typeof p !== 'object') return 'not a listing'
  if (p.transactionType && String(p.transactionType).toLowerCase() !== 'rent') return 'not a rental'
  if (p.students) return 'student let'
  if (p.commercial) return 'commercial'
  const c = p.customer ?? {}
  if (p.development || c.development || c.buildToRent || c.buildToRentListing) return 'build to rent block'
  const beds = Number(p.bedrooms)
  if (!Number.isFinite(beds) || beds < 1 || beds > 3) return 'not 1 to 3 bedrooms'
  const type = `${p.propertySubType ?? ''} ${p.propertyTypeFullDescription ?? ''}`
  if (NOT_A_HOME.test(type)) return 'not a home'
  if (!A_FLAT.test(String(p.propertySubType ?? ''))) return 'a house, not a city-centre flat'
  if (/let agreed/i.test(String(p.displayStatus ?? ''))) return 'let agreed'
  const agency = `${c.branchDisplayName ?? ''} ${c.brandTradingName ?? ''}`
  if (NOT_AN_AGENT.test(agency)) return 'portal or operator, not an agent'
  const text = `${p.summary ?? ''} ${p.heading ?? ''} ${p.propertyTypeFullDescription ?? ''} ${type}`
  if (NOT_A_FLAT_TO_LET.test(text)) return 'already a short let, room or student let'
  if (!toE164Uk(c.contactTelephone)) return 'no UK phone'
  const pcm = monthlyRent(p.price)
  if (!pcm || pcm < 400 || pcm > 10000) return 'no sensible rent'
  return null
}

/** A search row as the listing we store and show. */
export function toListing(p, { city, code }) {
  const c = p.customer ?? {}
  const images = Array.isArray(p.propertyImages?.images) ? p.propertyImages.images : []
  const photos = images
    .map((i) => i?.srcUrl || i?.url || '')
    .filter((u) => typeof u === 'string' && u.startsWith('http'))
    .slice(0, 6)
  return {
    rightmove_id: String(p.id),
    branch_id: c.branchId != null ? String(c.branchId) : null,
    agency: String(c.branchDisplayName || c.brandTradingName || 'Letting agent').trim(),
    agency_phone: toE164Uk(c.contactTelephone),
    city,
    outcode: code,
    address: String(p.displayAddress ?? '').trim(),
    rent_pcm: monthlyRent(p.price),
    bedrooms: Number(p.bedrooms),
    bathrooms: Number.isFinite(Number(p.bathrooms)) ? Number(p.bathrooms) : null,
    property_type: String(p.propertySubType ?? '').trim() || null,
    summary: String(p.summary ?? '').trim().slice(0, 1000) || null,
    listing_url: p.propertyUrl ? `https://www.rightmove.co.uk${p.propertyUrl}` : `https://www.rightmove.co.uk/properties/${p.id}`,
    photo_urls: photos,
    first_listed_at: p.firstVisibleDate || null,
    let_available_date: p.letAvailableDate || null,
  }
}

/**
 * One listing per agency, from everything a scrape found. The newest listing
 * wins: it is the one the agent has on their desk this week.
 * @returns Map agency_phone -> listing
 */
export function bestPerAgency(listings) {
  const out = new Map()
  for (const l of listings) {
    if (!l?.agency_phone) continue
    const held = out.get(l.agency_phone)
    const t = Date.parse(l.first_listed_at ?? '') || 0
    const heldT = held ? (Date.parse(held.first_listed_at ?? '') || 0) : -1
    if (!held || t > heldT) out.set(l.agency_phone, l)
  }
  return out
}

/**
 * May this agency be dealt a listing today?
 * @param history sa_listings rows for this agency (by phone OR branch)
 * @param nowMs   the clock, injected so the tests can move it
 * @returns { deal, reason }
 */
export function decideAgency(history, nowMs = Date.now()) {
  const rows = Array.isArray(history) ? history : []
  if (rows.some((r) => r?.outcome === NEVER_AGAIN)) {
    return { deal: false, reason: 'said they never do company lets' }
  }
  const last = Math.max(0, ...rows.map((r) => Date.parse(r?.dealt_at ?? '') || 0))
  if (last > 0) {
    const days = (nowMs - last) / 86_400_000
    if (days < AGENCY_REST_DAYS) {
      return { deal: false, reason: `dealt ${Math.floor(days)} day(s) ago, rests ${AGENCY_REST_DAYS}` }
    }
    return { deal: true, reason: `rested ${Math.floor(days)} days, back with a new flat` }
  }
  return { deal: true, reason: 'new agency' }
}

/**
 * Spread the day across the country: take one agency from each city in turn,
 * so Pedro does not ring twenty London offices in a row.
 * @param byCity Map city -> listing[] (already in the order to take them)
 */
export function roundRobin(byCity, limit) {
  const queues = [...byCity.values()].map((l) => [...l])
  const out = []
  while (out.length < limit && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= limit) break
      const next = q.shift()
      if (next) out.push(next)
    }
  }
  return out
}

/** Short street for the spoken opener: "Crump Street" out of
 *  "Parliament Square, 8 Crump Street, Liverpool". */
export function spokenStreet(address) {
  const parts = String(address ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const STREET = /\b(street|st|road|rd|lane|avenue|place|square|way|court|row|walk|terrace|quay|gardens|close|drive|hill|wharf|parade|crescent|yard)\b/i
  // A numbered part ("8 Crump Street") is the street; a bare one before it is
  // usually the building ("Parliament Square", "Dakota House").
  const street = parts.find((s) => /^\d+[a-z]?\s/i.test(s) && STREET.test(s))
    ?? parts.find((s) => STREET.test(s))
    ?? parts[0] ?? ''
  return street.replace(/^\d+[a-z]?\s+/i, '').replace(/^(flat|apartment|apt)\s+\S+\s*/i, '').trim()
}
