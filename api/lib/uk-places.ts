// uk-places — the ONE definition of "who counts as a real competitor above this
// lead". Everything that builds a SERP reads it from here.
//
// WHY THIS FILE EXISTS
//
// On 2026-07-28 two leads (Bite Back Pest Control, Bridlington and AL Security
// Ltd, Stirling) sat in the video funnel wearing a red card that read "Google
// didn't return enough real businesses above them". Google had returned six and
// eight. The refusal was real, the reason on the card was not, and the retry
// button re-ran a deterministic computation that could only fail again.
//
// Digging into it turned up three separate faults, all of them the same shape:
// two places in this repo each had their own idea of who a competitor is, and
// they disagreed.
//
//   1. scrape-trade-leads.mjs qualifies a lead on POSITION ("rank >= 4, so at
//      least 3 real businesses are above them"). rank-frame then threw that
//      position away and re-derived it from REVIEW COUNT. A well-reviewed lead
//      in a thin market passed the first test and failed the second, ten minutes
//      and one agent click later.
//   2. `region=uk` on a Places text search is a BIAS, NOT A FILTER. "pest
//      control in Scarborough" comes back four-sevenths Canadian, because
//      Scarborough is also a district of Toronto. Measured over 727 real result
//      rows on 2026-07-28: 6 were non-UK, and 4 of those 6 landed on one lead.
//      Left alone, a Yorkshire firm's video shows Toronto companies as their
//      local rivals, with the review counts printed next to the names.
//   3. The scraper drops non-traders (Screwfix, Timpson, Rentokil, training
//      academies). rank-frame did not, so rows the lead-selection stage had
//      deliberately rejected reappeared in the rendered SERP.
//
// THE TWIN: scripts/lib/uk-places.mjs
// The scraper is an .mjs script and cannot import this file, so it has a twin
// that must stay identical. tests/uk-places.test.ts pins both, by reading the
// twin's source and checking the rules match. If you edit one, edit the other.

/** The trade's own name for a non-trader. Mirrors the JUNK list the scraper has
 *  always used: merchants, multiples and training providers rank for a trade
 *  search but are not the lead's competition, and naming them as such on screen
 *  is the fastest way to lose a lead who knows their own market. */
export const NON_TRADER =
  /\b(wholesal|merchant|supplies|supply|superstore|screwfix|toolstation|city electrical|edmundson|rexel|college|training|academy|council|jobcentre|recruit|timpson|mr minit|max spielmann|rentokil|terminix)\b/i;

/**
 * Is this Google `formatted_address` in the UK?
 *
 * Google omits the country when it matches the `region` bias and names it when
 * it does not, so the last comma-separated part of a UK address is its postcode
 * (which always contains a digit) and the last part of a foreign one is the
 * country name (which never does). A trailing ", UK" is stripped first because
 * Google adds it to some rural addresses.
 *
 * Deliberately NOT a postcode-shape test: Canadian postal codes ("M1J 3C9") are
 * the same shape as UK ones, which is exactly the case this has to catch.
 *
 * Verified against 727 real Places rows from 60 town searches (2026-07-28): 721
 * judged UK, 6 judged foreign, and all 6 genuinely were (4 Canada, 2 USA). No
 * false positives.
 */
export function inUk(formattedAddress: string | null | undefined): boolean {
  const trimmed = String(formattedAddress || '').trim().replace(/\.$/, '');
  if (!trimmed) return false;
  const withoutCountry = trimmed.replace(/,\s*(UK|United Kingdom)$/i, '').trim();
  const lastPart = withoutCountry.split(',').pop()?.trim() ?? '';
  return /\d/.test(lastPart);
}

/** How many real businesses have to sit above the lead before the video can be
 *  built. Below this the SERP would be mostly invented, so the render refuses.
 *  The scraper applies the same number when it picks leads. */
export const MIN_REAL_ABOVE = 3;

/**
 * Google's own categories for places that are plainly not a tradesman.
 *
 * A name blocklist can never keep up with this. The live search for "pest
 * control in Taunton" put "Pets at Home Taunton" (1,395 reviews), "Proper Job
 * Taunton" (1,334) and "Otter Garden Centre" (790) at the very top, purely on
 * review volume: shops collect thousands of reviews and a one-van pest
 * controller collects forty. Unfiltered, a pest controller's video opens with a
 * pet shop named as the business beating them.
 *
 * `store` is the umbrella Google attaches to every shop, which is what makes
 * this a rule rather than a list of names.
 */
