#!/usr/bin/env node
/**
 * Didsbury 9x12-style community postcard test: import 160 local businesses onto
 * Maria's account under their OWN campaign, then cold-text them THROUGH THE CRM.
 *
 * Hugo, 2026-07-29. Copy approved by him verbatim, including "cost split 7 ways"
 * (flagged twice as describing his cost structure rather than the product, and
 * chosen anyway with that trade-off in front of him) and the no-apostrophe
 * spellings "Im" / "Youd" (a STRAIGHT apostrophe is free in GSM-7, it is the
 * CURLY one that triples the bill, but the copy simply avoids both).
 *
 * WHY THIS GOES THROUGH wk-sms-send AND NOT THE TWILIO API DIRECTLY:
 * a raw Twilio call delivers the text but writes NO wk_sms_messages row, so the
 * lead's reply arrives as an orphan with no thread, the inbox shows nothing, and
 * the one-agent-per-lead lock never sets (leaving Pedro/Marr free to text the
 * same person tomorrow). Every bulk send uses the CRM path. See
 * docs/SMS_BLAST_PLAYBOOK.md rule 1.
 *
 * THE TEST THIS IS RUNNING. The list is 8 trades x 20 leads. The copy is held
 * IDENTICAL across all 160 on purpose: with ~15 expected replies, splitting them
 * across copy variants measures noise. The 8 trades are the 8 arms, and "which
 * trade bites" is the only read this sample size can actually support.
 *
 * REPLIES ARE NOT ANSWERED BY THIS RUN. The campaign is created fresh with no
 * wk_campaign_ai_settings row, and auto-reply requires BOTH the workspace AND the
 * campaign to be set to auto, so a brand-new campaign resolves to the safe side
 * and drafts only. That matters: the previous blast inherited the global reviews
 * pitch and drafted a Google-reviews reply to six leads who had been texted about
 * a website. Inbound STOP is still honoured (wk-sms-incoming tags do-not-text).
 *
 * PREFLIGHT refuses to send anything unless ALL rows pass:
 *   - a known trade with a display word (never a raw CSV keyword, never a blank)
 *   - GSM-7 only and exactly 1 segment, computed per message
 *   - a well-formed GB mobile
 *   - not already owned by another agent (the lead lock)
 * Copy/lock problems ABORT the batch. All-or-nothing beats a half-sent batch you
 * cannot un-send.
 *
 * Then, LAST because it is the only paid check, a live mobile-network screen
 * (Twilio Lookup line_status, about half a penny a number, cached 7 days).
 * "inactive" numbers are DROPPED FROM THE BATCH rather than aborting it: a dead
 * subscription is not a fixable mistake and refusing to text 159 good leads over
 * one of them is the wrong trade. "unreachable" is KEPT (real subscriber, handset
 * off right now, the network queues the SMS).
 *
 * NOTHING IS IMPORTED OR SENT WITHOUT --apply. BUT THE DRY RUN IS NOT FREE.
 * Without --apply nothing is texted and no CRM row is written, but the paid
 * network screen DOES run (~85p for 160). That is deliberate: the dry run's
 * headline count is then the REAL number of people who will be texted, and the
 * result is cached 7 days so the --apply run re-bills nothing.
 * For a genuinely zero-spend dry run: SKIP_LINE_STATUS=1 (that keeps every
 * number UNSCREENED, so it is for checking copy, not for deciding a send).
 *
 * Usage:
 *   node scripts/blast-didsbury-postcard.mjs            # dry run
 *   node scripts/blast-didsbury-postcard.mjs --apply    # import + send for real
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { screenLineStatus } from './lib/line-status.mjs';
import { isTextableUkMobile } from './lib/verify-phone.mjs';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
for (const line of readFileSync(resolve(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const MARIA_EMAIL = 'plumberstexttest@heyelsie.com';
const MARIA_PASSWORD = process.env.MARIA_PASSWORD || 'MariaPlumbers#2026';
const MARIA_ID = '2b382f7f-defe-4c7d-b25a-470625a038bb';
const FROM_E164 = '+447460035763';
const NUMBER_ID = 'c8a0346b-b197-4fd1-8ed6-19847f938c82';
const CAMPAIGN_NAME = 'Leaflets - Didsbury';
const CSV = process.argv.find((a) => a.endsWith('.csv'))
  || join(homedir(), 'Desktop', 'Didsbury_SMS_Test_160_2026-07-29.csv');
const APPLY = process.argv.includes('--apply');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY');
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- GSM-7 segment maths (mirrors api/lib/sms-charset.ts) -------------------
const GSM = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const EXT = new Set('^{}\\[~]|€');
function segments(msg) {
  for (const c of msg) if (!GSM.has(c) && !EXT.has(c)) return { enc: 'UCS-2', segs: msg.length <= 70 ? 1 : Math.ceil(msg.length / 67) };
  let n = 0;
  for (const c of msg) n += EXT.has(c) ? 2 : 1;
  return { enc: 'GSM-7', segs: n <= 160 ? 1 : Math.ceil(n / 153) };
}

// The CSV keyword -> the word that goes in the text. Not cosmetic: "personal
// trainer" is 16 characters and the longest trade in the list, and "PT" is both
// shorter and what UK trainers actually call themselves.
const TRADE_WORD = {
  plumber: 'plumber',
  electrician: 'electrician',
  hairdresser: 'hairdresser',
  cafe: 'cafe',
  gardener: 'gardener',
  cleaner: 'cleaner',
  locksmith: 'locksmith',
  'personal trainer': 'PT',
};

// Hugo's approved copy, verbatim. One text per lead across every trade above.
const bodyFor = (trade) =>
  `Hiya, Im getting 7 Didsbury businesses on one community postcard to 5,000 `
  + `local doors, cost split 7 ways. Youd be the only ${trade}. Opposed? Maria`;

/** "07921 193353" / "+44 7921 193353" -> "+447921193353" */
function toE164(raw) {
  let d = String(raw ?? '').replace(/[^\d+]/g, '');
  if (d.startsWith('+44')) return d;
  if (d.startsWith('44')) return `+${d}`;
  if (d.startsWith('0')) return `+44${d.slice(1)}`;
  return d ? `+44${d}` : '';
}

