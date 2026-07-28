#!/usr/bin/env node
/**
 * Import UK plumber leads into the CRM, owned by one agent and QUEUED ready to
 * dial. Built for the UK_Plumbers_Leads_*.csv export (Company Name, Owner Name,
 * Mobile, Star Rating, Number of Reviews, Rank Position, Plumbers Ahead, Total
 * Plumbers in Town, Competitor 1/2, Town/City, Website, Registered Address,
 * Google Search URL, Google Maps Link).
 *
 * Each lead's rich data lands in wk_contacts.custom_fields under the SAME keys
 * the sales script reads back per lead (see interpolateScript.ts) — owner_name,
 * reviews, rating, rank, town, competitor_1/2, plumbers_ahead, total_plumbers,
 * website, google_search_url. So the dialer auto-fills the script for whoever
 * dials the lead.
 *
 * Secrets come ONLY from env (no hardcoded keys):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/import-plumber-leads.mjs [csvPath] [count] [agentId]
 *
 * Defaults: csvPath=~/Desktop/UK_Plumbers_Leads_2026-07-21.csv, count=100,
 *           agentId=28dee5a4-... (hugo@lemlin.com).
 *
 * Idempotent-ish: reuses the "Plumbers - test" campaign if it exists, upserts
 * contacts by phone (ignoreDuplicates — never clobbers existing rows), and only
 * queues leads not already pending in the campaign.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import { isTextableUkMobile } from './lib/verify-phone.mjs';
import { dropDeadNumbers, warnIfShort } from './lib/line-status.mjs';

// ── SUPERSEDED ───────────────────────────────────────────────────────────────
// Use scripts/process-plumber-leads.mjs — it enforces ALL of Hugo's rules in one
// idempotent run (named-owner only → Google-enrich reviews → drop >65 → import +
// queue → order A→Z). This script only does the import step; running it alone
// risks a batch with fake review counts and high-review leads. It refuses unless
// you deliberately opt in. See docs/PLUMBER_LEADS_PIPELINE.md.
if (process.env.FORCE_LEGACY !== '1') {
  console.error('SUPERSEDED — run: node scripts/process-plumber-leads.mjs');
  console.error('(enforces named-owner + Google-enrich + ≤65 reviews + queue + A→Z order)');
  console.error('Override for a one-off with FORCE_LEGACY=1.');
  process.exit(1);
}

// ---- config ----------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}

const CSV_PATH = process.argv[2] || join(homedir(), 'Desktop', 'UK_Plumbers_Leads_2026-07-21.csv');
const COUNT = Number(process.argv[3] || 100);
const AGENT_ID = process.argv[4] || '28dee5a4-e8be-4019-a6ad-e1dcf07b875c'; // hugo@lemlin.com

const CAMPAIGN_NAME = 'Plumbers - test';
const PIPELINE_ID = 'c2022b21-7a79-4203-90dd-5b06b46eef11';           // Default workspace pipeline
const CALLER_ID_NUMBER_ID = 'c8a0346b-b197-4fd1-8ed6-19847f938c82';   // +447460035763 (UK line 2)

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---- helpers ---------------------------------------------------------------
/** Normalise a UK phone string to E.164 (mirrors wk-sms-send). "07902 663017" → "+447902663017". */
function normalizeE164(raw) {
  const s = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) return s;
  if (s.startsWith('0')) return '+44' + s.slice(1);
  if (s.startsWith('44')) return '+' + s;
  if (s.length >= 9 && s.length <= 11) return '+44' + s; // bare UK national without leading 0
  return null;
}

const clean = (v) => String(v ?? '').trim();

// CSV header (lowercased/trimmed) → custom_fields key
const CF_MAP = {
  'owner name 1 (man)': 'owner_name',
  'star rating': 'rating',
  'number of reviews': 'reviews',
  'rank position': 'rank',
  'plumbers ahead': 'plumbers_ahead',
  'total plumbers in town': 'total_plumbers',
  'competitor 1': 'competitor_1',
  'competitor 2': 'competitor_2',
  'town/city': 'town',
  'website': 'website',
  'google search url': 'google_search_url',
  'google maps link': 'google_maps_url',
  'registered address': 'registered_address',
};

