#!/usr/bin/env node
/**
 * Send Maria's website opener to her 100 leads, THROUGH THE CRM.
 *
 * Hugo, 2026-07-28. Copy approved by him verbatim, including "dont" with no
 * apostrophe (his wording; a straight apostrophe is free in GSM-7 anyway, it
 * is the CURLY one that triples the cost) and "I built you one" (he chose the
 * stronger claim knowing nothing is built yet, and accepts building on a yes).
 *
 * WHY THIS GOES THROUGH wk-sms-send AND NOT THE TWILIO API DIRECTLY:
 * a raw Twilio call delivers the text but writes NO wk_sms_messages row, so
 * the lead's reply arrives as an orphan with no thread, the inbox shows
 * nothing, and the one-agent-per-lead lock never sets (leaving Pedro/Marr
 * free to text the same person tomorrow). Every bulk send must use the CRM
 * path. Test sends to Hugo's own phone are the only exception.
 *
 * Preflight refuses to send anything unless ALL 100 pass:
 *   - a real first name to greet (never a raw token, never "there")
 *   - GSM-7 only, 1 segment (a name with a curly char would triple the cost)
 *   - the lead is unlocked (no other agent has touched them)
 *
 * Then, LAST because it is the only paid check, a live mobile-network screen
 * (Twilio Lookup line_status, about half a penny a number, cached 7 days).
 * Numbers that are "inactive" are dropped from the send rather than aborting it.
 *
 * NO TEXT IS SENT WITHOUT --apply. BUT THE DRY RUN IS NOT FREE.
 * Read that twice, it is the one surprising thing in this script. Without
 * --apply nothing is texted, nobody is contacted and no CRM row is written, but
 * the paid network screen DOES run: about half a penny a number, so roughly 50p
 * for 100 leads. That is deliberate, not an oversight:
 *   - the dry run's headline number is then the REAL count of people who will be
 *     texted, not a count that still has dead numbers in it
 *   - the result is cached for 7 days, so the --apply run straight afterwards
 *     re-bills nothing. You pay once either way, you just pay it before you
 *     commit instead of after
 * For a genuinely zero-spend dry run: SKIP_LINE_STATUS=1 (alias
 * NO_LINE_STATUS_SPEND=1). That keeps every number unscreened, dead ones
 * included, so it is for checking the copy, not for deciding a send.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenLineStatus } from './lib/line-status.mjs';

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

/** Same rule as interpolateScript.ts `[owner_first]` — first word only, so
 *  "Jake Donald Okeefe" greets as "Jake", never the full legal name. */
const firstWord = (v) => String(v ?? '').trim().split(/\s+/)[0] || '';

const bodyFor = (first) =>
  `Hey ${first}, this is Pedro. I saw you on Google and noticed you dont have a website. `
  + `I know this is kinda random, but I built you one :). Wanna see it?`;

// ---- gather ----------------------------------------------------------------
const { data: contacts, error } = await sb
  .from('wk_contacts')
  .select('id, name, phone, custom_fields')
  .eq('owner_agent_id', MARIA_ID)
  .order('name', { ascending: true });
if (error) { console.error('fetch contacts:', error.message); process.exit(1); }

const planned = [];
const problems = [];
for (const c of contacts ?? []) {
  const first = firstWord(c.custom_fields?.owner_name);
  if (!first) { problems.push(`${c.name}: no owner_name to greet`); continue; }
  const body = bodyFor(first);
  const { enc, segs } = segments(body);
  if (enc !== 'GSM-7' || segs !== 1) { problems.push(`${c.name}: ${enc} ${segs} segments`); continue; }
  const { data: locked } = await sb.rpc('wk_contact_locked_agent', { p_contact: c.id });
  if (locked && locked !== MARIA_ID) { problems.push(`${c.name}: locked to another agent`); continue; }
  planned.push({ id: c.id, company: c.name, first, phone: c.phone, body });
}

