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

export interface Listing {
  propertyId: string;
  url: string;
  photos: ListingPhoto[];
  floorplans: string[];
  keyFeatures: string[];
  /** The agent's blurb, tags stripped. */
  description: string;
  bedrooms: number | null;
  bathrooms: number | null;
  propertySubType: string | null;
  tenure: string | null;
  /** Square metres off the listing's own sizings block, when it has one. */
  floorAreaSqm: number | null;
  fetchedAt: string;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Cap what we send a vision model. Twenty four covers every room of a terrace
 *  twice over, and it is the difference between a few pence and a few pounds
 *  on a property nobody may even buy. */
export const MAX_PHOTOS = 24;

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
    if (!full) continue;
    const sizes = (p.resizedImageUrls ?? {}) as Record<string, unknown>;
    photos.push({
      url: full,
      // 656x437 first: big enough to see a tide mark, small enough to be
      // roughly 400 tokens. Falling back to the full size is fine, it just
      // costs more.
      thumb: str(sizes.size656x437) || str(sizes.size476x317) || full,
      caption: str(p.caption) || null,
    });
    if (photos.length >= MAX_PHOTOS) break;
  }

  const floorplans: string[] = [];
  for (const raw of (Array.isArray(pd.floorplans) ? pd.floorplans : [])) {
    const f = (raw ?? {}) as Record<string, unknown>;
    if (str(f.url)) floorplans.push(str(f.url));
  }

  let sqm: number | null = null;
  for (const raw of (Array.isArray(pd.sizings) ? pd.sizings : [])) {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (str(s.unit) === 'sqm') sqm = num(s.maximumSize) ?? num(s.minimumSize);
  }

  const text = (pd.text ?? {}) as Record<string, unknown>;
  const tenure = (pd.tenure ?? {}) as Record<string, unknown>;

  return {
    propertyId: String(pd.id ?? ''),
    url,
    photos,
    floorplans,
    keyFeatures: (Array.isArray(pd.keyFeatures) ? pd.keyFeatures : [])
      .map((k) => plainText(String(k))).filter(Boolean).slice(0, 12),
    description: plainText(str(text.description)).slice(0, 6000),
    bedrooms: num(pd.bedrooms),
    bathrooms: num(pd.bathrooms),
    propertySubType: str(pd.propertySubType) || null,
    tenure: str(tenure.tenureType).replace(/_/g, ' ').toLowerCase() || null,
    floorAreaSqm: sqm,
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
