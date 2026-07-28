// Shared Google Places lookup for every lead-import script.
//
// WHY THIS EXISTS. Hugo, 2026-07-28: 100 plumbers were cold-texted "I saw you
// on Google and noticed you dont have a website. I built you one". The list was
// filtered on the CSV "Website" column being blank. One of the six who replied
// wrote back "Look again". He has a live site at sjcplumbingheatingandgas.co.uk,
// it is just not linked on his Google Business Profile. That cost Hugo
// credibility on a live send, so no import script trusts a scraped CSV column
// for "has no website" again: it is verified against Google in the same
// enrichment pass that already fetches the review count.
//
// Two facts that shape this file:
//   1. The legacy findplacefromtext endpoint CANNOT return the website field
//      ("Unsupported field name 'website'"). Places API (New) Place Details
//      CAN, and returns the review count in the same response, so one round
//      trip gives us both.
//   2. The plumber CSVs carry the exact place id inside the "Google Maps Link"
//      column, in the !19s<place_id> segment. Using it skips the search step
//      entirely AND removes a real bug: findplacefromtext for
//      "SJC Plumbing Heating and Gas" returns "SJC Plumbing & Heating NW LTD"
//      (47 reviews, a different company 200 miles away) as candidate[0], and
//      the old code took candidate[0] blindly.

const DETAILS_FIELDS = 'id,displayName,websiteUri,userRatingCount,rating,businessStatus';

/** Pull the exact Google place id out of a scraped Maps URL, or null. */
export function placeIdFromMapsLink(link) {
  const m = /!19s(ChI[A-Za-z0-9_-]+)/.exec(String(link || ''));
  return m ? m[1] : null;
}

/** Places API (New) Place Details. ONE call returns website + reviews + rating. */
export async function placeDetails(placeId, key, referer) {
  if (!placeId || !key) return null;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': key,
        Referer: referer,
        'X-Goog-FieldMask': DETAILS_FIELDS,
      },
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || !j.id) return null;
    return {
      placeId: j.id,
      name: j.displayName?.text ?? null,
      website: j.websiteUri ?? null,
      reviews: typeof j.userRatingCount === 'number' ? j.userRatingCount : null,
      rating: typeof j.rating === 'number' ? String(j.rating) : null,
      status: j.businessStatus ?? null,
    };
  } catch {
    return null;
  }
}

/** Fallback when the CSV has no Maps link: resolve a name + town to a place id. */
export async function findPlaceId(name, town, key, referer) {
  const q = encodeURIComponent([name, town].filter(Boolean).join(' '));
  if (!q || !key) return null;
  const url = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json'
    + `?input=${q}&inputtype=textquery&fields=place_id&key=${key}`;
  try {
    const res = await fetch(url, { headers: { Referer: referer } });
    const j = await res.json();
    if (j.status !== 'OK' || !j.candidates?.length) return null;
    return j.candidates[0].place_id ?? null;
  } catch {
    return null;
  }
}

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Guard for the text-search path only: is this actually the same business?
 *  findplacefromtext answers "SJC Plumbing Heating and Gas" with
 *  "SJC Plumbing & Heating NW LTD", so candidate[0] is not automatically the
 *  business we asked about. A place id from the CSV needs no such guard. */
function sameBusiness(asked, got) {
  const a = squash(asked);
  const b = squash(got);
  if (a.length < 5 || b.length < 5) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Everything an import script needs about one candidate, in one round trip when
 * the CSV gives us a Maps link (two only when it does not).
 * Returns null when Google has no usable record we can trust, so callers can
 * decide whether an unverifiable lead is safe to text. Callers should treat
 * null as "do not claim anything about this business".
 */
export async function lookupPlace({ name, town, mapsLink, key, referer }) {
  let placeId = placeIdFromMapsLink(mapsLink);
  let resolvedBy = 'maps_link';
  if (!placeId) {
    placeId = await findPlaceId(name, town, key, referer);
    resolvedBy = placeId ? 'text_search' : 'none';
  }
  if (!placeId) return null;
  const d = await placeDetails(placeId, key, referer);
  if (!d) return null;
  if (resolvedBy === 'text_search' && !sameBusiness(name, d.name)) return null;
  return { ...d, resolvedBy };
}