function pick(row, header) {
  // headers may carry a BOM on the first column; match case-insensitively
  for (const k of Object.keys(row)) {
    if (k.replace(/^﻿/, '').toLowerCase().trim() === header) return row[k];
  }
  return undefined;
}

// ---- parse -----------------------------------------------------------------
const raw = readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
if (parsed.errors?.length) {
  console.warn(`Parse warnings: ${parsed.errors.slice(0, 3).map((e) => e.message).join('; ')}`);
}

const seen = new Set();
const leads = [];
let notMobile = 0;
for (const row of parsed.data) {
  if (leads.length >= COUNT) break;
  const owner = clean(pick(row, 'owner name 1 (man)'));
  if (!owner) continue;                         // named-owner rows only
  const phone = normalizeE164(pick(row, 'mobile'));
  if (!phone || seen.has(phone)) continue;
  if (!isTextableUkMobile(phone)) { notMobile++; continue; } // landline/VoIP/toll-free can't be texted
  seen.add(phone);

  const name = clean(pick(row, 'company name')) || phone;
  const customFields = {};
  for (const [header, key] of Object.entries(CF_MAP)) {
    const val = clean(pick(row, header));
    if (val) customFields[key] = val;
  }
  leads.push({ name, phone, customFields });
}

console.log(`Parsed ${leads.length} named-owner leads (target ${COUNT}) from ${CSV_PATH} (not a mobile number: ${notMobile})`);
if (leads.length === 0) { console.error('No leads to import — aborting.'); process.exit(1); }

// ---- LAST GATE: live mobile-network screen (the only paid check) ------------
// After the free offline checks above, never before them. isTextableUkMobile is
// libphonenumber, an OFFLINE rulebook: it proves the number is a well-formed
// allocated GB mobile, never that the subscription is still alive. Five of
// Maria's first 100 numbers were dead and every one of them passed it. Only
// "inactive" is dropped; "unreachable" is a real subscriber with the handset
// switched off right now and is always kept. SKIP_LINE_STATUS=1 skips this check
// and spends nothing (the import still runs, so it is not a dry run).
{
  const screened = await dropDeadNumbers(leads, (l) => l.phone, { label: 'legacy import' });
  const removedDead = leads.length - screened.kept.length;
  leads.length = 0;
  leads.push(...screened.kept);
  if (removedDead) console.log(`Removed ${removedDead} number(s) that are dead on the network.`);
  if (leads.length === 0) { console.error('No leads left after the line-status screen. Aborting.'); process.exit(1); }
  // The parse loop stopped at COUNT and this screen then removed dead numbers
  // from that finished list, so the delivered count is normally under the ask.
  warnIfShort(COUNT, leads.length, { label: 'legacy import', what: 'leads' });
}

// Write a cleaned copy to the Desktop for Hugo.
const cleanCsv = Papa.unparse(
  leads.map((l) => ({
    'Company Name': l.name,
    Owner: l.customFields.owner_name || '',
    Phone: l.phone,
    Reviews: l.customFields.reviews || '',
    Rating: l.customFields.rating || '',
    Rank: l.customFields.rank || '',
    'Plumbers Ahead': l.customFields.plumbers_ahead || '',
    Town: l.customFields.town || '',
    'Competitor 1': l.customFields.competitor_1 || '',
    'Competitor 2': l.customFields.competitor_2 || '',
    Website: l.customFields.website || '',
    'Google Search URL': l.customFields.google_search_url || '',
  })),
);
const cleanPath = join(homedir(), 'Desktop', 'UK_Plumbers_100_test.csv');
writeFileSync(cleanPath, cleanCsv);
console.log(`Wrote cleaned copy → ${cleanPath}`);

// ---- upsert contacts -------------------------------------------------------
const contactRows = leads.map((l) => ({
  name: l.name,
  phone: l.phone,
  owner_agent_id: AGENT_ID,
  pipeline_column_id: null,   // fresh, undispositioned — the dialer queue drives dialing
  custom_fields: l.customFields,
  is_hot: false,
}));