// ---- read + preflight -------------------------------------------------------
const rows = Papa.parse(readFileSync(CSV, 'utf8').replace(/^﻿/, ''), {
  header: true, skipEmptyLines: true,
}).data;
console.log(`CSV: ${CSV}\nRows: ${rows.length}`);

const planned = [];
const problems = [];
const seenPhone = new Set();
for (const r of rows) {
  const company = String(r.name ?? '').trim();
  const keyword = String(r.keyword ?? '').trim().toLowerCase();
  const trade = TRADE_WORD[keyword];
  if (!trade) { problems.push(`${company}: unknown trade "${keyword}"`); continue; }

  const phone = toE164(r.phone);
  if (!phone || !isTextableUkMobile(phone)) { problems.push(`${company}: not a textable UK mobile (${r.phone})`); continue; }
  if (seenPhone.has(phone)) { problems.push(`${company}: duplicate number in CSV (${phone})`); continue; }
  seenPhone.add(phone);

  const body = bodyFor(trade);
  const { enc, segs } = segments(body);
  if (enc !== 'GSM-7' || segs !== 1) { problems.push(`${company}: ${enc} ${segs} segments`); continue; }

  planned.push({
    company, keyword, trade, phone, body,
    custom_fields: {
      trade: keyword,
      area: String(r.location ?? '').trim(),
      rating: String(r.rating ?? '').trim(),
      reviews: String(r.reviews_count ?? '').trim(),
      website: String(r.website ?? '').trim(),
      google_maps_url: String(r.maps_url ?? '').trim(),
      source: 'didsbury-postcard-test-2026-07-29',
    },
  });
}

console.log(`Sendable: ${planned.length} · problems: ${problems.length}`);
for (const p of problems.slice(0, 20)) console.log(`  SKIP ${p}`);
if (problems.length) {
  console.error(`\nRefusing to run: ${problems.length} row(s) failed preflight. Fix or exclude them explicitly.`);
  process.exit(1);
}
if (!planned.length) { console.error('\nNothing sendable. Stopping.'); process.exit(1); }

