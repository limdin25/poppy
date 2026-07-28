#!/usr/bin/env node
/**
 * CANONICAL plumber-leads pipeline — the ONE right way to load a batch.
 * Supersedes import-plumber-leads.mjs + enrich-plumber-reviews.mjs by running
 * all of Hugo's durable rules in the correct order, in a single command:
 *
 *   1. Named-owner rows only (the opener needs a first name).
 *   2. Google-enrich reviews + rating (the CSV count is unreliable — the
 *      scraper defaults to 0; enrich BEFORE filtering so the threshold is real).
 *   3. Keep only <= 65 reviews (drop high-review plumbers — the review-gap pitch
 *      doesn't fit them). CONFIGURABLE via MAX_REVIEWS / arg.
 *   3b. Live mobile-network screen (Twilio Lookup line_status), LAST because it
 *      is the only paid gate. Drops numbers whose subscription is dead, which
 *      the offline libphonenumber check cannot see. SKIP_LINE_STATUS=1 (alias
 *      NO_LINE_STATUS_SPEND=1) skips THIS CHECK ONLY and spends nothing; it is
 *      not a dry run, the import still happens. The run stops before spending
 *      anything if the screen would cost over GBP 15 (LINE_STATUS_MAX_SPEND).
 *   4. Import to hugo@lemlin.com + queue to the "Plumbers - test" campaign
 *      (caller-ID +447460035763).
 *   5. Order the whole pending dial queue A->Z by business name.
 *
 * Idempotent: upserts by phone (never clobbers), queues only non-pending, and a
 * final sweep deletes any queued lead that is now > MAX_REVIEWS so the invariant
 * always holds. Re-runnable for more leads or the full ~11.7k CSV (just raise
 * the count — note every kept candidate costs one Google call).
 *
 * Secrets from env only:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GOOGLE_PLACES_KEY=... \
 *     node scripts/process-plumber-leads.mjs [csvPath] [count] [maxReviews] [agentId]
 * Defaults: csv=~/Desktop/UK_Plumbers_Leads_2026-07-21.csv, count=100,
 *           maxReviews=65, agent=28dee5a4-... (hugo@lemlin.com).
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import { isTextableUkMobile } from './lib/verify-phone.mjs';
import { dropDeadNumbers, warnIfShort } from './lib/line-status.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_PLACES_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY');
  process.exit(2);
}

const CSV_PATH = process.argv[2] || join(homedir(), 'Desktop', 'UK_Plumbers_Leads_2026-07-21.csv');
const COUNT = Number(process.argv[3] || 100);
const MAX_REVIEWS = Number(process.argv[4] || 65);
const AGENT_ID = process.argv[5] || '28dee5a4-e8be-4019-a6ad-e1dcf07b875c'; // hugo@lemlin.com

const CAMPAIGN_NAME = 'Plumbers - test';
const PIPELINE_ID = 'c2022b21-7a79-4203-90dd-5b06b46eef11';           // Default workspace pipeline
const CALLER_ID_NUMBER_ID = 'c8a0346b-b197-4fd1-8ed6-19847f938c82';   // +447460035763 (UK line 2)
const REFERER = 'https://poppy-henna.vercel.app/';                    // Google key is referer-restricted

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => String(v ?? '').trim();

/** UK phone -> E.164. "07902 663017" -> "+447902663017". */
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
  'website': 'website', 'google search url': 'google_search_url', 'google maps link': 'google_maps_url',
  'registered address': 'registered_address',
};
function pick(row, header) {
  for (const k of Object.keys(row)) {
    if (k.replace(/^﻿/, '').toLowerCase().trim() === header) return row[k];
  }
  return undefined;
}

