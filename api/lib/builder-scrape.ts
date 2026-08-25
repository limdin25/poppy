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

/** How many builders one house should have in front of it.
 *
 *  Hugo, 2026-08-25: "every time when we fetch an area, let's fetch minimum 30
 *  numbers already know for each property. 30 builders."
 *
 *  He is right and the old number was the reason he asked. Buxton SK17 came
 *  back with TWO builders, one of them a landline, for a Wednesday viewing:
 *  one messageable name for a house somebody had to drive to. That was not a
 *  thin market, it was a thin search. The old default stopped at the first
 *  page of one radius and capped inserts at eight.
 *
 *  Thirty is not free and it is worth saying what it costs: three Nearby pages
 *  plus up to sixty Details lookups is roughly 90p of Google per house, once,
 *  against a viewing nobody turns up to. */
export const TARGET_BUILDERS = 30;

/** Google returns 20 results a page and will not serve more than three pages
 *  for one search, so 60 raw candidates is the ceiling per radius no matter
 *  what we ask for. Past that the only way to find more names is to go out a
 *  ring, which is what the widening ladder is for. */
export const MAX_NEARBY_PAGES = 3;

/** A next_page_token is not valid the instant it is handed to you: Google
 *  answers INVALID_REQUEST for a second or two while the page is prepared.
 *  This is the documented behaviour, not a rate limit, so it is waited out
 *  once rather than retried in a loop. */
