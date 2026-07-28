#!/usr/bin/env node
/**
 * Split a plumber-leads CSV across multiple agents — each gets their own
 * campaign, caller-ID, and an A→Z queue. Distributes distinct leads to N
 * agents with NO overlap (skips any phone already in the CRM).
 *
 * REVIEW COUNTS — read this before changing anything (learned 2026-07-24):
 * The scraper (`/Users/hugo/Whats/scraper`) already applies the ≤65-review rule
 * at scrape time, BUT its filter is `rc is not None and rc > max_reviews`, so a
 * listing whose review count it could NOT read is kept and exported as **0**.
 * So in the CSV:
 *   • a real number 1..65  = genuinely checked by our own scraper → TRUST IT (free)
 *   • 0 / blank            = NOT checked, unknown → could be 279. DROP by default.
 * A 60-lead sample (2026-07-24) put the non-zero counts at 21/22 exact, while
 * 11 of 19 "0" rows were really over 65. Set `ENRICH=1` to Google-verify the
 * zeros instead of dropping them (costs ~$22 per 1,000 lookups).
 *
 * OWNER NAMES: the CSV's `Match Confidence` grades the Companies House match.
 * HIGH (own website) > medium (name+city) > low (name only - CHECK city).
 * We fill from the best tier down, so "low" is only used if we run short.
 *
 * Batches are configured inline below. Count-per-agent via arg (default 1000).
 *
 * Secrets from env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *                   GOOGLE_PLACES_KEY (only when ENRICH=1)
 * Usage: node scripts/assign-agent-batches.mjs [perAgent] [csvPath] [maxReviews]
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import { isTextableUkMobile } from './lib/verify-phone.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY } = process.env;
const ENRICH = process.env.ENRICH === '1';
// ORDER_ONLY=1 imports nothing — it just re-sorts each agent's existing pending
// queue A→Z. Use it after a partial/failed ordering pass.
const ORDER_ONLY = process.env.ORDER_ONLY === '1';
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
if (ENRICH && !GOOGLE_PLACES_KEY) {
  console.error('ENRICH=1 needs GOOGLE_PLACES_KEY');
  process.exit(2);
}

const PER_AGENT = Number(process.argv[2] || 1000);
const CSV_PATH = process.argv[3] || join(homedir(), 'Desktop', 'UK_Plumbers_Leads_2026-07-23.csv');
const MAX_REVIEWS = Number(process.argv[4] || 65);
const PIPELINE_ID = 'c2022b21-7a79-4203-90dd-5b06b46eef11';
const REFERER = 'https://poppy-henna.vercel.app/';
const CONF_TIERS = ['HIGH', 'medium', 'low']; // best owner-name match first

// One entry per agent. numberId = wk_numbers.id of their assigned caller-ID.
const BATCHES = [
  { label: 'Pedro', agentId: 'c3e3c2a7-4cfb-4381-ab35-335fb1a331f1', campaign: 'Plumbers - Pedro', numberId: '1a04cead-c768-46f4-8434-3ef94de7b6e3' },
  { label: 'Marr',  agentId: '7b677273-f330-43c7-b21a-6242d6f8881a', campaign: 'Plumbers - Marr',  numberId: 'dddeba3a-7018-409d-94df-3ce085d62f29' },
];
const NEEDED = PER_AGENT * BATCHES.length;

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
  'website': 'website', 'google search url': 'google_search_url', 'google maps link': 'google_maps_url',
  'registered address': 'registered_address',
};
function pick(row, header) {
  for (const k of Object.keys(row)) if (k.replace(/^﻿/, '').toLowerCase().trim() === header) return row[k];
  return undefined;
}
function confTier(raw) {
  const c = clean(raw).toLowerCase();
  if (c.startsWith('high')) return 'HIGH';
  if (c.startsWith('medium')) return 'medium';
  if (c.startsWith('low')) return 'low';
  return null; // "no match" / blank — these have no owner name anyway
}
async function findPlace(name, town) {
  const q = encodeURIComponent([name, town].filter(Boolean).join(' '));
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${q}&inputtype=textquery&fields=name,rating,user_ratings_total&key=${GOOGLE_PLACES_KEY}`;
  try {
    const res = await fetch(url, { headers: { Referer: REFERER } });
    const j = await res.json();
    if (j.status !== 'OK' || !j.candidates?.length) return null;
    const c = j.candidates[0];
    return { reviews: typeof c.user_ratings_total === 'number' ? c.user_ratings_total : null, rating: typeof c.rating === 'number' ? String(c.rating) : null };
  } catch { return null; }
}

// Pre-load existing phones so batches never overlap or re-import.
// ORDER BY is required: paginating without one lets Postgres return rows in an
// unstable order, so a page boundary can silently skip an existing phone.
const existingPhones = new Set();
if (!ORDER_ONLY) {
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('wk_contacts').select('phone').order('phone', { ascending: true }).range(from, from + 999);
    if (error) { console.error('preload phones:', error.message); process.exit(1); }
    for (const r of data ?? []) existingPhones.add(r.phone);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
}
console.log(`Loaded ${existingPhones.size} existing phones to skip. Need ${NEEDED} new keepers (${PER_AGENT}/agent).`);

// ---- 1. select candidates from the CSV (no network) -------------------------
const raw = ORDER_ONLY ? '' : readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const parsed = ORDER_ONLY ? { data: [] } : Papa.parse(raw, { header: true, skipEmptyLines: true });
const seen = new Set();
const byTier = { HIGH: [], medium: [], low: [] };
let named = 0, dupOrKnown = 0, unverified = 0, overCap = 0, notMobile = 0;
for (const row of parsed.data) {
  const owner = clean(pick(row, 'owner name 1 (man)'));
  if (!owner) continue;
  named++;
  const tier = confTier(pick(row, 'match confidence'));
  if (!tier) continue;
  const phone = normalizeE164(pick(row, 'mobile'));
  if (!phone || seen.has(phone) || existingPhones.has(phone)) { dupOrKnown++; continue; }
  if (!isTextableUkMobile(phone)) { notMobile++; continue; } // landline/VoIP/toll-free can't be texted
  seen.add(phone);
  const cf = {};
  for (const [h, k] of Object.entries(CF_MAP)) { const v = clean(pick(row, h)); if (v) cf[k] = v; }
  const csvReviews = Number(cf.reviews || 0);
  if (!ENRICH) {
    // 0 / blank means "the scraper could not read it", NOT "no reviews". Drop.
    if (!csvReviews) { unverified++; continue; }
    if (csvReviews > MAX_REVIEWS) { overCap++; continue; }
    cf.reviews_source = 'scraper';
  }
  byTier[tier].push({ name: clean(pick(row, 'company name')) || phone, phone, customFields: cf, tier, csvReviews });
}
if (!ORDER_ONLY) console.log(`CSV: ${named} named-owner rows · available after skip/dedupe — HIGH ${byTier.HIGH.length}, medium ${byTier.medium.length}, low ${byTier.low.length}` +
  (ENRICH ? ' (ENRICH on)' : ` (dropped ${unverified} unverified "0-review", ${overCap} over ${MAX_REVIEWS})`) +
  ` (not a mobile number: ${notMobile})`);

// Fill from the best owner-name confidence tier down, alphabetical within tier.
const keepers = [];
for (const tier of ORDER_ONLY ? [] : CONF_TIERS) {
  for (const cand of byTier[tier]) {
    if (keepers.length >= NEEDED) break;
    if (ENRICH) {
      // Verify the review count on Google before accepting (costs money).
      const g = await findPlace(cand.name, cand.customFields.town);
      await sleep(110);
      if (g && g.reviews != null) {
        cand.customFields.reviews_csv = cand.customFields.reviews ?? '';
        cand.customFields.reviews = String(g.reviews);
        if (g.rating != null) cand.customFields.rating = g.rating;
        cand.customFields.reviews_source = 'google';
        if (g.reviews > MAX_REVIEWS) { overCap++; continue; }
      } else if (!cand.csvReviews) { unverified++; continue; } // unknown stays unknown
      else if (cand.csvReviews > MAX_REVIEWS) { overCap++; continue; }
      else cand.customFields.reviews_source = 'scraper';
    }
    keepers.push(cand);
    if (keepers.length % 250 === 0) console.log(`  …${keepers.length}/${NEEDED} keepers`);
  }
  if (keepers.length >= NEEDED) break;
  console.log(`  tier "${tier}" exhausted at ${keepers.length}/${NEEDED} — falling through to the next tier`);
}
const tierCount = keepers.reduce((a, k) => ((a[k.tier] = (a[k.tier] || 0) + 1), a), {});
if (ORDER_ONLY) console.log('ORDER_ONLY — importing nothing, just re-sorting the pending queues A→Z.');
else {
  console.log(`Selected ${keepers.length} keepers by owner-name confidence:`, tierCount);
  if (keepers.length < NEEDED) console.warn(`⚠ only ${keepers.length} keepers (< ${NEEDED}); batches will be smaller.`);
}

// Deal alternately (Pedro, Marr, Pedro, …) so both agents get an even spread of
// the alphabet and of owner-name confidence, instead of one taking A–M.
const dealt = BATCHES.map(() => []);
keepers.forEach((k, i) => dealt[i % BATCHES.length].push(k));

// ---- 2. import + queue per agent -------------------------------------------
const CHUNK = 50;
async function processBatch(batch, leads) {
  // upsert contacts owned by the agent
  let inserted = 0;
  for (let i = 0; !ORDER_ONLY && i < leads.length; i += CHUNK) {
    const rows = leads.slice(i, i + CHUNK).map((l) => ({ name: l.name, phone: l.phone, owner_agent_id: batch.agentId, pipeline_column_id: null, custom_fields: l.customFields, is_hot: false }));
    const { data, error } = await sb.from('wk_contacts').upsert(rows, { onConflict: 'phone', ignoreDuplicates: true }).select('id, phone');
    if (error) { console.error(`[${batch.label}] upsert:`, error.message); process.exit(1); }
    inserted += (data ?? []).length;
  }
  // ids by phone — only rows this agent actually owns (never queue someone
  // else's contact into this campaign if a phone slipped through the skip-set)
  const phones = ORDER_ONLY ? [] : leads.map((l) => l.phone);
  const idByPhone = new Map();
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await sb.from('wk_contacts').select('id, phone, name, owner_agent_id').in('phone', phones.slice(i, i + 200));
    for (const r of data ?? []) if (r.owner_agent_id === batch.agentId) idByPhone.set(r.phone, { id: r.id, name: r.name });
  }
  const contacts = phones.map((p) => idByPhone.get(p)).filter(Boolean);
  const skippedNotOwned = phones.length - contacts.length;
  if (skippedNotOwned) console.warn(`[${batch.label}] ${skippedNotOwned} lead(s) already belonged to someone else — not queued.`);

  // campaign (reuse or create)
  let campaignId;
  const { data: ex } = await sb.from('wk_dialer_campaigns').select('id').eq('name', batch.campaign).maybeSingle();
  if (ex?.id) campaignId = ex.id;
  else {
    const { data, error } = await sb.from('wk_dialer_campaigns').insert({ name: batch.campaign, pipeline_id: PIPELINE_ID, parallel_lines: 1, created_by: batch.agentId, is_active: true }).select('id').single();
    if (error) { console.error(`[${batch.label}] campaign:`, error.message); process.exit(1); }
    campaignId = data.id;
  }
  await sb.from('wk_campaign_agents').upsert({ campaign_id: campaignId, agent_id: batch.agentId, role: 'agent' }, { onConflict: 'campaign_id,agent_id', ignoreDuplicates: true });
  const { data: nl } = await sb.from('wk_campaign_numbers').select('id').eq('campaign_id', campaignId).eq('number_id', batch.numberId).maybeSingle();
  if (!nl) await sb.from('wk_campaign_numbers').insert({ campaign_id: campaignId, number_id: batch.numberId, priority: 0 });

  // queue non-pending
  const ids = contacts.map((c) => c.id);
  const { data: pend } = ids.length
    ? await sb.from('wk_dialer_queue').select('contact_id').eq('campaign_id', campaignId).eq('status', 'pending').in('contact_id', ids)
    : { data: [] };
  const already = new Set((pend ?? []).map((r) => r.contact_id));
  const qIns = ids.filter((id) => !already.has(id)).map((id) => ({ campaign_id: campaignId, contact_id: id, status: 'pending', priority: 0 }));
  let queued = 0;
  for (let i = 0; i < qIns.length; i += CHUNK) {
    const { data, error } = await sb.from('wk_dialer_queue').insert(qIns.slice(i, i + CHUNK)).select('id');
    if (error) { console.error(`[${batch.label}] queue:`, error.message); process.exit(1); }
    queued += (data ?? []).length;
  }

  // order the WHOLE pending queue A→Z (old leads still to dial + the new ones
  // merge into one alphabetical list). Names for pre-existing rows are fetched
  // too — ordering only this batch would interleave the two lists wrongly.
  // MUST paginate: PostgREST caps a single response at db.max_rows (1000), so a
  // plain select silently returned only the first 1000 of a 1418-row queue and
  // left the rest on their old priorities (hit for real 2026-07-24).
  const pr = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('wk_dialer_queue').select('id, contact_id')
      .eq('campaign_id', campaignId).eq('status', 'pending').order('id', { ascending: true }).range(from, from + 999);
    if (error) { console.error(`[${batch.label}] read queue:`, error.message); process.exit(1); }
    pr.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const nameById = new Map(contacts.map((c) => [c.id, c.name || '']));
  const missing = pr.map((r) => r.contact_id).filter((id) => !nameById.has(id));
  for (let i = 0; i < missing.length; i += 200) {
    const { data } = await sb.from('wk_contacts').select('id, name').in('id', missing.slice(i, i + 200));
    for (const r of data ?? []) nameById.set(r.id, r.name || '');
  }
  const ordered = pr.slice().sort((a, b) =>
    (nameById.get(a.contact_id) || '').toLowerCase().localeCompare((nameById.get(b.contact_id) || '').toLowerCase()));
  // higher priority = dialed first, so the top of the alphabet gets the highest
  const PAR = 25;
  for (let i = 0; i < ordered.length; i += PAR) {
    await Promise.all(ordered.slice(i, i + PAR).map((r, j) =>
      sb.from('wk_dialer_queue').update({ priority: ordered.length - (i + j) }).eq('id', r.id)));
  }

  console.log(`[${batch.label}] campaign ${campaignId}: ${inserted} new contacts, ${queued} queued, whole pending queue ordered A→Z (${ordered.length}).`);
  return { campaignId, inserted, queued, pending: ordered.length };
}

for (let b = 0; b < BATCHES.length; b++) {
  if (!ORDER_ONLY && dealt[b].length === 0) { console.log(`[${BATCHES[b].label}] no leads — skip`); continue; }
  await processBatch(BATCHES[b], dealt[b]);
}
console.log('\nDONE.');
