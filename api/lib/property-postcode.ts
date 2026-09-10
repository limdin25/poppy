// Fill a missing UK postcode onto a property address so Find builders can run.
//
// Fartown, Pudsey, 2026-09-10: the house sat as "127, Fartown, Pudsey, West
// Yorkshire" with no LS28 8LT. outcodeOf returned null, the scrape refused, and
// Pedro had to paste the postcode over WhatsApp. Discovery and older priced
// deals both arrive without a postcode sometimes, so the heal lives here and
// runs before every Find builders search.

import { outcodeOf } from './brrr-deal-facts.js';

const FULL_PC = /^([A-Z]{1,2}\d[A-Z0-9]?)\s*(\d[A-Z]{2})$/i;

/** True for a string that is (or normalises to) a full UK postcode. */
export function looksLikeUkPostcode(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (s.length < 5 || s.length > 7) return false;
  // Insert the space before the last three characters and re-test.
  const spaced = `${s.slice(0, -3)} ${s.slice(-3)}`;
  return FULL_PC.test(spaced);
}

/** "ls288lt" / "LS28  8LT" -> "LS28 8LT", or null when it is not a postcode. */
export function normaliseUkPostcode(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!looksLikeUkPostcode(s)) return null;
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

/** Append a postcode to an address that does not already carry one. */
export function withPostcode(address: string, postcode: string): string {
  const base = String(address ?? '').trim().replace(/[.\s]+$/, '');
  const pc = normaliseUkPostcode(postcode);
  if (!base || !pc) return base;
  if (outcodeOf(base)) return String(address ?? '').trim();
  return `${base}, ${pc}`;
}

export function postcodeFromGeocodeComponents(
  components: Array<{ long_name?: string; types?: string[] }> | null | undefined,
): string | null {
  for (const c of components ?? []) {
    if ((c.types ?? []).includes('postal_code')) {
      return normaliseUkPostcode(c.long_name ?? '');
    }
  }
  return null;
}

function geocodeKey(): string {
  return process.env.GOOGLE_PLACES_KEY
    || process.env.VITE_GOOGLE_PLACES_KEY
    || process.env.GOOGLE_MAPS_API_KEY
    || '';
}

/** Ask Google for the UK postcode of an address. Null on miss or no key. */
export async function lookupUkPostcode(address: string): Promise<string | null> {
  const key = geocodeKey();
  const q = String(address ?? '').trim();
  if (!key || !q) return null;
  try {
    const qs = new URLSearchParams({
      address: q,
      components: 'country:GB',
      key,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${qs}`);
    if (!res.ok) return null;
    const body = await res.json() as {
      status?: string;
      results?: Array<{ address_components?: Array<{ long_name?: string; types?: string[] }> }>;
    };
    if (body.status !== 'OK') return null;
    return postcodeFromGeocodeComponents(body.results?.[0]?.address_components);
  } catch (e) {
    console.warn('[property-postcode] geocode failed', String(e).slice(0, 160));
    return null;
  }
}

/**
 * If the property has no readable outcode, try to geocode one on and write it
 * back. Returns the outcode afterwards, or null when still unknown.
 */
export async function ensurePropertyPostcode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  propertyId: string,
): Promise<string | null> {
  const { data: house } = await sb
    .from('brrr_properties')
    .select('id, address, viewing_address')
    .eq('id', propertyId)
    .maybeSingle();
  if (!house) return null;

  const existing = outcodeOf(house.viewing_address) || outcodeOf(house.address);
  if (existing) return existing;

  const probe = String(house.viewing_address || house.address || '').trim();
  if (!probe) return null;
  const pc = await lookupUkPostcode(probe);
  if (!pc) return null;

  const nextAddress = withPostcode(String(house.address ?? ''), pc);
  const nextViewing = house.viewing_address
    ? withPostcode(String(house.viewing_address), pc)
    : house.viewing_address;
  const { error } = await sb
    .from('brrr_properties')
    .update({
      address: nextAddress,
      ...(nextViewing ? { viewing_address: nextViewing } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertyId);
  if (error) {
    console.warn('[property-postcode] write failed', propertyId, error.message);
    return null;
  }
  return outcodeOf(nextViewing || nextAddress);
}

/** Heal every house in the list that is missing an outcode. Best-effort. */
export async function ensurePostcodesForHouses(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  houses: Array<{ id: string; address?: string | null; viewing_address?: string | null }>,
): Promise<void> {
  for (const h of houses) {
    if (outcodeOf(h.viewing_address) || outcodeOf(h.address)) continue;
    try {
      await ensurePropertyPostcode(sb, h.id);
    } catch (e) {
      console.warn('[property-postcode] heal failed', h.id, String(e).slice(0, 120));
    }
  }
}
