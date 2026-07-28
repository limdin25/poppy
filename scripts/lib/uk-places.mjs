// uk-places.mjs — the .mjs twin of api/lib/uk-places.ts.
//
// The scraper is a plain Node script and cannot import the TypeScript module,
// so the rules live twice. They MUST stay identical: tests/uk-places.test.ts
// reads this file's source and fails if the regex or the constant drifts from
// the TypeScript side. Same arrangement as scripts/lib/line-status.mjs and
// api/lib/twilio-lookup.ts.
//
// Read the header of api/lib/uk-places.ts for why any of this exists.

/** Non-traders that rank for a trade search but are not the lead's competition. */
export const NON_TRADER =
  /\b(wholesal|merchant|supplies|supply|superstore|screwfix|toolstation|city electrical|edmundson|rexel|college|training|academy|council|jobcentre|recruit|timpson|mr minit|max spielmann|rentokil|terminix)\b/i

/**
 * Is this Google `formatted_address` in the UK?
 *
 * `region=uk` on a Places search is a bias, not a filter: "pest control in
 * Scarborough" returns Toronto businesses. Google omits the country when it
 * matches the region bias and names it when it does not, so a UK address ends
 * in its postcode (contains a digit) and a foreign one ends in its country name
 * (does not). Not a postcode-shape test, because Canadian postal codes have the
 * same shape as UK ones.
 */
export function inUk(formattedAddress) {
  const trimmed = String(formattedAddress || '').trim().replace(/\.$/, '')
  if (!trimmed) return false
  const withoutCountry = trimmed.replace(/,\s*(UK|United Kingdom)$/i, '').trim()
  const parts = withoutCountry.split(',')
  const lastPart = (parts[parts.length - 1] || '').trim()
  return /\d/.test(lastPart)
}

/** How many real businesses must sit above the lead for the SERP to be real. */
export const MIN_REAL_ABOVE = 3

/**
 * Google's own categories for places that are plainly not a tradesman. A name
 * blocklist cannot keep up: "pest control in Taunton" returns Pets at Home
 * (1,395 reviews) and a garden centre (790) above every real pest controller,
 * because shops collect thousands of reviews and a one-van trader collects
 * forty. `store` is the umbrella Google puts on every shop.
 */
export const NOT_A_TRADE = new Set([
  'store', 'shopping_mall', 'supermarket', 'grocery_or_supermarket', 'department_store',
  'home_goods_store', 'hardware_store', 'pet_store', 'furniture_store', 'clothing_store',
  'convenience_store', 'electronics_store', 'book_store', 'florist', 'car_dealer',
  'gas_station', 'restaurant', 'cafe', 'bar', 'lodging', 'school', 'university',
  'hospital', 'veterinary_care', 'local_government_office', 'bank', 'gym',
])

/** Google's categories for the trades themselves. Can only RESCUE a row: one
 *  real Crawley electrician is tagged `electrician,...,real_estate_agency`. */
export const TRADE_TYPES = new Set([
  'plumber', 'electrician', 'locksmith', 'general_contractor',
  'roofing_contractor', 'painter', 'moving_company',
])

export function isTrader(types) {
  const t = types || []
  if (t.some((x) => TRADE_TYPES.has(x))) return true
  return !t.some((x) => NOT_A_TRADE.has(x))
}
