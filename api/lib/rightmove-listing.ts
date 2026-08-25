// Read a Rightmove listing: the photographs, the floor plan, the blurb, the size.
//
// Hugo, 2026-08-25, on the refurb estimator: "The estimator should analyse each
// property using property information already available in the CRM, property
// photos from the listing, the agent's phone conversation, and any additional
// photos uploaded by the agent."
//
// NOTHING IN ELSIE HELD A LISTING PHOTOGRAPH BEFORE THIS FILE. `brrr_properties`
// stores `floorplan_urls` and nothing else visual, and the scraper on
// margarita-server never sent the gallery over. So the photos have to be read
// off the listing itself, and that is all this does.
//
// NO BROWSER AND NO PROXY, MEASURED NOT ASSUMED. A plain GET of
// https://www.rightmove.co.uk/properties/{id} with a normal desktop User-Agent
// answered 200 with the whole gallery in it, from a UK connection, on
// 2026-08-25. Same finding as the search page (Claude memory
// project_browserless_rightmove). If Rightmove ever starts refusing, this
// returns null and the estimator carries on without pictures rather than
// breaking: the agent's own words were the only input it had before today.
//
// THE PAGE IS NOT PLAIN JSON. `window.__PAGE_MODEL` holds a devalue-encoded
// array: index 0 is the root object and every value is either a literal or an
// INTEGER POINTER into the same array. Reading it needs the pointer walk in
// `hydrate` below. Regexing the URLs straight out of the HTML also works, but
// loses the key features, the description and the floor area, which are three
// of the four things the estimator needs.

/** One photograph off the listing. */
export interface ListingPhoto {
  /** Full size. Only used if somebody clicks through to it. */
  url: string;
  /** ~656x437. What the model is shown, because a 4000px photo is 1,500
   *  tokens for no extra detail a damp patch needs. */
  thumb: string;
  /** Rightmove's own caption. Almost always null, so never relied upon. */
  caption: string | null;
}

/** A floor area found in the advert's own words. */
export interface TextArea {
  sqm: number;
  /** The exact words it was read from, so a human can check it. */
  quote: string;
}

export interface Listing {
  propertyId: string;
  url: string;
  photos: ListingPhoto[];
  floorplans: string[];
  keyFeatures: string[];
  /** The agent's blurb, tags stripped. WHOLE, never truncated. */
  description: string;
  bedrooms: number | null;
  bathrooms: number | null;
  propertySubType: string | null;
  tenure: string | null;
  /** Square metres off the listing's own sizings block, when it has one.
   *  MEASURED 2026-08-25: 2 of the 8 houses booked for a viewing had none. */
  floorAreaSqm: number | null;
  /** Square metres written into the advert text or the key features. The other
   *  place a size hides when Rightmove's own field is empty: Llanelli says
   *  "100m2 (1076 sqft)" in the blurb and carries no sizings block at all. */
  textFloorArea: TextArea | null;
  fetchedAt: string;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Cap what we send a vision model. Twenty four covers every room of a terrace
 *  twice over, and it is the difference between a few pence and a few pounds
 *  on a property nobody may even buy. */
export const MAX_PHOTOS = 24;

/** Floor plans go to the model at FULL SIZE, unlike the photographs. The thing
 *  being read off them is small printed text, and the 296x197 thumbnail
 *  Rightmove offers is unreadable at any price. Four covers a house with a
 *  ground floor, a first floor, a loft and a garden plan. */
export const MAX_FLOORPLANS = 4;

/** A square foot in square metres. Used only to convert a figure somebody else
 *  wrote down, never to derive one. */
const SQFT_TO_SQM = 0.09290304;

/** Believable for a house we would buy. Anything outside it was a room, a plot,
 *  a garden or a typo, and a wrong size silently rescales the whole estimate. */
const MIN_SQM = 25;
const MAX_SQM = 400;

/**
 * The floor area written into the advert's own words, or null.
 *
 * WHY THIS IS A REGEX AND NOT A MODEL. It is a number printed in the text. A
 * regex either finds it or does not, and it can quote the words it found it in;
 * a model can also produce a plausible number that was never there. The model
 * is used for the FLOOR PLAN, where reading really is the job.
 *
 * Written against the eight houses booked for a viewing on 2026-08-25, whose
 * real spellings were "100m2", "1076 sqft", "964 sq ft", "964 Sq. Ft" and
 * "999 SQ.FT". Square feet are preferred when both appear, because an advert
 * that gives both is quoting one converted figure and the imperial one is
 * nearly always the original.
 */
export function sizeFromText(text: string): TextArea | null {
  const hay = String(text ?? '');
  const found: { sqm: number; quote: string; imperial: boolean }[] = [];

  const push = (raw: string, quote: string, imperial: boolean) => {
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) return;
    const sqm = imperial ? n * SQFT_TO_SQM : n;
    if (sqm < MIN_SQM || sqm > MAX_SQM) return;
    found.push({ sqm: Math.round(sqm), quote: quote.trim().slice(0, 120), imperial });
  };

