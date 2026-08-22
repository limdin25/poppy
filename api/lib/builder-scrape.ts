// Finding local builders for a property's outcode, into the brrr_builders
// roster, so the outreach engine has somebody to invite to the viewing.
//
// THE GEOGRAPHY RULES ARE NOT NEGOTIABLE (docs/VIDEO_SERP_TRUTH.md):
// `region=uk` on a Places text search restricts NOTHING, so this module never
// uses it. The outcode is geocoded with components=country:GB (a HARD filter),
// and builders come from a Nearby Search bounded by a radius around that
// point. A radius around a GB-restricted geocode cannot leave the country.
//
// Who counts as a real builder is read from api/lib/uk-places.ts (isTrader,
// NON_TRADER), the one definition the whole repo shares. This is deliberately
// NOT the scrape-trade-leads.mjs selection: that script hunts weak businesses
// to sell video to (max 65 reviews), the roster wants the opposite, an
// established builder a branch will take seriously, so candidates are ranked
// by review count descending and there is no review ceiling.
//
// One Places page, details only for the shortlist, hard cap on inserts:
// the scrape runs once per property ever (brrr_properties.builder_scraped_at)
// and the whole budget for an outcode is about a dozen HTTP calls.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isTrader, NON_TRADER } from './uk-places.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

const KEY = () =>
  process.env.GOOGLE_PLACES_KEY || process.env.VITE_GOOGLE_PLACES_KEY || '';

// The Places key is referer-restricted to this origin; send it server-side too
// (same trick as api/leads/rank-frame.ts).
const REFERER = 'https://poppy-henna.vercel.app/';

/** 10km around the outcode centroid by default: builders travel, but a branch
 *  wants somebody who can plausibly be called "local". */
export const DEFAULT_RADIUS_M = 10_000;
/** At most this many NEW roster rows per outcode. */
export const DEFAULT_CAP = 8;
/** Detail lookups are the paid tail; stop once we have enough phones. */
const MAX_DETAIL_CALLS = 14;

export interface PlaceCandidate {
  placeId: string;
  name: string;
  /** Nearby Search returns `vicinity`, not a full address. UK by construction
   *  (radius around a GB geocode), so it is never country-tested. */
  vicinity: string;
  types: string[];
  businessStatus: string | null;
  rating: number | null;
  reviews: number | null;
}

export interface ScrapedBuilder {
  name: string;
  phoneE164: string;
  address: string;
  placeId: string;
  rating: number | null;
  reviews: number | null;
}

/**
 * A UK phone in E164, or null when it is not one.
 * Accepts "07123 456789", "+44 7123 456789", "0044...", "(01204) 55 55 55".
 * Landlines are kept: the roster's phone is also for CALLING a builder, and
 * the outreach engine separately restricts WhatsApp drafts to +447 mobiles.
 */
export function normaliseUkPhone(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (s.startsWith('+44')) s = `0${s.slice(3)}`;
  if (s.startsWith('+')) return null; // some other country entirely
  if (!/^0\d{9,10}$/.test(s)) return null;
  return `+44${s.slice(1)}`;
}

/** A number the Twilio WhatsApp sender can plausibly reach: a UK mobile. */
export function isUkMobile(e164: string | null | undefined): boolean {
  return /^\+447\d{9}$/.test(String(e164 ?? ''));
}

/**
 * Keep only rows that can honestly go on the roster: operational, filed by
 * Google as a trade rather than a shop, and not a merchant or a multiple.
 * Ranked best-reviewed first, because the roster wants builders a branch and
 * an investor will take seriously.
 */
export function filterBuilderCandidates(rows: PlaceCandidate[]): PlaceCandidate[] {
  return rows
    .filter((r) =>
      r.name
      && (r.businessStatus == null || r.businessStatus === 'OPERATIONAL')
      && isTrader(r.types)
      && !NON_TRADER.test(r.name))
    .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
}

export interface RosterPlan {
  /** Brand-new roster rows to insert. */
  inserts: ScrapedBuilder[];
  /** Existing roster ids whose coverage gains this outcode. */
  extendIds: string[];
}

