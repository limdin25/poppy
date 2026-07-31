#!/usr/bin/env node
// Find US businesses that are ADVERTISING for a receptionist, and load them
// into the AI caller's dial queue.
//
//   node scripts/scrape-hiring-receptionists.mjs                 # dry run
//   node scripts/scrape-hiring-receptionists.mjs --apply         # screens (paid) + uploads
//   node scripts/scrape-hiring-receptionists.mjs --apply --limit 30
//
// WHY THIS LIST EXISTS, and it is the whole point.
//
// The first real campaign, 2026-07-31, rang 93 plumbers who were not looking
// for anything and booked nobody. Three of them rejected the FRAME rather than
// the product, in almost the same words: "not hiring", "my boss is not looking
// at the moment for anybody", "you gotta speak to Helen". Maria opens by asking
// for a job, and a business with no vacancy hears a recruitment call and routes
// her to whoever handles those, which is nobody.
//
// A business running a receptionist ad cannot give that answer. They have
// already decided they need phone cover and already approved the money for it,
// so the same opener lands as an application against a live vacancy, and the
// price stops being a favour and becomes arithmetic: a US front-desk hire is
// roughly $2,500-3,500 a month against Maria's $97.
//
// WHERE THE ADS COME FROM. Indeed and ZipRecruiter both answer 403 to a plain
// request and Indeed litigates against scrapers, so neither is used here.
// Craigslist publishes a JSON search API that answers 200 without a proxy, and
// its "ofc" (office/admin) category is small businesses hiring exactly this
// role, which is also exactly our buyer. Measured on the day: about half the
// postings carry a company name, and that name is what makes the rest work.
//
// THE GATES, cheapest first and money last, the house rule:
//
//   1. free   an ad with a company NAME (no name, no lookup, no lead)
//   2. free   drop staffing agencies and recruiters: they are not the buyer
//   3. PAID*  Google Places: name + town -> phone, address, review count
//   4. free   valid NANPA number, deduped against itself
//   5. free   NANPA line type. LANDLINE ONLY, always
//   6. free   local calling hours from the NANPA state
//   7. PAID   Twilio line_status, drop "inactive"
//
// * Places is billed per lookup on Hugo's existing key, in the same way every
//   other import script here already uses it.
//
// GATE 5 IS NOT A PREFERENCE. The FCC treats an AI voice as an "artificial
// voice", and an artificial voice to a US mobile without prior consent carries
// statutory damages per call. Business landlines sit outside that. The first
// prepared list of the day was 100% wireless and was thrown away for exactly
// this reason, so the flag to override it does not exist in this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupPlace } from './lib/google-place.mjs';
import { toE164US, nanpaLookup, callableNow, tzForState } from './lib/us-leads.mjs';
import { loadRepoEnv, screenLineStatus } from './lib/line-status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGN = process.env.AI_CALL_CAMPAIGN || 'US Hiring Receptionist - Maria';
// Same ceiling as the plumber import. Hugo, 2026-07-29: "dont upload more
// than 100", and a slipped flag is a big bill and a lot of strangers' phones.
const MAX_UPLOAD = 100;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 0) : MAX_UPLOAD;
})();

const log = (...a) => console.log(...a);

// The searches. "ofc" is Craigslist's office/administrative category, and
// these are the words a small business actually puts in the title.
const QUERIES = [
  'receptionist', 'front desk', 'front office', 'office assistant',
  'administrative assistant', 'phone answering', 'office manager',
];

// THE FIRST NUMBER IN `batch` IS THE AREA ID, which is the only way this API
// can be aimed: it ignores area_id, cl_area and the Referer host, and without
// this every search returns the San Francisco Bay Area. Mapped by reading the
// town out of the returned slugs, 2026-07-31.
const AREAS = [
  { id: 3, name: 'New York', tz: 'America/New_York' },
  { id: 4, name: 'Boston', tz: 'America/New_York' },
  { id: 10, name: 'Washington DC', tz: 'America/New_York' },
  { id: 14, name: 'Atlanta', tz: 'America/New_York' },
  { id: 11, name: 'Chicago', tz: 'America/Chicago' },
  { id: 13, name: 'Denver', tz: 'America/Denver' },
  { id: 1, name: 'SF Bay Area', tz: 'America/Los_Angeles' },
  { id: 7, name: 'Los Angeles', tz: 'America/Los_Angeles' },
  { id: 8, name: 'San Diego', tz: 'America/Los_Angeles' },
  { id: 2, name: 'Seattle', tz: 'America/Los_Angeles' },
  { id: 9, name: 'Portland', tz: 'America/Los_Angeles' },
  { id: 12, name: 'Sacramento', tz: 'America/Los_Angeles' },
];

