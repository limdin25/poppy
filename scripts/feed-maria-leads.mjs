#!/usr/bin/env node
/**
 * Feed Maria a batch of GENUINELY UNUSED plumber leads, on her own dedicated
 * campaign/number, matching the same isolation rules shipped 2026-07-28
 * (see supabase/migrations/20260728000001_agent_isolation_and_lead_lock.sql).
 *
 * Hugo, 2026-07-28: "feed maria with 100 unused plumber leads, with 0 to 25
 * reviews and no website ... I will tell you what to text later."
 *
 * Rules, all enforced before a row counts as a keeper:
 *   1. Named-owner only (same as every other plumber pipeline, the opener
 *      needs a first name).
 *   2. UNUSED. The phone must not already exist ANYWHERE in wk_contacts.
 *      Unlike process-plumber-leads.mjs (which upserts and can silently
 *      re-queue a lead someone else already owns), this preloads every
 *      existing phone and skips it outright, so nothing here can collide
 *      with the one-agent-per-lead lock.
 *   3. Real mobile number (scripts/lib/verify-phone.mjs, the same check
 *      /admin/phone-validation uses).
 *   4. No website, VERIFIED LIVE AGAINST GOOGLE, not just a blank CSV column.
 *      The blank column is a cheap pre-filter only. Every surviving candidate
 *      is checked against Google Places in the same pass as the reviews, and a
 *      lead with a real site is dropped before it can be queued.
 *      Hugo, 2026-07-28: this cost him credibility on a LIVE send. 100 plumbers
 *      got "I saw you on Google and noticed you dont have a website, I built you
 *      one". One of the six who replied wrote back "Look again". He has a site.
 *      A blank column means "no website link on the Google listing", which is
 *      NOT the same thing as "no website", so it is no longer trusted on its own.
 *      Two gates now: Google Places (the field the CSV copied, checked live),
 *      then the open web (scripts/lib/find-live-website.mjs) for the sites
 *      Google cannot see because the owner never linked them.
 *   5. 0 to 25 reviews, Google-enriched (the CSV count defaults to 0 when the
 *      scraper couldn't read it, so this re-checks with Places before
 *      trusting a "0"). Same single Places call as rule 4.
 *   6. Verifiable. If Google returns no record for the candidate we cannot
 *      stand behind "you dont have a website", so the lead is dropped.
 *   7. ALIVE ON THE NETWORK. Rule 3 is libphonenumber, an offline rulebook: it
 *      proves the number is a well-formed, allocated GB mobile and nothing more.
 *      Five of Maria's first 100 numbers were dead subscriptions that passed it
 *      cleanly. Twilio Lookup line_status asks the operator, and it is checked
 *      LAST because it is the only gate that costs money (about half a penny a
 *      number). Only "inactive" is dropped, never "unreachable" (that is a real
 *      subscriber with the handset switched off right now).
 *      SKIP_LINE_STATUS=1 (alias NO_LINE_STATUS_SPEND=1) skips THIS ONE CHECK and
 *      spends nothing, keeping every number unscreened. It is NOT a dry run of
 *      the script: everything else, including writing leads to the CRM, still
 *      happens for real.
 *      Spend cap: the run stops before buying anything if the screen would cost
 *      more than GBP 15 (LINE_STATUS_MAX_SPEND to raise it for one run).
 *
 * Queues everything to a dedicated "Plumbers - Maria" campaign on her own
 * number, ordered A to Z, the same pattern as Pedro/Marr's campaigns. QUEUES ONLY.
 * Nothing is texted or dialled by this script; Hugo will supply the copy
 * before anyone sends.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GOOGLE_PLACES_KEY=... \
 *     node scripts/feed-maria-leads.mjs [csvPath] [count]
 * Defaults: csv=~/Desktop/UK_Plumbers_Leads_2026-07-23.csv, count=100.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import { isTextableUkMobile } from './lib/verify-phone.mjs';
import { lookupPlace } from './lib/google-place.mjs';
import { findOwnWebsite } from './lib/find-live-website.mjs';
import { dropDeadNumbers, warnIfShort } from './lib/line-status.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_PLACES_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY');
  process.exit(2);
}

const CSV_PATH = process.argv[2] || join(homedir(), 'Desktop', 'UK_Plumbers_Leads_2026-07-23.csv');
const COUNT = Number(process.argv[3] || 100);
const MAX_REVIEWS = 25;

const AGENT_ID = '2b382f7f-defe-4c7d-b25a-470625a038bb';        // plumberstexttest@heyelsie.com (Maria)
const CAMPAIGN_NAME = 'Plumbers - Maria';
const PIPELINE_ID = 'c2022b21-7a79-4203-90dd-5b06b46eef11';     // Default workspace pipeline
const CALLER_ID_NUMBER_ID = 'c8a0346b-b197-4fd1-8ed6-19847f938c82'; // +447460035763, Maria's own line
const REFERER = 'https://poppy-henna.vercel.app/';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => String(v ?? '').trim();

function normalizeE164(raw) {
  const s = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) return s;
  if (s.startsWith('0')) return '+44' + s.slice(1);
  if (s.startsWith('44')) return '+' + s;
  if (s.length >= 9 && s.length <= 11) return '+44' + s;
  return null;
}

const CF_MAP = {
  'owner name 1 (man)': 'owner_name', 'star rating': 'rating', 'number of reviews': 'reviews',
  'rank position': 'rank', 'plumbers ahead': 'plumbers_ahead', 'total plumbers in town': 'total_plumbers',
  'competitor 1': 'competitor_1', 'competitor 2': 'competitor_2', 'town/city': 'town',
  'website': 'website', 'google maps address': 'google_maps_url', 'registered address': 'registered_address',
  'google maps link': 'google_maps_link',
};
function pick(row, header) {
  for (const k of Object.keys(row)) {
    if (k.replace(/^﻿/, '').toLowerCase().trim() === header) return row[k];
  }
  return undefined;
}

// ── preload EVERY existing phone so "unused" actually means unused ──────────
console.log('Preloading existing phones (any agent, any campaign)...');
const existingPhones = new Set();
{
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('wk_contacts').select('phone').order('phone', { ascending: true }).range(from, from + 999);
    if (error) { console.error('preload phones:', error.message); process.exit(1); }
    for (const r of data ?? []) existingPhones.add(r.phone);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}
console.log(`Loaded ${existingPhones.size} existing phones to exclude. Need ${COUNT} fresh keepers.`);

// ── parse + filter (streaming until COUNT keepers) ───────────────────────────
const raw = readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
console.log(`Parsed ${parsed.data.length} CSV rows from ${CSV_PATH}.`);

const seen = new Set();
const keepers = [];
let scanned = 0, dupOrUsed = 0, notMobile = 0, hasWebsiteCsv = 0, hasWebsiteGoogle = 0,
    hasWebsiteLive = 0, droppedHigh = 0, enriched = 0, unverified = 0;
for (const row of parsed.data) {
  if (keepers.length >= COUNT) break;
  const owner = clean(pick(row, 'owner name 1 (man)'));
  if (!owner) continue;                                       // rule 1: named owners only

  const phone = normalizeE164(pick(row, 'mobile'));
  if (!phone || seen.has(phone) || existingPhones.has(phone)) { dupOrUsed++; continue; } // rule 2
  if (!isTextableUkMobile(phone)) { notMobile++; continue; }   // rule 3
  seen.add(phone);

  // rule 4, part one: the CSV column is a FREE pre-filter, nothing more. A value
  // here is a reliable "yes they have a site", a blank is not a reliable "no".
  if (clean(pick(row, 'website'))) { hasWebsiteCsv++; continue; }

  const cf = {};
  for (const [header, key] of Object.entries(CF_MAP)) {
    const v = clean(pick(row, header));
    if (v) cf[key] = v;
  }
  const csvReviews = Number(cf.reviews || 0);
  // Cheap drop before spending a Places call: the CSV count only ever
  // under-reports (it defaults to 0 when the scraper can't read it), so a CSV
  // count already over the cap can never come back under it.
  if (csvReviews > MAX_REVIEWS) { droppedHigh++; continue; }

  scanned++;
  // ONE Places call per candidate answers rules 4, 5 and 6 together. The CSV
  // carries the exact place id in its Maps link, so this is a single round trip
  // and it looks up THE right business, not the closest name match.
  const g = await lookupPlace({
    name: clean(pick(row, 'company name')),
    town: cf.town,
    mapsLink: cf.google_maps_link,
    key: GOOGLE_PLACES_KEY,
    referer: REFERER,
  });
  await sleep(110);

  // rule 6: no Google record means we cannot honestly say "you have no website".
  if (!g) { unverified++; continue; }

  // rule 4, part two: Google says they DO have a site, so this lead never
  // reaches a queue and never gets the "I built you one" opener.
  if (g.website) { hasWebsiteGoogle++; continue; }

  // rule 5: trust Google's count over the CSV's. Done before the open-web check
  // so a lead that fails on reviews never costs us a page fetch.
  let realReviews = csvReviews;
  if (g.reviews != null) {
    enriched++;
    cf.reviews_csv = cf.reviews ?? '';
    cf.reviews = String(g.reviews);
    if (g.rating != null) cf.rating = g.rating;
    cf.reviews_source = 'google';
    realReviews = g.reviews;
  }
  if (realReviews > MAX_REVIEWS) { droppedHigh++; continue; }

  // rule 4, part three: Google only knows the URL an owner typed into their
  // Business Profile. SJC Plumbing Heating and Gas in Salisbury has no website
  // field on Google and a live site at sjcplumbingheatingandgas.co.uk, which is
  // why its owner replied "Look again". Free DNS-first check, strict proof
  // (the lead's own mobile printed on the page), so it drops the real hits
  // without throwing away same-name businesses in other towns.
  const own = await findOwnWebsite({ name: clean(pick(row, 'company name')), town: cf.town, phone });
  if (own) { hasWebsiteLive++; continue; }
  cf.website_checked = 'google_and_web_no_site';

  keepers.push({ name: clean(pick(row, 'company name')) || phone, phone, customFields: cf });
}
console.log(`Checked ${scanned} named-owner/mobile candidates against Google -> ${keepers.length} keepers `
  + `(enriched ${enriched}, dropped >${MAX_REVIEWS}: ${droppedHigh}, `
  + `already used/dup: ${dupOrUsed}, not mobile: ${notMobile}, `
  + `website in CSV: ${hasWebsiteCsv}, website found on Google: ${hasWebsiteGoogle}, `
  + `website found live on the web: ${hasWebsiteLive}, unverifiable on Google: ${unverified}).`);
if (keepers.length === 0) { console.error('No keepers, aborting.'); process.exit(1); }

// ── rule 7, THE LAST GATE: is the line actually alive on the network? ───────
// Runs last on purpose. It is the only check that costs money (about half a
// penny a number), so it only ever sees candidates that already survived the
// free offline format check and the Google/website/review checks.
// Rule 3 above proved the number is a well-formed, allocated GB mobile. It
// cannot prove the subscription still exists: Maria's first 100 sends had 5
// dead numbers that all looked perfect offline. Only the operator knows, and
// undeliverables on a brand-new long code are a reputation problem, not a 4p
// problem. Dead ("inactive") numbers are removed here, before anything is
// written to wk_contacts, so they never reach a queue or a send.
const screened = await dropDeadNumbers(keepers, (l) => l.phone, { label: 'Maria' });
const removedDead = keepers.length - screened.kept.length;
keepers.length = 0;
keepers.push(...screened.kept);
if (removedDead) console.log(`Removed ${removedDead} number(s) that are dead on the network.`);
if (keepers.length === 0) { console.error('No keepers after the line-status screen, aborting.'); process.exit(1); }
// The keeper loop stopped at COUNT and the screen then took dead numbers back
// off the end, so this run almost always lands a little under the ask.
warnIfShort(COUNT, keepers.length, { label: 'Maria', what: 'leads' });

// ── insert (fresh phones only, so this is a plain insert, not upsert) ───────
const contactRows = keepers.map((l) => ({
  name: l.name, phone: l.phone, owner_agent_id: AGENT_ID,
  pipeline_column_id: null, custom_fields: l.customFields, is_hot: false,
}));
let inserted = 0;
const CHUNK = 50;
for (let i = 0; i < contactRows.length; i += CHUNK) {
  const { data, error } = await sb.from('wk_contacts')
    .insert(contactRows.slice(i, i + CHUNK))
    .select('id, phone');
  if (error) { console.error('contact insert:', error.message); process.exit(1); }
  inserted += (data ?? []).length;
}

const phones = keepers.map((l) => l.phone);
const idByPhone = new Map();
for (let i = 0; i < phones.length; i += 200) {
  const { data, error } = await sb.from('wk_contacts').select('id, phone, owner_agent_id').in('phone', phones.slice(i, i + 200));
  if (error) { console.error('id lookup:', error.message); process.exit(1); }
  for (const r of data ?? []) if (r.owner_agent_id === AGENT_ID) idByPhone.set(r.phone, r.id);
}
const contactIds = phones.map((p) => idByPhone.get(p)).filter(Boolean);

// campaign (reuse or create), dedicated to Maria, mirrors Pedro/Marr's pattern
let campaignId;
const { data: existing } = await sb.from('wk_dialer_campaigns').select('id').eq('name', CAMPAIGN_NAME).maybeSingle();
if (existing?.id) campaignId = existing.id;
else {
  const { data, error } = await sb.from('wk_dialer_campaigns')
    .insert({ name: CAMPAIGN_NAME, pipeline_id: PIPELINE_ID, parallel_lines: 1, created_by: AGENT_ID, is_active: true })
    .select('id').single();
  if (error) { console.error('campaign create:', error.message); process.exit(1); }
  campaignId = data.id;
}
await sb.from('wk_campaign_agents')
  .upsert({ campaign_id: campaignId, agent_id: AGENT_ID, role: 'agent' }, { onConflict: 'campaign_id,agent_id', ignoreDuplicates: true });
const { data: numLink } = await sb.from('wk_campaign_numbers')
  .select('id').eq('campaign_id', campaignId).eq('number_id', CALLER_ID_NUMBER_ID).maybeSingle();
if (!numLink) await sb.from('wk_campaign_numbers').insert({ campaign_id: campaignId, number_id: CALLER_ID_NUMBER_ID, priority: 0 });

// queue (skip already-pending, though everything here is brand new)
const { data: pend } = await sb.from('wk_dialer_queue')
  .select('contact_id').eq('campaign_id', campaignId).eq('status', 'pending').in('contact_id', contactIds);
const alreadyPending = new Set((pend ?? []).map((r) => r.contact_id));
const queueInserts = contactIds.filter((id) => !alreadyPending.has(id))
  .map((id) => ({ campaign_id: campaignId, contact_id: id, status: 'pending', priority: 0 }));
let queued = 0;
for (let i = 0; i < queueInserts.length; i += CHUNK) {
  const { data, error } = await sb.from('wk_dialer_queue').insert(queueInserts.slice(i, i + CHUNK)).select('id');
  if (error) { console.error('queue insert:', error.message); process.exit(1); }
  queued += (data ?? []).length;
}

// order A→Z by business name
const { data: pendRows } = await sb.from('wk_dialer_queue')
  .select('id, contact_id').eq('campaign_id', campaignId).eq('status', 'pending');
const pendIds = [...new Set((pendRows ?? []).map((r) => r.contact_id))];
const nameById = new Map();
for (let i = 0; i < pendIds.length; i += 200) {
  const { data } = await sb.from('wk_contacts').select('id, name').in('id', pendIds.slice(i, i + 200));
  for (const r of data ?? []) nameById.set(r.id, r.name || '');
}
const ordered = (pendRows ?? [])
  .filter((r) => nameById.has(r.contact_id))
  .sort((a, b) => nameById.get(a.contact_id).toLowerCase().localeCompare(nameById.get(b.contact_id).toLowerCase()));
for (let i = 0; i < ordered.length; i++) {
  await sb.from('wk_dialer_queue').update({ priority: ordered.length - i }).eq('id', ordered[i].id);
}

console.log('');
console.log('DONE. Queued only, nothing texted or dialled.');
console.log(`  campaign:    ${CAMPAIGN_NAME} (${campaignId})`);
console.log(`  caller ID:   +447460035763 (Maria's own line)`);
console.log(`  contacts:    ${inserted} new, all owner_agent_id=Maria, all previously unused`);
console.log(`  queued:      ${queued} new pending`);
console.log(`  ordered A→Z: ${ordered.length} pending leads`);