/**
 * Pure diff of the scrape against the roster: a phone already on the roster is
 * never duplicated, it just learns it also covers this outcode. Cap applies to
 * INSERTS only; extending coverage on a known builder is free and always right.
 */
export function planRosterChanges(
  existing: Array<{ id: string; phone: string | null; coverage: string[] }>,
  scraped: ScrapedBuilder[],
  outcode: string,
  cap = DEFAULT_CAP,
): RosterPlan {
  const oc = outcode.toUpperCase().trim();
  const byPhone = new Map<string, { id: string; coverage: string[] }>();
  for (const b of existing) {
    const p = normaliseUkPhone(b.phone);
    if (p) byPhone.set(p, { id: b.id, coverage: b.coverage });
  }
  const inserts: ScrapedBuilder[] = [];
  const extendIds: string[] = [];
  const seen = new Set<string>();
  for (const s of scraped) {
    if (seen.has(s.phoneE164)) continue;
    seen.add(s.phoneE164);
    const known = byPhone.get(s.phoneE164);
    if (known) {
      if (!known.coverage.map((c) => c.toUpperCase()).includes(oc)) extendIds.push(known.id);
    } else if (inserts.length < cap) {
      inserts.push(s);
    }
  }
  return { inserts, extendIds };
}

interface PlacesJson {
  status?: string;
  results?: Array<{
    place_id?: string; name?: string; vicinity?: string; types?: string[];
    business_status?: string; rating?: number; user_ratings_total?: number;
  }>;
  result?: {
    name?: string; formatted_address?: string;
    international_phone_number?: string; formatted_phone_number?: string;
  };
}

async function places(path: string, params: Record<string, string>): Promise<PlacesJson> {
  const url = `https://maps.googleapis.com/maps/api/place/${path}/json?${new URLSearchParams({ ...params, key: KEY() })}`;
  const res = await fetch(url, { headers: { Referer: REFERER } });
  if (!res.ok) return {};
  return res.json() as Promise<PlacesJson>;
}