/** Real review count + rating from Google Places (name + town). */
async function findPlace(name, town) {
  const q = encodeURIComponent([name, town].filter(Boolean).join(' '));
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json`
    + `?input=${q}&inputtype=textquery&fields=name,rating,user_ratings_total&key=${GOOGLE_PLACES_KEY}`;
  try {
    const res = await fetch(url, { headers: { Referer: REFERER } });
    const json = await res.json();
    if (json.status !== 'OK' || !json.candidates?.length) return null;
    const c = json.candidates[0];
    return {
      reviews: typeof c.user_ratings_total === 'number' ? c.user_ratings_total : null,
      rating: typeof c.rating === 'number' ? String(c.rating) : null,
    };
  } catch { return null; }
}

// ── Parse + enrich + filter (streaming until COUNT keepers) ──────────────────
const raw = readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
console.log(`Parsed ${parsed.data.length} CSV rows. Target ${COUNT} keepers, max ${MAX_REVIEWS} reviews.`);

const seen = new Set();
const keepers = [];
let scanned = 0, droppedHigh = 0, enriched = 0, notFound = 0, notMobile = 0;
for (const row of parsed.data) {
  if (keepers.length >= COUNT) break;
  const owner = clean(pick(row, 'owner name 1 (man)'));
  if (!owner) continue;                                   // rule 1: named owners only
  const phone = normalizeE164(pick(row, 'mobile'));
  if (!phone || seen.has(phone)) continue;
  if (!isTextableUkMobile(phone)) { notMobile++; continue; } // landline/VoIP/toll-free can't be texted
  seen.add(phone);
  scanned++;

  const cf = {};
  for (const [header, key] of Object.entries(CF_MAP)) {
    const v = clean(pick(row, header));
    if (v) cf[key] = v;
  }
  const csvReviews = Number(cf.reviews || 0);

  // rule 2: enrich reviews/rating from Google (only when CSV <= max — a CSV
  // count already > max is genuinely high, so drop it without a wasted call).
  let realReviews = csvReviews;
  if (csvReviews <= MAX_REVIEWS) {
    const g = await findPlace(clean(pick(row, 'company name')), cf.town);
    await sleep(110);
    if (g && g.reviews != null) {
      enriched++;
      cf.reviews_csv = cf.reviews ?? '';
      cf.reviews = String(g.reviews);
      if (g.rating != null) cf.rating = g.rating;
      cf.reviews_source = 'google';
      realReviews = g.reviews;
    } else {
      notFound++;                                         // keep CSV value (unverified)
    }
  }

  if (realReviews > MAX_REVIEWS) { droppedHigh++; continue; } // rule 3

  keepers.push({ name: clean(pick(row, 'company name')) || phone, phone, customFields: cf });
}
console.log(`Scanned ${scanned} named-owner leads → ${keepers.length} keepers `
  + `(enriched ${enriched}, not-found ${notFound}, dropped >${MAX_REVIEWS}: ${droppedHigh}, `
  + `not a mobile number: ${notMobile}).`);
if (keepers.length === 0) { console.error('No keepers — aborting.'); process.exit(1); }

// ── rule 3b, THE LAST GATE: is the line alive on the mobile network? ─────────
// Deliberately after the free checks and after Google, because it is the only
// gate that costs money (about half a penny a number). isTextableUkMobile above
// is libphonenumber, an OFFLINE rulebook. It proves the number is a well-formed
// allocated GB mobile, never that the subscription still exists. Five of Maria's
// first 100 numbers were dead and all of them passed it. Only "inactive" is
// removed; "unreachable" is a real subscriber with the handset off right now and
// is always kept. SKIP_LINE_STATUS=1 to skip this check and spend nothing (the
// import still runs, so it is not a dry run of the script).
{
  const screened = await dropDeadNumbers(keepers, (l) => l.phone, { label: 'plumbers' });
  const removedDead = keepers.length - screened.kept.length;
  keepers.length = 0;
  keepers.push(...screened.kept);
  if (removedDead) console.log(`Removed ${removedDead} number(s) that are dead on the network.`);
  if (keepers.length === 0) { console.error('No keepers after the line-status screen. Aborting.'); process.exit(1); }
  // The keeper loop above stops the moment it has COUNT, and this screen then
  // takes the dead numbers back off the end, so asking for 1000 lands about 950.
  // Say so: nobody should have to count rows in the CRM to find that out.
  warnIfShort(COUNT, keepers.length, { label: 'plumbers', what: 'leads' });
}

// ── rule 4: upsert + campaign + queue ────────────────────────────────────────
const contactRows = keepers.map((l) => ({
  name: l.name, phone: l.phone, owner_agent_id: AGENT_ID,
  pipeline_column_id: null, custom_fields: l.customFields, is_hot: false,
}));
let inserted = 0;
const CHUNK = 50;
for (let i = 0; i < contactRows.length; i += CHUNK) {
  const { data, error } = await sb.from('wk_contacts')
    .upsert(contactRows.slice(i, i + CHUNK), { onConflict: 'phone', ignoreDuplicates: true })
    .select('id, phone');
  if (error) { console.error('contact upsert:', error.message); process.exit(1); }
  inserted += (data ?? []).length;
}

const phones = keepers.map((l) => l.phone);
const idByPhone = new Map();
for (let i = 0; i < phones.length; i += 200) {
  const { data, error } = await sb.from('wk_contacts').select('id, phone').in('phone', phones.slice(i, i + 200));
  if (error) { console.error('id lookup:', error.message); process.exit(1); }
  for (const r of data ?? []) idByPhone.set(r.phone, r.id);
}
const contactIds = phones.map((p) => idByPhone.get(p)).filter(Boolean);

// campaign (reuse or create)
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

// queue (skip already-pending)
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

// Fetch all pending queue rows + their contacts' name/reviews (plain queries —
// no reliance on embed shape).
const { data: pendRows } = await sb.from('wk_dialer_queue')
  .select('id, contact_id').eq('campaign_id', campaignId).eq('status', 'pending');
const pendIds = [...new Set((pendRows ?? []).map((r) => r.contact_id))];
const meta = new Map(); // contact_id -> { name, reviews }
for (let i = 0; i < pendIds.length; i += 200) {
  const { data } = await sb.from('wk_contacts').select('id, name, custom_fields').in('id', pendIds.slice(i, i + 200));
  for (const r of data ?? []) meta.set(r.id, { name: r.name || '', reviews: Number(r.custom_fields?.reviews || 0) });
}

// ── invariant sweep: drop any queued lead now > MAX_REVIEWS (cascades queue) ──
const overIds = pendIds.filter((id) => (meta.get(id)?.reviews ?? 0) > MAX_REVIEWS);
let swept = 0;
if (overIds.length) {
  const { data: del } = await sb.from('wk_contacts').delete().in('id', overIds).select('id');
  swept = (del ?? []).length;
  for (const id of overIds) meta.delete(id);
}

// ── rule 5: order the whole pending queue A->Z by business name ───────────────
const ordered = (pendRows ?? [])
  .filter((r) => meta.has(r.contact_id))
  .sort((a, b) => (meta.get(a.contact_id).name).toLowerCase().localeCompare((meta.get(b.contact_id).name).toLowerCase()));
for (let i = 0; i < ordered.length; i++) {
  await sb.from('wk_dialer_queue').update({ priority: ordered.length - i }).eq('id', ordered[i].id);
}

console.log('');
console.log('DONE');
console.log(`  campaign:   ${CAMPAIGN_NAME} (${campaignId})`);
console.log(`  contacts:   ${inserted} new`);
console.log(`  queued:     ${queued} new pending`);
console.log(`  swept >${MAX_REVIEWS}: ${swept}`);
console.log(`  ordered A→Z: ${ordered.length} pending leads`);