console.log(`Contacts: ${contacts?.length ?? 0} · sendable: ${planned.length} · problems: ${problems.length}`);
for (const p of problems.slice(0, 20)) console.log(`  SKIP ${p}`);
if (problems.length) {
  console.error(`\nRefusing to send: ${problems.length} lead(s) failed preflight. Fix them or exclude them explicitly.`);
  process.exit(1);
}
if (!planned.length) { console.error('\nNo sendable leads. Nothing to do.'); process.exit(1); }

// ---- LAST PREFLIGHT: is the line alive on the mobile network? ---------------
// This is the generic send path, so it gets the screen too, not just the import
// scripts. Leads can be imported weeks before they are texted and a subscription
// can die in between. Runs last because it is the only preflight that costs
// money (about half a penny a number, and cached for 7 days so a re-run of this
// script is free).
//
// A dead number is EXCLUDED from the send, it does NOT abort the run. The
// preflight above aborts on problems because those are fixable copy problems and
// sending half a list with a broken greeting is worse than sending none. A dead
// subscription is not fixable and not our mistake, so refusing to text the other
// 99 good leads over it would be the wrong trade.
//
// Only "inactive" is excluded. "unreachable" is a real subscriber whose handset
// is switched off right now, the network holds the SMS and delivers it when the
// phone comes back, so those are texted as normal.
//
// IT RUNS WITHOUT --apply TOO. Money before the exit, on purpose: it makes the
// dry run's count the true count, and the 7-day cache means the --apply run that
// follows re-bills nothing. Announced here as well as in the header, because
// nobody reads a header.
if (!APPLY) {
  console.log('\nDry run. Nothing will be texted. The paid network screen still runs so this');
  console.log('dry run reports the real sendable count (cached 7 days, so --apply adds nothing).');
  console.log('SKIP_LINE_STATUS=1 to skip it and spend nothing.');
}
const lineScreen = await screenLineStatus(planned.map((p) => p.phone), { label: 'preflight' });
const dead = planned.filter((p) => lineScreen.dead.has(p.phone));
if (dead.length) {
  console.log(`\nDEAD LINE, not texted (${dead.length}). The number is inactive on the network:`);
  for (const d of dead) console.log(`  ${d.company} ${d.phone}`);
}
const sendable = planned.filter((p) => !lineScreen.dead.has(p.phone));
if (!sendable.length) { console.error('\nEvery lead is dead on the network. Nothing to send.'); process.exit(1); }
planned.length = 0;
planned.push(...sendable);

console.log(`\nEvery message: GSM-7, 1 segment. Est. cost ${planned.length} x £0.0423 = £${(planned.length * 0.0423).toFixed(2)}`);
console.log(`Sample: ${planned[0].body}`);

if (!APPLY) {
  console.log('\nDRY RUN. Nothing sent, nobody contacted, no CRM row written.');
  console.log(lineScreen.skipped
    ? 'The network screen was skipped, so this run cost nothing and the count above is UNSCREENED.'
    : `The network screen did run and cost about GBP ${lineScreen.costGbp.toFixed(2)}. `
      + 'It is cached for 7 days, so --apply now adds nothing to that.');
  console.log('Re-run with --apply to send.');
  process.exit(0);
}

// ---- send as Maria, through the CRM ----------------------------------------
const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: MARIA_EMAIL, password: MARIA_PASSWORD }),
});
const authJson = await authRes.json();
const jwt = authJson.access_token;
if (!jwt) { console.error('Maria login failed:', authJson); process.exit(1); }

let sent = 0;
const failed = [];
for (const [i, p] of planned.entries()) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/wk-sms-send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_id: p.id, body: p.body, from_e164: FROM_E164 }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.ok && j.twilio_sid) {
    sent++;
    console.log(`  ${String(i + 1).padStart(3)}/${planned.length} ${p.first.padEnd(12)} ${p.phone} ${j.status}`);
  } else {
    failed.push(`${p.company} (${p.phone}): ${j.error ?? res.status}`);
    console.log(`  ${String(i + 1).padStart(3)}/${planned.length} FAILED ${p.company}: ${j.error ?? res.status}`);
  }
  await sleep(600); // gentle on Twilio + leaves the CRM responsive
}

console.log(`\nDONE — sent ${sent}/${planned.length}.`);
if (failed.length) { console.log('Failures:'); for (const f of failed) console.log(`  ${f}`); }