let inserted = 0;
const CHUNK = 50;
for (let i = 0; i < contactRows.length; i += CHUNK) {
  const slice = contactRows.slice(i, i + CHUNK);
  const { data, error } = await sb
    .from('wk_contacts')
    .upsert(slice, { onConflict: 'phone', ignoreDuplicates: true })
    .select('id, phone');
  if (error) { console.error('contact upsert error:', error.message); process.exit(1); }
  inserted += (data ?? []).length;
}
console.log(`Contacts: ${inserted} inserted, ${leads.length - inserted} already existed (skipped).`);

// Re-fetch ALL ids by phone so existing contacts are queued too.
const phones = leads.map((l) => l.phone);
const idByPhone = new Map();
for (let i = 0; i < phones.length; i += 200) {
  const slice = phones.slice(i, i + 200);
  const { data, error } = await sb.from('wk_contacts').select('id, phone').in('phone', slice);
  if (error) { console.error('id lookup error:', error.message); process.exit(1); }
  for (const r of data ?? []) idByPhone.set(r.phone, r.id);
}
const contactIds = phones.map((p) => idByPhone.get(p)).filter(Boolean);
console.log(`Resolved ${contactIds.length} contact ids.`);

// ---- campaign (reuse or create) --------------------------------------------
let campaignId;
{
  const { data: existing } = await sb
    .from('wk_dialer_campaigns')
    .select('id')
    .eq('name', CAMPAIGN_NAME)
    .maybeSingle();
  if (existing?.id) {
    campaignId = existing.id;
    console.log(`Reusing campaign "${CAMPAIGN_NAME}" (${campaignId}).`);
  } else {
    const { data, error } = await sb
      .from('wk_dialer_campaigns')
      .insert({
        name: CAMPAIGN_NAME,
        pipeline_id: PIPELINE_ID,
        parallel_lines: 1,
        created_by: AGENT_ID,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) { console.error('campaign create error:', error.message); process.exit(1); }
    campaignId = data.id;
    console.log(`Created campaign "${CAMPAIGN_NAME}" (${campaignId}).`);
  }
}

// Link the agent + caller-ID number (idempotent via unique keys).
{
  const { error: aErr } = await sb
    .from('wk_campaign_agents')
    .upsert({ campaign_id: campaignId, agent_id: AGENT_ID, role: 'agent' }, { onConflict: 'campaign_id,agent_id', ignoreDuplicates: true });
  if (aErr) console.warn('campaign_agents:', aErr.message);

  const { data: numLink } = await sb
    .from('wk_campaign_numbers')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('number_id', CALLER_ID_NUMBER_ID)
    .maybeSingle();
  if (!numLink) {
    const { error: nErr } = await sb
      .from('wk_campaign_numbers')
      .insert({ campaign_id: campaignId, number_id: CALLER_ID_NUMBER_ID, priority: 0 });
    if (nErr) console.warn('campaign_numbers:', nErr.message);
  }
}

// ---- queue (skip those already pending) ------------------------------------
const { data: pendingRows } = await sb
  .from('wk_dialer_queue')
  .select('contact_id')
  .eq('campaign_id', campaignId)
  .eq('status', 'pending')
  .in('contact_id', contactIds);
const alreadyPending = new Set((pendingRows ?? []).map((r) => r.contact_id));

const queueInserts = contactIds
  .filter((id) => !alreadyPending.has(id))
  .map((id) => ({ campaign_id: campaignId, contact_id: id, status: 'pending', priority: 0 }));

let queued = 0;
for (let i = 0; i < queueInserts.length; i += CHUNK) {
  const slice = queueInserts.slice(i, i + CHUNK);
  const { data, error } = await sb.from('wk_dialer_queue').insert(slice).select('id');
  if (error) { console.error('queue insert error:', error.message); process.exit(1); }
  queued += (data ?? []).length;
}

console.log('');
console.log('DONE');
console.log(`  campaign:     ${CAMPAIGN_NAME} (${campaignId})`);
console.log(`  owner agent:  ${AGENT_ID}`);
console.log(`  caller ID:    +447460035763`);
console.log(`  contacts:     ${inserted} new, ${contactIds.length} total resolved`);
console.log(`  queued:       ${queued} new pending (${alreadyPending.size} already pending)`);