  // "1,076 sqft", "964 sq ft", "964 Sq. Ft", "999 SQ.FT", "1076 square feet"
  for (const m of hay.matchAll(/([\d][\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*\.?\s*(?:ft|feet)|sqft|square\s*(?:ft|feet))/gi)) {
    push(m[1], m[0], true);
  }
  // "100m2", "100 m²", "100 sq m", "100 sq. metres", "100 square metres"
  for (const m of hay.matchAll(/([\d][\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*\.?\s*(?:m|metres?|meters?)\b|sqm\b|m2\b|m²)/gi)) {
    push(m[1], m[0], false);
  }

  if (!found.length) return null;
  const imperial = found.find((f) => f.imperial);
  const pick = imperial ?? found[0];
  return { sqm: pick.sqm, quote: pick.quote };
}

/** The numeric id in a Rightmove property URL, or null if it is not one. */
export function rightmovePropertyId(url: string | null | undefined): string | null {
  const m = String(url ?? '').match(/rightmove\.co\.uk\/properties\/(\d+)/);
  return m ? m[1] : null;
}

/** Strip the agent's HTML blurb down to readable sentences. */
function plainText(html: string): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, ' ')
    // Tag removal leaves a space on either side of every break. Left in, the
    // blurb reaches the model as one ragged line and reads as a mistake.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Pull `window.__PAGE_MODEL = {...}` out of the HTML by matching braces.
 *  A regex cannot do this: the object contains thousands of braces inside
 *  strings, and a lazy match stops at the first one that happens to balance. */
function pageModel(html: string): Record<string, unknown> | null {
  const at = html.indexOf('window.__PAGE_MODEL');
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>; }
        catch { return null; }
      }
    }
  }
  return null;
}

/** Walk the devalue pointer array back into an ordinary object.
 *  Depth capped: the array is self-referential in places (customer, analytics)
 *  and an uncapped walk never returns. */
function hydrate(arr: unknown[], index: unknown, depth = 0): unknown {
  if (typeof index !== 'number' || depth > 10) return null;
  const v = arr[index];
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'number' ? hydrate(arr, x, depth + 1) : x));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof x === 'number' ? hydrate(arr, x, depth + 1) : x;
    }
    return out;
  }
  return v ?? null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * A real picture on Rightmove's own media host, and nothing else.
 *
 * NOT PEDANTRY, A LIVE OUTAGE. Oxford Gardens, Stafford lists FOUR floor plans
 * and the fourth is `https://my.giraffe360.com/3dflp/791x5j4`, a 3D tour page.
 * Handed to a vision model as an image it fails the WHOLE request, so both
 * readers died on that one property every single time it was swept, while every
 * other house read fine. One bad URL in a list is not a degraded answer, it is
 * no answer at all, so the list is filtered here rather than hoped about later.
 *
 * The host is pinned as well as the extension: these URLs come off a page we do
 * not control and are handed to a third party to fetch.
 */