// ---- lead lock: is anyone already owned by another agent? -------------------
// Cheap, free, and it runs before the paid screen. A collision is a copy/ownership
// problem (someone else is mid-conversation with this lead), so it aborts.
const existing = new Map();
for (let i = 0; i < planned.length; i += 100) {
  const chunk = planned.slice(i, i + 100).map((p) => p.phone);
  const { data, error } = await sb
    .from('wk_contacts')
    .select('id, phone, name, owner_agent_id')
    .in('phone', chunk);
  if (error) { console.error('lead-lock check failed:', error.message); process.exit(1); }
  for (const row of data ?? []) existing.set(row.phone, row);
}
const isLocked = (p) => {
  const e = existing.get(p.phone);
  return Boolean(e && e.owner_agent_id && e.owner_agent_id !== MARIA_ID);
};
const locked = planned.filter(isLocked);
console.log(`Already in CRM: ${existing.size} · owned by another agent: ${locked.length}`);
if (locked.length) {
  // EXCLUDED, NOT FATAL. Same trade-off the network screen makes below: a copy
  // problem aborts the batch because it is fixable and a half-sent batch with a
  // broken greeting is worse than none, but a lead another agent already owns is
  // not our mistake to fix, and refusing to text the other 155 over it is wrong.
  // Leaving them to their existing agent is the whole point of the lock: Maria
  // must not open a second conversation with someone Pedro or Marr is mid-thread
  // with. See docs/AGENT_ISOLATION_AND_LEAD_LOCK.md.
  console.log('\nLOCKED to another agent, excluded from this send:');
  for (const s of locked) console.log(`  ${s.company.padEnd(48)} ${s.phone}  (${s.keyword})`);
}
{
  const free = planned.filter((p) => !isLocked(p));
  planned.length = 0;
  planned.push(...free);
}
if (!planned.length) { console.error('\nEvery lead is locked to another agent. Nothing to send.'); process.exit(1); }

// ---- LAST PREFLIGHT: is the line alive on the mobile network? ---------------
// Paid, so it runs after every free gate. Runs in the dry run too, on purpose,
// so the dry run's count is the true count and the --apply pass re-bills nothing
// (7-day cache). A dead number is EXCLUDED, it does not abort the batch.
if (!APPLY) {
  console.log('\nDry run. Nothing imported, nothing texted. The paid network screen still runs so');
  console.log('this dry run reports the real sendable count (cached 7 days, so --apply adds nothing).');
  console.log('SKIP_LINE_STATUS=1 to skip it and spend nothing.');
}
const lineScreen = await screenLineStatus(planned.map((p) => p.phone), { label: 'preflight' });
const dead = planned.filter((p) => lineScreen.dead.has(p.phone));
if (dead.length) {
  console.log(`\nDEAD LINE, not texted (${dead.length}). Inactive on the network:`);
  for (const d of dead) console.log(`  ${d.company.padEnd(38)} ${d.phone}  (${d.keyword})`);
}
const sendable = planned.filter((p) => !lineScreen.dead.has(p.phone));
if (!sendable.length) { console.error('\nEvery lead is dead on the network. Nothing to send.'); process.exit(1); }

// ---- what this run will do --------------------------------------------------
const byTrade = {};
for (const p of sendable) byTrade[p.keyword] = (byTrade[p.keyword] ?? 0) + 1;
console.log('\nPer trade (the 8 arms of the test):');
for (const [k, v] of Object.entries(byTrade).sort()) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`\nEvery message: GSM-7, 1 segment. Est. cost ${sendable.length} x GBP 0.0423 = GBP ${(sendable.length * 0.0423).toFixed(2)}`);
console.log(`Campaign: "${CAMPAIGN_NAME}"   From: ${FROM_E164} (Maria)`);
console.log('\nSample of what lands, one per trade:');
const shown = new Set();
for (const p of sendable) {
  if (shown.has(p.keyword)) continue;
  shown.add(p.keyword);
  console.log(`  [${p.keyword}] ${p.body}`);
}

if (!APPLY) {
  console.log('\nDRY RUN. Nothing imported, nothing sent, nobody contacted.');
  console.log(lineScreen.skipped
    ? 'The network screen was SKIPPED, so this cost nothing and the count above is UNSCREENED.'
    : `The network screen ran and cost about GBP ${lineScreen.costGbp.toFixed(2)}, cached 7 days so --apply adds nothing.`);
  console.log('Re-run with --apply to import and send.');
  process.exit(0);
}