export const NOT_A_TRADE = new Set([
  'store', 'shopping_mall', 'supermarket', 'grocery_or_supermarket', 'department_store',
  'home_goods_store', 'hardware_store', 'pet_store', 'furniture_store', 'clothing_store',
  'convenience_store', 'electronics_store', 'book_store', 'florist', 'car_dealer',
  'gas_station', 'restaurant', 'cafe', 'bar', 'lodging', 'school', 'university',
  'hospital', 'veterinary_care', 'local_government_office', 'bank', 'gym',
]);

/** Google's categories for the trades themselves. Present on electricians,
 *  locksmiths and plumbers; absent on pest controllers, who come back as a bare
 *  `establishment`. So this can only ever RESCUE a row, never admit one. */
export const TRADE_TYPES = new Set([
  'plumber', 'electrician', 'locksmith', 'general_contractor',
  'roofing_contractor', 'painter', 'moving_company',
]);

export interface PlaceRow {
  name: string;
  address: string;
  rating: number | null;
  reviews: number | null;
  types?: string[];
}

/**
 * Does Google file this place as a shop, a restaurant, a school (anything but a
 * trade)? A secondary category alone is not enough to reject: one real Crawley
 * electrician is tagged `electrician,establishment,real_estate_agency`, so a
 * genuine trade type always wins.
 */
export function isTrader(types: string[] | undefined): boolean {
  const t = types ?? [];
  if (t.some((x) => TRADE_TYPES.has(x))) return true;
  return !t.some((x) => NOT_A_TRADE.has(x));
}

/**
 * Keep only rows that can honestly appear in this lead's SERP: a real UK
 * business, actually trading in this trade, that is not the lead themselves.
 *
 * `radiusBounded` MUST be set for rows that came from a Nearby Search. Those
 * carry `vicinity` ("Colonial House, Swinemoor Ln, Beverley") instead of
 * `formatted_address`, and a vicinity has no postcode, so inUk() would reject
 * every single one of them. Their geography is already guaranteed by the search
 * radius around a GB-restricted geocode, which is a stronger guarantee than
 * reading the address anyway.
 *
 * This is not hypothetical: it silently emptied the nearby-town widening the
 * first time it was written, on 2026-07-28, and the symptom was identical to
 * the bug being fixed (leads refused for "not enough businesses above them"
 * while real ones existed a few miles away).
 */
export function realCompetitors(
  rows: PlaceRow[],
  isLead: (name: string) => boolean,
  { radiusBounded = false }: { radiusBounded?: boolean } = {},
): PlaceRow[] {
  return rows.filter((r) =>
    r.name
    && (radiusBounded || inUk(r.address))
    && isTrader(r.types)
    && !NON_TRADER.test(r.name)
    && !isLead(r.name));
}

/**
 * Split a lead's competitors into the ones the video can show ABOVE them and
 * the ones it can show below.
 *
 * The video says, in the baked voiceover, "the only reason they're up there is
 * more reviews", and GoogleScrollV prints every row's review count next to its
 * name. So a business may only be placed above the lead if it genuinely has
 * more reviews than the lead. Anything else puts a number on screen that
 * contradicts the narration, in the lead's own market, next to names they know.
 *
 * This replaced a placement that used the pack's sort position, which is what
 * silently changed the meaning of "above" between the scraper and the render.
 */
export function splitByReviews(rows: PlaceRow[], leadReviews: number | null): {
  above: PlaceRow[];
  below: PlaceRow[];
} {
  const byReviews = [...rows].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
  // No review count on the lead means no honest comparison, so nothing is
  // claimed to beat them: they sit at the bottom of the real rows and the
  // stored rank decides the story instead.
  if (leadReviews == null) return { above: byReviews, below: [] };
  return {
    above: byReviews.filter((r) => (r.reviews ?? 0) > leadReviews),
    below: byReviews.filter((r) => (r.reviews ?? 0) <= leadReviews),
  };
}

/** Why a SERP could not be built, in a form the CRM can turn into plain English.
 *  `thin_market` is the honest name for what used to be reported as "Google
 *  didn't return enough real businesses". */
export type PackRefusal = 'no_results' | 'thin_market';
