#!/usr/bin/env node
// Screen scraped US plumbers and load them into the AI caller's dial queue.
//
//   node scripts/import-usa-plumber-calls.mjs                 # dry run, spends nothing
//   node scripts/import-usa-plumber-calls.mjs --apply         # screens (paid) and uploads
//   node scripts/import-usa-plumber-calls.mjs --apply --limit 25
//
// DRY BY DEFAULT. Without --apply nothing is bought and nothing is written.
//
// THE GATES, cheapest first and money last, which is the house rule:
//
//   1. free   valid NANPA number, deduped
//   2. free   Google category is a plumber who takes service calls, not a shop
//   3. free   NANPA line type. LANDLINE ONLY unless --include-wireless
//   4. free   local calling hours, from the NANPA state
//   5. free   small operator (reviews in band), the ones without a receptionist
//   6. PAID   Twilio line_status, drop "inactive"          <- the only spend
//
// Gate 2 is the one that does not exist in the UK version, and it is the most
// important one here. See scripts/lib/us-leads.mjs for why: the FCC treats an
// AI voice as an "artificial voice", and an artificial voice to a US MOBILE
// without prior consent carries statutory damages per call. Business landlines
// sit outside that. We own a copy of the numbering plan already, so telling
// them apart costs nothing, which is why it is the default rather than a
// trade-off.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toE164US, nanpaLookup, callableNow, tzForState,
} from './lib/us-leads.mjs';
import { loadRepoEnv, screenLineStatus } from './lib/line-status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGN = process.env.AI_CALL_CAMPAIGN || 'USA Plumbers - Maria';

// Hugo, 2026-07-29: "dont upload more than 100". Enforced here rather than
// remembered, because the pool is 3,790 and a slipped flag is a big bill and a
// lot of strangers' phones.
const HARD_CAP = 100;

// A plumber with 400 reviews has somebody answering the phone already, and the
// pitch (an AI receptionist looking for a job) lands on deaf ears. One with two
// reviews may not be trading. In between is the person who misses calls on a
// job and knows it.
const MIN_REVIEWS = 3;
const MAX_REVIEWS = 65;

// "plumbers" on Google Maps returns the whole trade, including the people who
// SELL to plumbers. The first dry run put Ferguson Plumbing Supply, Callahan
// Hardware and a Noland branch in the top ten, and Maria's pitch (an AI
// receptionist who can answer your calls and book your jobs) is nonsense said
// to a trade counter: they have staff on a till, and they do not go out on
// jobs at all.
//
// This is the same trap the UK video hit, and it has the same answer. A
// blocklist of shop names leaks, because there is always another merchant.
// Google's own category does not, so allow the trades that turn up at a
// customer's house and let everything else fall out. "Plumbers' merchant",
// "Plumbing supply store", "Pipe supplier" and both spellings of hardware shop
// are then excluded by simply not being on the list, rather than by being
// named.
const TRADE_CATEGORIES = new Set([
  'plumber', 'drainage service', 'central heating service',
  'heating contractor', 'gasfitter',
]);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes('--apply');
const INCLUDE_WIRELESS = process.argv.includes('--include-wireless');
// Hugo, 2026-07-29, after 22 landline calls returned 18 machines and one
// receptionist: "Switch to mobiles."
//
// WHY THE LANDLINE BATCH FAILED, since it is the whole reason this flag
// exists. A plumber with a landline has an office, and an office has an
// auto-attendant, a hold queue and somebody on reception. He already has what
// Maria is selling, so the pitch lands on staff whose job it threatens. The
// plumber who WANTS her is the one answering his own mobile between jobs.
//
// The cost of being right about the buyer is legal, and it is real. The FCC
// ruled on 2024-02-08 that an AI voice is an "artificial voice", and an
// artificial voice to a US mobile without prior express consent is 500 dollars
// a call under 47 USC 227(b), up to 1,500 if a court calls it willful. This
// list is scraped from Google Maps, so it is not opt-in and that exposure is
// live. Hugo was shown this and chose to proceed; it is his call to make and
// it is recorded here rather than buried.
const WIRELESS_ONLY = process.argv.includes('--wireless-only');
const LIMIT = Math.min(Number(arg('limit', HARD_CAP)) || HARD_CAP, HARD_CAP);
const SOURCE = arg('source', path.join(HERE, 'out-usa-plumber-leads.json'));

function log(...a) { console.log(...a); }

