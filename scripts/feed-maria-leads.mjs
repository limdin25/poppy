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
 *   1. Named-owner only (same as every other plumber pipeline — the opener
 *      needs a first name).
 *   2. UNUSED — the phone must not already exist ANYWHERE in wk_contacts.
 *      Unlike process-plumber-leads.mjs (which upserts and can silently
 *      re-queue a lead someone else already owns), this preloads every
 *      existing phone and skips it outright, so nothing here can collide
 *      with the one-agent-per-lead lock.
 *   3. Real mobile number (scripts/lib/verify-phone.mjs — same check
 *      /admin/phone-validation uses).
 *   4. No website — Website column must be blank.
 *   5. 0–25 reviews, Google-enriched (the CSV count defaults to 0 when the
 *      scraper couldn't read it, so this re-checks with Places before
 *      trusting a "0").
 *
 * Queues everything to a dedicated "Plumbers - Maria" campaign on her own
 * number, ordered A→Z — same pattern as Pedro/Marr's campaigns. QUEUES ONLY.
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
const CALLER_ID_NUMBER_ID = 'c8a0346b-b197-4fd1-8ed6-19847f938c82'; // +447460035763 — Maria's own line
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
};
function pick(row, header) {
  for (const k of Object.keys(row)) {
    if (k.replace(/^﻿/, '').toLowerCase().trim() === header) return row[k];
  }
  return undefined;
}

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
let scanned = 0, dupOrUsed = 0, notMobile = 0, hasWebsite = 0, droppedHigh = 0, enriched = 0, notFound = 0;
for (const row of parsed.data) {
  if (keepers.length >= COUNT) break;
  const owner = clean(pick(row, 'owner name 1 (man)'));
  if (!owner) continue;                                       // rule 1: named owners only

  const phone = normalizeE164(pick(row, 'mobile'));
  if (!phone || seen.has(phone) || existingPhones.has(phone)) { dupOrUsed++; continue; } // rule 2
  if (!isTextableUkMobile(phone)) { notMobile++; continue; }   // rule 3
  seen.add(phone);

  const website = clean(pick(row, 'website'));
  if (website) { hasWebsite++; continue; }                     // rule 4

  scanned++;
  const cf = {};
  for (const [header, key] of Object.entries(CF_MAP)) {
    const v = clean(pick(row, header));
    if (v) cf[key] = v;
  }
  const csvReviews = Number(cf.reviews || 0);

  // rule 5: enrich reviews/rating from Google before trusting a "0" or any
  // count already <= MAX_REVIEWS (the scraper defaults to 0 when it can't read it).
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
      notFound++;
    }
  }
  if (realReviews > MAX_REVIEWS) { droppedHigh++; continue; }

  keepers.push({ name: clean(pick(row, 'company name')) || phone, phone, customFields: cf });
}
console.log(`Scanned ${scanned} named-owner/no-website/mobile candidates → ${keepers.length} keepers `
  + `(enriched ${enriched}, not-found ${notFound}, dropped >${MAX_REVIEWS}: ${droppedHigh}, `
  + `already used/dup: ${dupOrUsed}, not mobile: ${notMobile}, has website: ${hasWebsite}).`);
if (keepers.length === 0) { console.error('No keepers — aborting.'); process.exit(1); }
if (keepers.length < COUNT) console.warn(`Only found ${keepers.length}/${COUNT} — CSV may be running low on this filter.`);

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

// campaign (reuse or create) — dedicated to Maria, mirrors Pedro/Marr's pattern
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
console.log('DONE — queued only, nothing texted or dialled.');
console.log(`  campaign:    ${CAMPAIGN_NAME} (${campaignId})`);
console.log(`  caller ID:   +447460035763 (Maria's own line)`);
console.log(`  contacts:    ${inserted} new, all owner_agent_id=Maria, all previously unused`);
console.log(`  queued:      ${queued} new pending`);
console.log(`  ordered A→Z: ${ordered.length} pending leads`);