// ---- create the campaign ----------------------------------------------------
// Its own campaign, not Maria's plumber one. Two reasons: the inbox can then be
// filtered by campaign (the tag Hugo asked for is wk_dialer_queue.campaign_id),
// and a fresh campaign has no wk_campaign_ai_settings row, so replies cannot
// inherit another campaign's prompt.
let campaignId;
{
  const { data: found } = await sb.from('wk_dialer_campaigns').select('id').eq('name', CAMPAIGN_NAME).maybeSingle();
  if (found?.id) {
    campaignId = found.id;
    console.log(`\nCampaign "${CAMPAIGN_NAME}" already exists (${campaignId}), reusing it.`);
  } else {
    const { data, error } = await sb
      .from('wk_dialer_campaigns')
      .insert({ name: CAMPAIGN_NAME, is_active: true, created_by: MARIA_ID })
      .select('id')
      .single();
    if (error) { console.error('create campaign:', error.message); process.exit(1); }
    campaignId = data.id;
    console.log(`\nCreated campaign "${CAMPAIGN_NAME}" (${campaignId}).`);
  }
  const { error: nErr } = await sb
    .from('wk_campaign_numbers')
    .upsert({ campaign_id: campaignId, number_id: NUMBER_ID, priority: 0 }, { onConflict: 'campaign_id,number_id' });
  if (nErr) console.warn(`  (could not link number: ${nErr.message})`);
}

// ---- import the contacts ----------------------------------------------------
let imported = 0;
for (const p of sendable) {
  const prior = existing.get(p.phone);
  if (prior) {
    const { error } = await sb
      .from('wk_contacts')
      .update({ owner_agent_id: MARIA_ID, custom_fields: { ...p.custom_fields } })
      .eq('id', prior.id);
    if (error) { console.error(`update ${p.company}: ${error.message}`); continue; }
    p.contact_id = prior.id;
  } else {
    const { data, error } = await sb
      .from('wk_contacts')
      .insert({ name: p.company, phone: p.phone, owner_agent_id: MARIA_ID, custom_fields: p.custom_fields })
      .select('id')
      .single();
    if (error) { console.error(`insert ${p.company}: ${error.message}`); continue; }
    p.contact_id = data.id;
  }
  imported++;
}
console.log(`Imported/updated ${imported}/${sendable.length} contacts onto Maria.`);

// Queue them on the new campaign, A to Z, so the campaign tag exists on every lead.
const queued = sendable.filter((p) => p.contact_id)
  .sort((a, b) => a.company.localeCompare(b.company))
  .map((p, i, arr) => ({ campaign_id: campaignId, contact_id: p.contact_id, status: 'pending', priority: arr.length - i }));
for (let i = 0; i < queued.length; i += 100) {
  const { error } = await sb.from('wk_dialer_queue')
    .upsert(queued.slice(i, i + 100), { onConflict: 'campaign_id,contact_id' });
  if (error) console.warn(`  queue chunk ${i}: ${error.message}`);
}
console.log(`Queued ${queued.length} leads on "${CAMPAIGN_NAME}".`);

// ---- send as Maria, through the CRM ----------------------------------------
const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: MARIA_EMAIL, password: MARIA_PASSWORD }),
});
const authJson = await authRes.json();
const jwt = authJson.access_token;
if (!jwt) { console.error('Maria login failed:', authJson); process.exit(1); }

const toSend = sendable.filter((p) => p.contact_id);
console.log(`\nSending ${toSend.length} messages as Maria from ${FROM_E164}...\n`);
let sent = 0;
const failed = [];
for (const [i, p] of toSend.entries()) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/wk-sms-send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_id: p.contact_id, body: p.body, from_e164: FROM_E164 }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.ok && j.twilio_sid) {
    sent++;
    console.log(`  ${String(i + 1).padStart(3)}/${toSend.length} ${p.keyword.padEnd(17)} ${p.phone} ${j.status}`);
  } else {
    failed.push(`${p.company} (${p.phone}): ${j.error ?? res.status}`);
    console.log(`  ${String(i + 1).padStart(3)}/${toSend.length} FAILED ${p.company}: ${j.error ?? res.status}`);
  }
  await sleep(600); // gentle on Twilio + leaves the CRM responsive
}

console.log(`\nDONE - sent ${sent}/${toSend.length}.`);
if (failed.length) { console.log('Failures:'); for (const f of failed) console.log(`  ${f}`); }
console.log(`\nCampaign "${CAMPAIGN_NAME}" (${campaignId}). Replies land in Maria's inbox as DRAFTS.`);
console.log('Believe Twilio, not the CRM status column: confirm with GET /Messages.json.');