/** The outcode's centroid, GB-only, or null when Google does not know it. */
export async function geocodeOutcode(outcode: string): Promise<{ lat: number; lng: number } | null> {
  const qs = new URLSearchParams({
    address: `${outcode}, UK`,
    components: 'country:GB',
    key: KEY(),
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${qs}`);
  if (!res.ok) return null;
  const body = await res.json() as {
    status?: string;
    results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
  };
  if (body.status !== 'OK') {
    if (body.status !== 'ZERO_RESULTS') console.error('[builder-scrape] geocode status', body.status);
    return null;
  }
  return body.results?.[0]?.geometry?.location ?? null;
}

/**
 * Builders near an outcode, best-reviewed first, each with a working UK phone.
 * Returns [] on a missing key, an unknown outcode, or an empty market; the
 * caller records that as builder_scrape_empty rather than guessing.
 */
export async function scrapeBuildersForOutcode(
  outcode: string,
  opts: { radiusM?: number; cap?: number } = {},
): Promise<ScrapedBuilder[]> {
  if (!KEY()) { console.error('[builder-scrape] no Places key set'); return []; }
  const at = await geocodeOutcode(outcode);
  if (!at) return [];

  const nearby = await places('nearbysearch', {
    location: `${at.lat},${at.lng}`,
    radius: String(opts.radiusM ?? DEFAULT_RADIUS_M),
    keyword: 'builder',
  });
  const rows: PlaceCandidate[] = (nearby.status === 'OK' && nearby.results ? nearby.results : [])
    .filter((r) => r.place_id && r.name)
    .map((r) => ({
      placeId: r.place_id!,
      name: r.name!,
      vicinity: r.vicinity ?? '',
      types: r.types ?? [],
      businessStatus: r.business_status ?? null,
      rating: typeof r.rating === 'number' ? r.rating : null,
      reviews: typeof r.user_ratings_total === 'number' ? r.user_ratings_total : null,
    }));

  const cap = opts.cap ?? DEFAULT_CAP;
  const out: ScrapedBuilder[] = [];
  let detailCalls = 0;
  for (const c of filterBuilderCandidates(rows)) {
    if (out.length >= cap || detailCalls >= MAX_DETAIL_CALLS) break;
    detailCalls += 1;
    const detail = await places('details', {
      place_id: c.placeId,
      fields: 'name,formatted_address,international_phone_number,formatted_phone_number',
    });
    const phone = normaliseUkPhone(
      detail.result?.international_phone_number || detail.result?.formatted_phone_number,
    );
    if (!phone) continue;
    out.push({
      name: detail.result?.name || c.name,
      phoneE164: phone,
      address: detail.result?.formatted_address || c.vicinity,
      placeId: c.placeId,
      rating: c.rating,
      reviews: c.reviews,
    });
  }
  return out;
}

/** The radii tried, in order, when the first one finds nobody.
 *
 *  Hugo, 2026-08-22: "if you don't find in this exact location, expand a bit
 *  further." Which is right, and it is also the only honest thing to do: a
 *  postcode with no builder inside 10km is not a postcode with no builders, it
 *  is a rural outcode. Stevenson Avenue in Leyland found three at 10km; a
 *  Cornish outcode would find none and the viewing would sit there with nobody
 *  invited and no reason given.
 *
 *  It stops at 40km on purpose. Beyond that a "local builder" is a man with an
 *  hour's drive each way for a free quote, and the honest answer becomes "there
 *  is nobody near this house", which is a fact a person should hear rather than
 *  a search we quietly keep widening. */
export const WIDENING_RADII_M = [10_000, 20_000, 40_000];

/**
 * The scrape that widens until it finds somebody.
 *
 * Each pass is a full Nearby Search, so the wider ones cost more, which is why
 * it stops the moment it has anything at all rather than the moment it has
 * `cap`. A single builder at 10km beats eight at 40km: he is the one who will
 * actually turn up.
 *
 * Returns the radius that worked so the caller can record it. Nobody at any
 * radius returns an empty list and a null radius, which the caller turns into
 * a notification rather than silence.
 */
export async function scrapeBuildersWidening(
  outcode: string,
  opts: { startRadiusM?: number; cap?: number } = {},
): Promise<{ builders: ScrapedBuilder[]; radiusM: number | null; tried: number[] }> {
  const start = opts.startRadiusM ?? DEFAULT_RADIUS_M;
  const radii = [start, ...WIDENING_RADII_M.filter((r) => r > start)];
  const tried: number[] = [];
  for (const radiusM of radii) {
    tried.push(radiusM);
    const builders = await scrapeBuildersForOutcode(outcode, { radiusM, cap: opts.cap });
    if (builders.length) return { builders, radiusM, tried };
  }
  return { builders: [], radiusM: null, tried };
}

/** Apply a scrape to the roster. Returns what changed, for the cron's log. */
export async function upsertScrapedBuilders(
  sb: Sb,
  outcode: string,
  scraped: ScrapedBuilder[],
  cap = DEFAULT_CAP,
): Promise<{ inserted: number; extended: number }> {
  const oc = outcode.toUpperCase().trim();
  const { data: existing } = await sb
    .from('brrr_builders')
    .select('id, phone, coverage');
  const plan = planRosterChanges(
    (existing ?? []) as Array<{ id: string; phone: string | null; coverage: string[] }>,
    scraped, oc, cap,
  );
  for (const b of plan.inserts) {
    await (sb.from('brrr_builders') as any).insert({
      name: b.name,
      phone: b.phoneE164,
      coverage: [oc],
      notes: `Scraped from Google Places for ${oc}. ${b.address}${b.reviews != null ? ` (${b.reviews} reviews${b.rating != null ? `, ${b.rating}` : ''})` : ''}`,
    });
  }
  for (const id of plan.extendIds) {
    const row = (existing ?? []).find((e: { id: string }) => e.id === id) as { coverage: string[] } | undefined;
    await (sb.from('brrr_builders') as any)
      .update({ coverage: [...(row?.coverage ?? []), oc], updated_at: new Date().toISOString() })
      .eq('id', id);
  }
  return { inserted: plan.inserts.length, extended: plan.extendIds.length };
}