async function main() {
  loadRepoEnv();
  const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB || !SK) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed. Nothing done.');
    process.exit(1);
  }
  if (!fs.existsSync(SOURCE)) {
    console.error(`No lead file at ${SOURCE}.\n`
      + 'Pull one off the scraper VPS first:\n'
      + `  ssh margarita-server "sqlite3 -json /root/scraper/data/scraper.db \\"SELECT name, phone, address, `
      + `location, rating, reviews_count, website, maps_url FROM leads WHERE keyword IN ('plumbers',`
      + `'plumbing services') AND phone LIKE '+1%'\\"" > ${SOURCE}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  log(`\nSource: ${raw.length} scraped row(s) from ${path.basename(SOURCE)}`);

  // ---- Gate 1: a real, unique US number -----------------------------------
  const seen = new Set();
  let badFormat = 0, dupes = 0;
  const leads = [];
  for (const r of raw) {
    const e164 = toE164US(r.phone);
    if (!e164) { badFormat++; continue; }
    if (seen.has(e164)) { dupes++; continue; }
    seen.add(e164);
    leads.push({
      e164,
      category: (r.category || '').trim(),
      business: (r.name || '').trim() || null,
      reviews_count: Number.isFinite(r.reviews_count) ? r.reviews_count : null,
      rating: Number.isFinite(r.rating) ? r.rating : null,
      website: (r.website || '').trim() || null,
      address: (r.address || '').trim() || null,
      maps_url: (r.maps_url || '').trim() || null,
    });
  }
  log(`Gate 1 format+dedupe : ${leads.length} kept  (${badFormat} not US-shaped, ${dupes} duplicates)`);

  // ---- Gate 2: a tradesman, not a merchant, free --------------------------
  const droppedCats = new Map();
  const trades = leads.filter((l) => {
    const ok = TRADE_CATEGORIES.has(l.category.toLowerCase());
    if (!ok) droppedCats.set(l.category || '(none)', (droppedCats.get(l.category || '(none)') || 0) + 1);
    return ok;
  });
  log(`Gate 2 trade category: ${trades.length} kept`);
  for (const [c, n] of [...droppedCats].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    log(`         dropped ${String(n).padStart(4)} : ${c}`);
  }

  // ---- Gate 3: line type, free --------------------------------------------
  const nanpa = await nanpaLookup(trades.map((l) => l.e164), {
    supabaseUrl: SB, supabaseKey: SK, log,
  });
  const counts = { landline: 0, wireless: 0, voip: 0, unknown: 0 };
  for (const l of trades) {
    const m = nanpa.get(l.e164);
    l.line_type = m?.line_type ?? 'unknown';
    l.state = m?.state ?? null;
    l.timezone = tzForState(l.state);
    counts[l.line_type]++;
  }
  log(`  line types: ${JSON.stringify(counts)}`);

  const allowedTypes = WIRELESS_ONLY
    ? new Set(['wireless'])
    : INCLUDE_WIRELESS
      ? new Set(['landline', 'wireless', 'voip', 'unknown'])
      : new Set(['landline']);
  const mode = WIRELESS_ONLY
    ? 'MOBILES ONLY, see the TCPA note above: this is the exposed segment'
    : INCLUDE_WIRELESS ? 'wireless included' : 'landline only';
  let pool = trades.filter((l) => allowedTypes.has(l.line_type));
  log(`Gate 3 line type     : ${pool.length} kept  (${mode})`);

  // ---- Gate 4: is it a civil hour where they live, free -------------------
  const now = new Date();
  const outOfHours = new Map();
  pool = pool.filter((l) => {
    const c = callableNow(l.state, now);
    if (!c.ok) outOfHours.set(c.why, (outOfHours.get(c.why) || 0) + 1);
    return c.ok;
  });
  log(`Gate 4 calling hours : ${pool.length} kept`);
  for (const [why, n] of [...outOfHours].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    log(`         dropped ${String(n).padStart(4)} : ${why}`);
  }

  // ---- Gate 5: the right size of business, free ---------------------------
  pool = pool.filter((l) => l.reviews_count !== null
    && l.reviews_count >= MIN_REVIEWS && l.reviews_count <= MAX_REVIEWS);
  log(`Gate 5 ${MIN_REVIEWS}-${MAX_REVIEWS} reviews  : ${pool.length} kept`);

  if (pool.length === 0) {
    log('\nNothing survived the free gates. Nothing spent, nothing written.');
    return;
  }

  // ---- Order: best first, and spread across states ------------------------
  // Round-robin by state rather than all of Texas then all of New York. Dialling
  // one area code in a block is a pattern carriers score as robocalling, and it
  // also means one bad market cannot eat the whole batch.
  const byState = new Map();
  for (const l of [...pool].sort((a, b) => b.reviews_count - a.reviews_count)) {
    if (!byState.has(l.state)) byState.set(l.state, []);
    byState.get(l.state).push(l);
  }
  const ordered = [];
  const queues = [...byState.values()];
  for (let i = 0; ordered.length < pool.length; i++) {
    let moved = false;
    for (const q of queues) {
      if (q[i]) { ordered.push(q[i]); moved = true; }
    }
    if (!moved) break;
  }

  // ---- Gate 5b: drop everyone we have already rung -------------------------
  // The ledger blocks a second DIAL, which is the guard that matters, but it
  // does nothing about the PAID screen: re-running this script would happily
  // buy a line-status lookup for all 100 numbers called an hour ago and then
  // upload leads that can never be claimed. Same money, no leads.
  const alreadyCalled = new Set();
  {
    let from = 0;
    for (;;) {
      const res = await fetch(`${SB}/rest/v1/wk_ai_called?select=e164`, {
        headers: {
          apikey: SK,
          Authorization: `Bearer ${SK}`,
          Range: `${from}-${from + 999}`,
        },
      });
      if (!res.ok) break;
      const rows = await res.json();
      for (const r of rows) alreadyCalled.add(r.e164);
      if (rows.length < 1000) break;
      from += 1000;
    }
  }
  const fresh = ordered.filter((l) => !alreadyCalled.has(l.e164));
  log(`Gate 5b never rung   : ${fresh.length} kept  `
    + `(${ordered.length - fresh.length} already in the ledger)`);

  // Screen a little over the target so drops do not leave us short, but never
  // upload more than the cap.
  const headroom = Math.min(fresh.length, Math.ceil(LIMIT * 1.3));
  const candidates = fresh.slice(0, headroom);
  log(`\nOrdered ${ordered.length} candidate(s) across ${byState.size} state(s); `
    + `screening the top ${candidates.length} to fill ${LIMIT}.`);

  if (!APPLY) {
    log('\n--- DRY RUN. No lookup bought, nothing uploaded. ---');
    log(`Would screen ${candidates.length} number(s) with Twilio line_status `
      + `(about GBP ${(candidates.length * 0.0053).toFixed(2)}) and upload up to ${LIMIT}.`);
    log('\nFirst 10 in dial order:');
    for (const l of candidates.slice(0, 10)) {
      log(`  ${l.e164}  ${String(l.state).padEnd(3)} ${String(l.reviews_count).padStart(3)}rev  ${l.business}`);
    }
    log('\nRun again with --apply to screen and upload.');
    return;
  }

  // ---- Gate 5: the live network screen. The only money. -------------------
  const screen = await screenLineStatus(candidates.map((l) => l.e164), { label: 'usa-plumbers' });
  const live = candidates.filter((l) => !screen.dead.has(l.e164));
  for (const l of live) l.line_status = screen.statusByPhone.get(l.e164) ?? null;
  log(`Gate 6 line_status   : ${live.length} kept, ${screen.dead.size} dead number(s) dropped`
    + `${screen.skipped ? '  (SCREEN SKIPPED, every number unscreened)' : ''}`);

  const final = live.slice(0, LIMIT);
  log(`\nUploading ${final.length} lead(s) to campaign "${CAMPAIGN}".`);

  // ---- Upload -------------------------------------------------------------
  // on_conflict on (campaign,e164) so re-running tops the queue up instead of
  // duplicating it. Numbers already dialled are still blocked by the ledger at
  // claim time, which is the guard that actually matters.
  const rows = final.map((l, i) => ({
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
    line_status: l.line_status ?? null,
    screened_at: new Date().toISOString(),
    priority: i,
  }));

  const res = await fetch(`${SB}/rest/v1/wk_ai_call_leads?on_conflict=campaign,e164`, {
    method: 'POST',
    headers: {
      apikey: SK, Authorization: `Bearer ${SK}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`Upload FAILED: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const written = await res.json();
  log(`Uploaded ${written.length} row(s).`);

  const outPath = path.join(HERE, 'out-usa-plumber-calls.json');
  fs.writeFileSync(outPath, JSON.stringify(final, null, 2));
  log(`Wrote ${outPath} for the record.`);
  log(`\nSpent about GBP ${screen.costGbp.toFixed(2)} on ${screen.billed} live lookup(s).`);
  log(`\nNext: run the dialer on the VPS.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
