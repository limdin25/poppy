// Resolving the towns near a lead, for the "areas we cover" pages.
//
// THE RULE THIS EXISTS TO OBEY
// Never invent a place name. A page that says "we cover Ashby Parva" when the
// lead has never heard of Ashby Parva is worse than having no areas page: it
// is the exact failure docs/VIDEO_SERP_TRUTH.md was written about, where
// invented or foreign places got read out to real leads. Every name here comes
// back from Google's own geocoder, hard-filtered to Great Britain, or it does
// not appear at all.
//
// WHY REVERSE GEOCODING AND NOT A TEXT SEARCH
// "towns near Middlesbrough" is a Text Search query and Text Search takes
// `region` as a BIAS, not a filter, which is how Toronto ended up in a
// Yorkshire lead's video. Reverse geocoding a point returns the place that
// point is actually inside. Ring the lead's town with points and you get its
// real neighbours, with no ranking, no bias and nothing to invent.

const KEY = () => process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

export interface UkArea {
  name: string;
  /** Slug used in the URL, e.g. "stockton-on-tees". */
  slug: string;
}

/** Kilometres per degree of latitude. Longitude is scaled by cos(lat). */
const KM_PER_DEG = 111.32;

function slugArea(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface GeoResult {
  address_components?: Array<{ long_name: string; types: string[] }>;
  geometry?: { location?: { lat: number; lng: number } };
}

async function geocode(params: Record<string, string>): Promise<GeoResult[]> {
  const key = KEY();
  if (!key) return [];
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${qs}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { status?: string; results?: GeoResult[] };
  // ZERO_RESULTS is normal out at sea or on a moor. Anything else is worth a
  // log, because a quota problem would otherwise look like "this lead has no
  // neighbours" and quietly delete the areas pages from every site.
  if (body.status && body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
    console.error('[uk-areas] geocode status', body.status);
    return [];
  }
  return body.results || [];
}

/** The town name a reverse-geocode result is inside, or null. */
function townOf(r: GeoResult): string | null {
  const parts = r.address_components || [];
  // postal_town is the Royal Mail post town and is the name people actually
  // use for where they live. locality is the fallback; administrative_area_2
  // is a county and must never be offered as a town.
  for (const want of ['postal_town', 'locality']) {
    const hit = parts.find((p) => p.types.includes(want));
    if (hit?.long_name) return hit.long_name;
  }
  return null;
}

/**
 * Towns near a UK town, nearest first, excluding the town itself.
 *
 * Returns [] on any failure, missing key, or unrecognised town. The caller
 * MUST treat [] as "this site has no areas pages", never as "fall back to
 * something plausible".
 */
export async function nearbyUkTowns(town: string, limit = 10): Promise<UkArea[]> {
  const name = String(town || '').trim();
  if (!name) return [];

  // components=country:GB is a HARD filter, unlike region= which is only a
  // bias. This is the line that keeps a Scarborough lead in Yorkshire instead
  // of Ontario.
  const [origin] = await geocode({ address: name, components: 'country:GB' });
  const at = origin?.geometry?.location;
  if (!at) return [];

  const lngScale = Math.max(0.2, Math.cos((at.lat * Math.PI) / 180));
  const rings = [7, 14];
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];

  const points: Array<{ lat: number; lng: number; km: number }> = [];
  for (const km of rings) {
    for (const deg of bearings) {
      const rad = (deg * Math.PI) / 180;
      points.push({
        lat: at.lat + (km / KM_PER_DEG) * Math.cos(rad),
        lng: at.lng + (km / (KM_PER_DEG * lngScale)) * Math.sin(rad),
        km,
      });
    }
  }

  const seen = new Map<string, number>();
  const self = name.toLowerCase();

  // Sequential by ring so the nearer ring claims a name first and the distance
  // ordering below is meaningful. Within a ring the calls run together.
  for (const km of rings) {
    const inRing = points.filter((p) => p.km === km);
    const found = await Promise.all(
      inRing.map((p) =>
        geocode({ latlng: `${p.lat},${p.lng}`, result_type: 'postal_town|locality' })
          .then((rs) => (rs.length ? townOf(rs[0]) : null))
          .catch(() => null),
      ),
    );
    for (const t of found) {
      if (!t) continue;
      const k = t.toLowerCase();
      if (k === self) continue;
      if (!seen.has(k)) seen.set(k, km);
    }
  }

  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([k]) => {
      // Recover the original casing from the first sighting.
      const proper = k.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      return { name: proper, slug: slugArea(proper) };
    });
}

export { slugArea };