// Only search cities where it is currently a civil hour to ring a business.
// Scraping a city we cannot call is a Places bill for leads that fail the
// hours gate a minute later.
function areaAwake(area, at = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: area.tz, hour: 'numeric', hour12: false,
  }).format(at));
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: area.tz, weekday: 'short',
  }).format(at);
  return day !== 'Sun' && hour >= 9 && hour < 19;
}

// Craigslist's compact posting format is an array of scalars and [tag, value]
// pairs. Only three tags matter here.
const TAG_SLUG = 6;
const TAG_TITLE = 12;
const TAG_COMPANY = 8;

function field(item, tag) {
  for (const f of item) {
    if (Array.isArray(f) && f.length === 2 && f[0] === tag && typeof f[1] === 'string') {
      return f[1];
    }
  }
  return null;
}

// A staffing agency is not the buyer: they are hiring on behalf of somebody
// else, and the receptionist they place is the product they sell. Ringing them
// with a cheaper receptionist is ringing a competitor.
const NOT_A_BUYER = /\b(staffing|recruit|recruiting|recruitment|talent|temp agency|employment agency|placement|hr solutions|workforce|personnel|headhunt)\b/i;

async function search(query, areaId) {
  const url = 'https://sapi.craigslist.org/web/v8/postings/search/full'
    + `?batch=${areaId}-0-360-0-0&cc=US&lang=en&searchPath=ofc`
    + `&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://www.craigslist.org/',
    },
  });
  if (!res.ok) throw new Error(`craigslist ${query}: HTTP ${res.status}`);
  const body = await res.json();
  return body?.data?.items || [];
}

// The slug carries the town: "san-jose-receptionist-office-assistant". Taking
// the words before the first query word is a rough town, and rough is enough
// for a Places search that also has the company name to work with.
function townFromSlug(slug, title) {
  if (!slug) return '';
  const words = slug.split('-');
  const stop = new Set(['receptionist', 'front', 'office', 'admin', 'administrative',
    'assistant', 'manager', 'phone', 'desk', 'clerk', 'secretary', 'part', 'full']);
  const town = [];
  for (const w of words) {
    if (stop.has(w.toLowerCase())) break;
    town.push(w);
  }
  return town.join(' ');
}

async function main() {
  loadRepoEnv();
  // VITE_GOOGLE_PLACES_KEY is the name the repo actually uses; the others are
  // accepted so this does not become the one script with its own convention.
  const PLACES_KEY = process.env.VITE_GOOGLE_PLACES_KEY
    || process.env.GOOGLE_PLACES_API_KEY
    || process.env.VITE_GOOGLE_PLACES_API_KEY;
  const SB = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!PLACES_KEY) throw new Error('GOOGLE_PLACES_API_KEY is not set');
  if (!SB || !SB_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');

  // --- 1. the ads -----------------------------------------------------------
  const now = new Date();
  const awake = AREAS.filter(a => areaAwake(a, now));
  log(`Cities in business hours right now: ${awake.map(a => a.name).join(', ') || '(none)'}`);
  if (!awake.length) {
    log('Nowhere to call at this hour. Nothing scraped, nothing spent.');
    return;
  }

  const ads = new Map();           // company|town -> ad
  for (const area of awake) {
    for (const q of QUERIES) {
      let items = [];
      try {
        items = await search(q, area.id);
      } catch (e) {
        log(`  ${area.name}/${q}: ${e.message}`);
        continue;
      }
      for (const it of items) {
        const company = field(it, TAG_COMPANY);
        const title = field(it, TAG_TITLE) || '';
        const slug = field(it, TAG_SLUG) || '';
        if (!company) continue;
        const town = townFromSlug(slug, title);
        const key = `${company.toLowerCase()}|${town.toLowerCase()}`;
        if (!ads.has(key)) ads.set(key, { company, town, title, query: q, area: area.name });
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
  log(`Gate 1 ads with a company: ${ads.size} unique advertiser(s) `
    + `across ${awake.length} city/cities`);

  // --- 2. the buyer, not the agency ----------------------------------------
  const buyers = [...ads.values()].filter(a => !NOT_A_BUYER.test(a.company));
  log(`Gate 2 not an agency     : ${buyers.length} kept  (${ads.size - buyers.length} staffing/recruiting dropped)`);

  // --- 3. name + town -> phone ---------------------------------------------
  const want = Math.min(buyers.length, Math.max(LIMIT * 3, 60));
  log(`\nLooking up ${want} advertiser(s) on Google Places for a phone number...`);
  const found = [];
  for (const a of buyers.slice(0, want)) {
    try {
      const place = await lookupPlace({
        name: a.company, town: a.town, key: PLACES_KEY, referer: 'https://heyelsie.com',
      });
      const phone = place?.phone || place?.formatted_phone_number || place?.international_phone_number;
      if (!phone) continue;
      const e164 = toE164US(phone);
      if (!e164) continue;
      found.push({
        e164,
        business: a.company,
        role: a.title,
        town: a.town,
        address: place.address || place.formatted_address || null,
        website: place.website || null,
        rating: place.rating ?? null,
        reviews_count: place.reviews_count ?? place.user_ratings_total ?? null,
        maps_url: place.maps_url || null,
      });
    } catch { /* a lookup that fails is a lead we simply do not have */ }
    await new Promise(r => setTimeout(r, 120));
  }
  // Dedupe by number: one business can run several ads.
  const byNumber = new Map();
  for (const f of found) if (!byNumber.has(f.e164)) byNumber.set(f.e164, f);
  let leads = [...byNumber.values()];
  log(`Gate 3 phone found       : ${leads.length} lead(s) with a real number`);

  // --- 4/5. NANPA: landline only -------------------------------------------
  const nanpa = await nanpaLookup(leads.map(l => l.e164), {
    supabaseUrl: SB, supabaseKey: SB_KEY, log,
  });
  for (const l of leads) {
    const n = nanpa.get(l.e164) || {};
    // snake_case: what nanpaLookup actually returns. Reading lineType here
    // silently made every lead "unknown" and dropped the whole batch.
    l.line_type = n.line_type || 'unknown';
    l.state = n.state || null;
    l.timezone = l.state ? tzForState(l.state) : null;
  }
  const landline = leads.filter(l => l.line_type === 'landline');
  log(`Gate 5 line type         : ${landline.length} kept  (landline only, `
    + `${leads.length - landline.length} wireless/voip/unknown dropped)`);

  // --- 6. calling hours -----------------------------------------------------
  // callableNow returns {ok, why}, NOT a boolean. Filtering on the object
  // itself is always true, and it silently passed a shortlist of Californians
  // at 08:00 their time. The dial-time guard in Postgres would still have
  // refused them, which is the only reason this was a wasted Places bill
  // rather than a 6am phone call.
  const callable = landline.filter(l => l.state && callableNow(l.state, now).ok);
  log(`Gate 6 calling hours     : ${callable.length} kept  `
    + `(${landline.length - callable.length} outside 9-19 local right now)`);

  if (!callable.length) {
    log('\nNothing callable at this hour. Nothing screened, nothing uploaded.');
    return;
  }

  const shortlist = callable.slice(0, Math.min(LIMIT, MAX_UPLOAD));
  log(`\nShortlist of ${shortlist.length}:`);
  for (const l of shortlist.slice(0, 12)) {
    log(`  ${l.e164}  ${String(l.state || '??').padEnd(2)}  ${l.business.slice(0, 34).padEnd(34)}  ${(l.role || '').slice(0, 30)}`);
  }

  if (!APPLY) {
    log(`\n--- DRY RUN. No line-status bought, nothing uploaded. ---`);
    log(`Would screen ${shortlist.length} number(s) and upload to "${CAMPAIGN}".`);
    log('Run again with --apply to screen and upload.');
    return;
  }

  // --- 7. the only spend ----------------------------------------------------
  const screened = await screenLineStatus(shortlist.map(l => l.e164), { log });
  const alive = new Set(screened.alive || screened.keep || []);
  const final = alive.size ? shortlist.filter(l => alive.has(l.e164)) : shortlist;
  log(`Gate 7 line_status       : ${final.length} kept`);

  const rows = final.map(l => ({
    campaign: CAMPAIGN,
    e164: l.e164,
    business: l.business,
    reviews_count: l.reviews_count,
    rating: l.rating,
    website: l.website,
    address: l.address,
    maps_url: l.maps_url,
    state: l.state,
    timezone: l.timezone,
    line_type: l.line_type,
    line_status: 'active',
    status: 'queued',
  }));
  const res = await fetch(`${SB}/rest/v1/wk_ai_call_leads?on_conflict=campaign,e164`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status} ${await res.text()}`);
  const saved = await res.json();
  log(`\nUploaded ${saved.length} lead(s) to campaign "${CAMPAIGN}".`);

  fs.writeFileSync(
    path.join(HERE, 'out-hiring-receptionist-calls.json'),
    JSON.stringify(final, null, 1),
  );
  log(`Wrote ${path.join('scripts', 'out-hiring-receptionist-calls.json')} for the record.`);
  log('\nNext: run the dialer on the VPS against that campaign.');
}

main().catch(e => { console.error(e); process.exit(1); });