export function isImageUrl(url: string): boolean {
  return /^https:\/\/media\.rightmove\.co\.uk\/[^\s"']+\.(jpe?g|png|gif|webp)$/i.test(url);
}
const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Turn a decoded propertyData blob into our shape. Exported for the test,
 *  which runs it against a saved page rather than hitting Rightmove. */
export function readPropertyData(pd: Record<string, unknown>, url: string): Listing {
  const rawPhotos = Array.isArray(pd.images) ? pd.images : [];
  const photos: ListingPhoto[] = [];
  for (const raw of rawPhotos) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const full = str(p.url);
    // Same reason as the floor plans below: anything that is not a picture
    // kills the whole vision request, not just its own slot.
    if (!isImageUrl(full)) continue;
    const sizes = (p.resizedImageUrls ?? {}) as Record<string, unknown>;
    const mid = str(sizes.size656x437) || str(sizes.size476x317);
    photos.push({
      url: full,
      // 656x437 first: big enough to see a tide mark, small enough to be
      // roughly 400 tokens. Falling back to the full size is fine, it just
      // costs more.
      thumb: isImageUrl(mid) ? mid : full,
      caption: str(p.caption) || null,
    });
    if (photos.length >= MAX_PHOTOS) break;
  }

  const floorplans: string[] = [];
  for (const raw of (Array.isArray(pd.floorplans) ? pd.floorplans : [])) {
    const f = (raw ?? {}) as Record<string, unknown>;
    // The FULL size, deliberately. See MAX_FLOORPLANS.
    if (isImageUrl(str(f.url))) floorplans.push(str(f.url));
    if (floorplans.length >= MAX_FLOORPLANS) break;
  }

  let sqm: number | null = null;
  for (const raw of (Array.isArray(pd.sizings) ? pd.sizings : [])) {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (str(s.unit) === 'sqm') sqm = num(s.maximumSize) ?? num(s.minimumSize);
  }

  const text = (pd.text ?? {}) as Record<string, unknown>;
  const tenure = (pd.tenure ?? {}) as Record<string, unknown>;

  const keyFeatures = (Array.isArray(pd.keyFeatures) ? pd.keyFeatures : [])
    .map((k) => plainText(String(k))).filter(Boolean).slice(0, 12);
  // WHOLE. The cap is a runaway guard, not an editorial decision: 20,000 is
  // three times the longest of the eight houses booked for a viewing on
  // 2026-08-25 (Buxton, 6,539 characters). The first version of this cut at
  // 6,000 and threw the end of Buxton's advert away, which is exactly where an
  // agent puts "no central heating" and "sold as seen".
  const description = plainText(str(text.description)).slice(0, 20_000);

  return {
    propertyId: String(pd.id ?? ''),
    url,
    photos,
    floorplans,
    keyFeatures,
    description,
    bedrooms: num(pd.bedrooms),
    bathrooms: num(pd.bathrooms),
    propertySubType: str(pd.propertySubType) || null,
    tenure: str(tenure.tenureType).replace(/_/g, ' ').toLowerCase() || null,
    floorAreaSqm: sqm,
    textFloorArea: sizeFromText(`${keyFeatures.join(' . ')} . ${description}`),
    fetchedAt: new Date().toISOString(),
  };
}

/** Parse a whole saved page. Exported so the test never touches the network. */
export function parseListingHtml(html: string, url: string): Listing | null {
  const model = pageModel(html);
  if (!model || typeof model.data !== 'string') return null;
  let arr: unknown[];
  try { arr = JSON.parse(model.data) as unknown[]; } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const root = hydrate(arr, 0) as Record<string, unknown> | null;
  const pd = root && (root.propertyData as Record<string, unknown> | undefined);
  if (!pd || typeof pd !== 'object') return null;
  const listing = readPropertyData(pd, url);
  // A listing with neither a photograph nor a blurb is a page that answered but
  // did not contain a property, which is what a withdrawn listing looks like.
  if (!listing.photos.length && !listing.description) return null;
  return listing;
}

/**
 * Fetch and read one listing. Returns null on anything at all going wrong,
 * because the estimator worked without photographs before today and must keep
 * working when a listing is withdrawn, redirected or refused.
 */
export async function fetchListing(url: string): Promise<Listing | null> {
  const id = rightmovePropertyId(url);
  if (!id) return null;
  try {
    const res = await fetch(`https://www.rightmove.co.uk/properties/${id}`, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      console.warn(`[rightmove] ${id} answered ${res.status}`);
      return null;
    }
    return parseListingHtml(await res.text(), `https://www.rightmove.co.uk/properties/${id}`);
  } catch (e) {
    console.warn('[rightmove] fetch failed', String(e).slice(0, 200));
    return null;
  }
}