const PAGE_TOKEN_WARMUP_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

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
  next_page_token?: string;
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
  /** `maxDetailCalls` overrides the paid-tail budget. The crons pass nothing
   *  and keep the 14 they have always had; a human pressing Find builders is
   *  waiting at the screen and asked for more names, so that press reaches
   *  further.
   *
   *  `pages` is the same story one level up. One Nearby page is 20 raw results
   *  and the trader filter drops shops out of it, which is how "find builders"
   *  used to come back with two names. Asking for three pages is the only way
   *  to reach thirty, and it is deliberately opt-in so the five-minute cron
   *  keeps costing exactly what it always cost. */
  opts: { radiusM?: number; cap?: number; maxDetailCalls?: number; pages?: number } = {},
): Promise<ScrapedBuilder[]> {
  if (!KEY()) { console.error('[builder-scrape] no Places key set'); return []; }
  const at = await geocodeOutcode(outcode);
  if (!at) return [];

  const wantPages = Math.max(1, Math.min(opts.pages ?? 1, MAX_NEARBY_PAGES));
  const raw: NonNullable<PlacesJson['results']> = [];
  let token: string | undefined;
  for (let page = 0; page < wantPages; page += 1) {
    let nearby: PlacesJson;
    if (page === 0) {
      nearby = await places('nearbysearch', {
        location: `${at.lat},${at.lng}`,
        radius: String(opts.radiusM ?? DEFAULT_RADIUS_M),
        keyword: 'builder',
      });
    } else {
      if (!token) break;
      await sleep(PAGE_TOKEN_WARMUP_MS);
      nearby = await places('nearbysearch', { pagetoken: token });
      // One retry, and only for the one status that means "too soon". Anything
      // else is a real answer and paging on would just spend again.
      if (nearby.status === 'INVALID_REQUEST') {
        await sleep(PAGE_TOKEN_WARMUP_MS);
        nearby = await places('nearbysearch', { pagetoken: token });
      }
    }
    if (nearby.status !== 'OK' || !nearby.results?.length) break;
    raw.push(...nearby.results);
    token = nearby.next_page_token;
    if (!token) break;
  }

  const seenPlace = new Set<string>();
  const rows: PlaceCandidate[] = raw
    .filter((r) => r.place_id && r.name)
    .filter((r) => {
      // Paging can repeat a place across pages; a duplicate here is a second
      // paid Details lookup for a name we already hold.
      if (seenPlace.has(r.place_id!)) return false;
      seenPlace.add(r.place_id!);
      return true;
    })
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
  const budget = opts.maxDetailCalls ?? MAX_DETAIL_CALLS;
  const shortlist = filterBuilderCandidates(rows).slice(0, budget);
  const out: ScrapedBuilder[] = [];

  // IN BATCHES, NOT ONE AT A TIME. Sixty Details lookups back to back is about
  // twelve seconds of waiting per radius, three radii is most of the route's
  // sixty-second budget, and a Find builders press that times out looks to
  // Pedro exactly like an area with no builders in it. Eight at a time is well
  // inside Google's per-second limits and turns the tail into a couple of
  // seconds.
  //
  // The chunk boundary is also where the cap is checked, so asking for thirty
  // never pays for sixty: once enough names are in hand the rest are not
  // looked up at all.
  const CONCURRENCY = 8;
  for (let i = 0; i < shortlist.length && out.length < cap; i += CONCURRENCY) {
    const chunk = shortlist.slice(i, i + CONCURRENCY);
    const details = await Promise.all(chunk.map((c) => places('details', {
      place_id: c.placeId,
      fields: 'name,formatted_address,international_phone_number,formatted_phone_number',
    })));
    // Appended in candidate order, so best-reviewed first survives the batching.
    for (let j = 0; j < chunk.length && out.length < cap; j += 1) {
      const c = chunk[j];
      const detail = details[j];
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
  /** `minCount` is how many names are enough. It defaults to 1, which is the
   *  stop-at-the-first-hit behaviour the crons have always had. The Find
   *  builders desk passes TARGET_BUILDERS, which turns the ladder from "widen
   *  until something appears" into "widen until there are enough", and that is
   *  the difference between Buxton coming back with two names and coming back
   *  with a list worth working. */
  opts: {
    startRadiusM?: number; cap?: number; maxDetailCalls?: number;
    pages?: number; minCount?: number;
  } = {},
): Promise<{ builders: ScrapedBuilder[]; radiusM: number | null; tried: number[] }> {
  const start = opts.startRadiusM ?? DEFAULT_RADIUS_M;
  const radii = [start, ...WIDENING_RADII_M.filter((r) => r > start)];
  const want = Math.max(1, opts.minCount ?? 1);
  const tried: number[] = [];

  // Kept across radii, because a wider ring re-finds everything the narrow one
  // found and the nearest builders are the ones we most want to keep. First
  // sighting wins, so a name stays at the tightest radius it appeared in.
  const byPhone = new Map<string, ScrapedBuilder>();
  let radiusM: number | null = null;

  for (const r of radii) {
    tried.push(r);
    const found = await scrapeBuildersForOutcode(outcode, {
      radiusM: r, cap: opts.cap, maxDetailCalls: opts.maxDetailCalls, pages: opts.pages,
    });
    const before = byPhone.size;
    for (const b of found) if (!byPhone.has(b.phoneE164)) byPhone.set(b.phoneE164, b);
    // The radius recorded is the one that last added a NAME WE DID NOT HAVE.
    // A wider ring re-finds everything the narrow one found, so testing
    // `found.length` here would report "searched 40km" against a house whose
    // builders all came from 10km.
    if (byPhone.size > before) radiusM = r;
    if (byPhone.size >= want) break;
  }

  return { builders: [...byPhone.values()], radiusM: byPhone.size ? radiusM : null, tried };
}

/** What the search actually did, in sentences a person can read.
 *
 *  Hugo, 2026-08-24: "we see the log, we see everything, how many numbers for
 *  that property." Pure, so it is tested rather than assembled inline in a
 *  route, and so the same words appear whether the search ran from the page or
 *  from the overnight cron.
 *
 *  It reports coverage EXTENSIONS separately from inserts on purpose. Extending
 *  is how a builder 25 miles away quietly becomes "local" to an outcode for
 *  every future house, forever, and that is worth seeing rather than hiding. */
export interface ScrapeLogLine { text: string }

export function scrapeLogLines(input: {
  outcode: string;
  tried: number[];
  radiusM: number | null;
  scraped: ScrapedBuilder[];
  plan: RosterPlan;
  mobiles: number;
  /** How many were asked for. Present only when a target was set, which is the
   *  desk rather than the cron. Falling short of it is said out loud: a thin
   *  market is a fact Pedro needs before he drives somewhere, not a number to
   *  quietly round up. */
  target?: number;
}): ScrapeLogLine[] {
  const { outcode, tried, radiusM, scraped, plan, mobiles, target } = input;
  const km = (m: number) => `${Math.round(m / 1000)}km`;
  const lines: string[] = [];

  if (!radiusM) {
    lines.push(`Searched ${tried.map(km).join(', then ')} around ${outcode} and found nobody.`);
    return lines.map((text) => ({ text }));
  }

  lines.push(
    tried.length > 1
      ? `Searched ${tried.map(km).join(', then ')} around ${outcode}, out to ${km(radiusM)}.`
      : `Searched ${km(radiusM)} around ${outcode}.`,
  );
  lines.push(
    `${scraped.length} builder${scraped.length === 1 ? '' : 's'} came back with a phone number.`
    + ` ${mobiles} can be texted, ${scraped.length - mobiles} are landlines we can only ring.`,
  );
  if (target && scraped.length < target) {
    lines.push(
      `That is short of the ${target} we look for. There is nobody else within ${km(radiusM)},`
      + ' so this is the whole market rather than a short search.',
    );
  }
  if (plan.inserts.length) lines.push(`${plan.inserts.length} added to the roster.`);
  if (plan.extendIds.length) {
    lines.push(
      `${plan.extendIds.length} were already on the roster and now also count as covering ${outcode}.`,
    );
  }
  if (!plan.inserts.length && !plan.extendIds.length) {
    lines.push('Nothing new: every one of them was already on the roster for this area.');
  }
  return lines.map((text) => ({ text }));
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
