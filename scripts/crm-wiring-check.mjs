#!/usr/bin/env node
/**
 * CRM growth-engine wiring check (TDD).
 * Plain node, no deps. Secrets come ONLY from env vars:
 *   DB_URL, PGPASSWORD  — psql connection (pooler)
 *   CRM_JOBS_KEY        — bearer key for wk-jobs-worker / dialer / prod crm routes
 *   TWILIO_SID, TWILIO_TOKEN — Twilio REST basic auth (+ signature for check 10)
 *   RETELL_KEY          — Retell API bearer
 *
 * Usage:
 *   DB_URL=... PGPASSWORD=... CRM_JOBS_KEY=... TWILIO_SID=... TWILIO_TOKEN=... RETELL_KEY=... \
 *     node scripts/crm-wiring-check.mjs
 *
 * Prints "PASS <name>" / "FAIL <name> — <evidence>" per check, exits 1 if any FAIL.
 */

import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const EDGE = 'https://loggyxryrhqsbtqpteog.supabase.co/functions/v1';
const APP = 'https://app.heyelsie.com';
const TRUNK = 'TK6634fb175ebebc312bb6683327cb0ee6';
const AGENT = 'agent_6ee23884400896ee15e314ca91';
const LLM = 'llm_e92e1877cc642b8e40e0380c1638';
const US_MAIN = '+18333706994';
const US_SECOND = '+18774194389';
const UK_NUMBERS = ['+447426495169', '+447576558278'];
const DEAD_CONTACT = '00000000-0000-4000-8000-00000000dead';

const need = ['DB_URL', 'PGPASSWORD', 'CRM_JOBS_KEY', 'TWILIO_SID', 'TWILIO_TOKEN', 'RETELL_KEY'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`);
  process.exit(2);
}
const { DB_URL, CRM_JOBS_KEY, TWILIO_SID, TWILIO_TOKEN, RETELL_KEY } = process.env;

const results = [];
function record(name, ok, evidence = '') {
  results.push({ name, ok, evidence });
  console.log(ok ? `PASS ${name}` : `FAIL ${name} — ${evidence}`);
}

function psql(sql) {
  const r = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    env: process.env,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (r.status !== 0) throw new Error(`psql failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout.trim();
}

async function http(url, opts = {}) {
  const res = await fetch(url, { redirect: 'manual', ...opts });
  const body = await res.text();
  return { status: res.status, body };
}

const snip = (s, n = 160) => String(s).replace(/\s+/g, ' ').slice(0, n);

async function main() {
  // ---------- DB (psql) ----------
  try {
    const out = psql(
      `select count(*) from information_schema.tables where table_schema='public' and table_name like 'wk\\_%'`
    );
    const has = psql(
      `select count(*) from information_schema.tables where table_schema='public' and table_name='wk_broadcasts'`
    );
    const n = Number(out);
    record('01 db: wk_* table count >= 44 incl. wk_broadcasts', n >= 44 && has === '1',
      `count=${n}, wk_broadcasts=${has === '1' ? 'present' : 'MISSING'}`);
  } catch (e) { record('01 db: wk_* table count >= 44 incl. wk_broadcasts', false, e.message); }

  try {
    const out = psql(`select enabled, mode from wk_ai_reply_settings limit 1`);
    record('02 db: wk_ai_reply_settings enabled=true mode=draft', out === 't|draft', `got "${out}"`);
  } catch (e) { record('02 db: wk_ai_reply_settings enabled=true mode=draft', false, e.message); }

  try {
    const out = psql(`select e164, sms_enabled, voice_enabled from wk_numbers order by e164`);
    const rows = Object.fromEntries(out.split('\n').filter(Boolean).map((l) => {
      const [e164, sms, voice] = l.split('|');
      return [e164, { sms, voice }];
    }));
    const okUS1 = rows[US_MAIN]?.sms === 't' && rows[US_MAIN]?.voice === 't';
    const okUS2 = rows[US_SECOND]?.sms === 't' && rows[US_SECOND]?.voice === 't';
    const okUK = UK_NUMBERS.every((n) => rows[n]?.sms === 'f' && rows[n]?.voice === 'f');
    record('03 db: wk_numbers flags (US on, UK off)', okUS1 && okUS2 && okUK, `rows: ${out.replace(/\n/g, '; ')}`);
  } catch (e) { record('03 db: wk_numbers flags (US on, UK off)', false, e.message); }

  try {
    const out = psql(`select count(*) from cron.job where jobname like 'wk-%'`);
    record('04 db: pg_cron has 4 wk-* jobs', out === '4', `count=${out}`);
  } catch (e) { record('04 db: pg_cron has 4 wk-* jobs', false, e.message); }

  try {
    const out = psql(
      `select count(*) from information_schema.columns where table_schema='public' and (` +
      `(table_name='wk_sms_messages' and column_name in ('broadcast_id','ai_generated')) or ` +
      `(table_name='wk_contacts' and column_name in ('ai_enabled','ai_reply_count')))`
    );
    record('05 db: new columns on wk_sms_messages + wk_contacts', out === '4', `found ${out}/4 columns`);
  } catch (e) { record('05 db: new columns on wk_sms_messages + wk_contacts', false, e.message); }

  try {
    const out = psql(`select count(*) from wk_pipeline_columns where name='Booked'`);
    record('06 db: wk_pipeline_columns has Booked', Number(out) >= 1, `count=${out}`);
  } catch (e) { record('06 db: wk_pipeline_columns has Booked', false, e.message); }

  try {
    const out = psql(`select count(*) from wk_twilio_account where id='default'`);
    record('07 db: wk_twilio_account id=default exists', out === '1', `count=${out}`);
  } catch (e) { record('07 db: wk_twilio_account id=default exists', false, e.message); }

  // ---------- Edge functions ----------
  try {
    const r = await http(`${EDGE}/wk-voice-token`, { method: 'POST' });
    record('08 edge: wk-voice-token no-auth -> 401', r.status === 401, `status=${r.status} body=${snip(r.body)}`);
  } catch (e) { record('08 edge: wk-voice-token no-auth -> 401', false, e.message); }

  try {
    const r = await http(`${EDGE}/wk-sms-incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: '+15550000001', Body: 'x' }).toString(),
    });
    record('09 edge: wk-sms-incoming unsigned -> 403', r.status === 403, `status=${r.status} body=${snip(r.body)}`);
  } catch (e) { record('09 edge: wk-sms-incoming unsigned -> 403', false, e.message); }

  try {
    const url = `${EDGE}/wk-sms-incoming`;
    const params = {
      From: '+15550000001',
      To: US_MAIN,
      Body: 'wiring-test',
      MessageSid: 'SM_wiring_check',
    };
    // Twilio signature: HMAC-SHA1(url + concat(sorted key+value)), base64
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const sig = createHmac('sha1', TWILIO_TOKEN).update(data).digest('base64');
    const r = await http(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Twilio-Signature': sig,
      },
      body: new URLSearchParams(params).toString(),
    });
    record('10 edge: wk-sms-incoming signed -> 200 <Response/>',
      r.status === 200 && r.body.includes('<Response/>'), `status=${r.status} body=${snip(r.body)}`);
    // cleanup test artifacts regardless of outcome
    try {
      psql(
        `delete from wk_jobs where payload->>'contact_id' in (select id::text from wk_contacts where phone='+15550000001');` +
        `delete from wk_sms_messages where twilio_sid='SM_wiring_check';` +
        `delete from wk_contacts where phone='+15550000001';`
      );
    } catch (e) { console.log(`   (cleanup warning: ${e.message})`); }
  } catch (e) { record('10 edge: wk-sms-incoming signed -> 200 <Response/>', false, e.message); }

  for (const fn of ['wk-sms-broadcast', 'wk-draft-action', 'wk-schedule-send']) {
    const idx = { 'wk-sms-broadcast': 11, 'wk-draft-action': 12, 'wk-schedule-send': 13 }[fn];
    const name = `${idx} edge: ${fn} no-auth -> 401`;
    try {
      const r = await http(`${EDGE}/${fn}`, { method: 'POST' });
      record(name, r.status === 401, `status=${r.status} body=${snip(r.body)}`);
    } catch (e) { record(name, false, e.message); }
  }

  try {
    const r = await http(`${EDGE}/wk-jobs-worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRM_JOBS_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: 1 }),
    });
    let hasProcessed = false;
    try { hasProcessed = 'processed' in JSON.parse(r.body); } catch { /* not JSON */ }
    record('14 edge: wk-jobs-worker bearer -> 200 with processed',
      r.status === 200 && hasProcessed, `status=${r.status} body=${snip(r.body)}`);
  } catch (e) { record('14 edge: wk-jobs-worker bearer -> 200 with processed', false, e.message); }

  try {
    const r = await http(`${EDGE}/wk-dialer-tick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRM_JOBS_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    record('15 edge: wk-dialer-tick bearer -> 200', r.status === 200, `status=${r.status} body=${snip(r.body)}`);
  } catch (e) { record('15 edge: wk-dialer-tick bearer -> 200', false, e.message); }

  // ---------- Prod routes ----------
  try {
    const r = await http(`${APP}/admin/crm/login`);
    record('16 app: GET /admin/crm/login -> 200', r.status === 200, `status=${r.status}`);
  } catch (e) { record('16 app: GET /admin/crm/login -> 200', false, e.message); }

  try {
    const r = await http(`${APP}/api/crm/ai-reply`, { method: 'POST' });
    record('17 app: POST /api/crm/ai-reply no-auth -> 401', r.status === 401, `status=${r.status} body=${snip(r.body)}`);
  } catch (e) { record('17 app: POST /api/crm/ai-reply no-auth -> 401', false, e.message); }

  try {
    const r = await http(`${APP}/api/crm/ai-reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRM_JOBS_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: DEAD_CONTACT }),
    });
    record('18 app: /api/crm/ai-reply bearer dead-contact -> 200',
      r.status === 200, `status=${r.status} body=${snip(r.body)}`);
  } catch (e) { record('18 app: /api/crm/ai-reply bearer dead-contact -> 200', false, e.message); }

  try {
    const r = await http(`${APP}/api/crm/book`, { method: 'POST' });
    record('19 app: POST /api/crm/book no-auth -> 401', r.status === 401, `status=${r.status} body=${snip(r.body)}`);
  } catch (e) { record('19 app: POST /api/crm/book no-auth -> 401', false, e.message); }

  try {
    const r = await http(`${APP}/api/cron/crm-jobs-pump`);
    record('20 app: GET /api/cron/crm-jobs-pump no-auth -> 401', r.status === 401, `status=${r.status} body=${snip(r.body)}`);
  } catch (e) { record('20 app: GET /api/cron/crm-jobs-pump no-auth -> 401', false, e.message); }

  // ---------- Twilio REST ----------
  const twilioAuth = 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  async function twilioNumber(e164) {
    const r = await http(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(e164)}`,
      { headers: { Authorization: twilioAuth } }
    );
    if (r.status !== 200) throw new Error(`Twilio API ${r.status}: ${snip(r.body)}`);
    const list = JSON.parse(r.body).incoming_phone_numbers || [];
    if (!list.length) throw new Error(`number ${e164} not found on account`);
    return list[0];
  }

  try {
    const n = await twilioNumber(US_MAIN);
    record(`21 twilio: ${US_MAIN} trunk + sms webhook`,
      n.trunk_sid === TRUNK && String(n.sms_url || '').includes('wk-sms-incoming'),
      `trunk_sid=${n.trunk_sid} sms_url=${n.sms_url}`);
  } catch (e) { record(`21 twilio: ${US_MAIN} trunk + sms webhook`, false, e.message); }

  try {
    const n = await twilioNumber(US_SECOND);
    record(`22 twilio: ${US_SECOND} voice + sms webhooks`,
      String(n.voice_url || '').includes('wk-voice-twiml-incoming') && String(n.sms_url || '').includes('wk-sms-incoming'),
      `voice_url=${n.voice_url} sms_url=${n.sms_url}`);
  } catch (e) { record(`22 twilio: ${US_SECOND} voice + sms webhooks`, false, e.message); }

  try {
    const evid = [];
    let ok = true;
    for (const e164 of UK_NUMBERS) {
      const n = await twilioNumber(e164);
      evid.push(`${e164} trunk_sid=${n.trunk_sid}`);
      if (n.trunk_sid !== TRUNK) ok = false;
    }
    record('23 twilio: UK numbers still on Retell trunk', ok, evid.join('; '));
  } catch (e) { record('23 twilio: UK numbers still on Retell trunk', false, e.message); }

  // ---------- Retell ----------
  const retellHeaders = { Authorization: `Bearer ${RETELL_KEY}` };

  try {
    const r = await http('https://api.retellai.com/list-phone-numbers', { headers: retellHeaders });
    if (r.status !== 200) throw new Error(`Retell API ${r.status}: ${snip(r.body)}`);
    const entry = (JSON.parse(r.body) || []).find((p) => p.phone_number === US_MAIN);
    const agentIds = entry
      ? [
          entry.inbound_agent_id,
          entry.outbound_agent_id,
          ...(entry.inbound_agents || []).map((a) => a.agent_id),
          ...(entry.outbound_agents || []).map((a) => a.agent_id),
        ].filter(Boolean)
      : [];
    record(`24 retell: ${US_MAIN} mapped to CRM agent`, agentIds.includes(AGENT),
      entry ? `agents=[${agentIds.join(', ')}]` : 'number not in Retell');
  } catch (e) { record(`24 retell: ${US_MAIN} mapped to CRM agent`, false, e.message); }

  try {
    const r = await http(`https://api.retellai.com/get-agent/${AGENT}`, { headers: retellHeaders });
    if (r.status !== 200) throw new Error(`Retell API ${r.status}: ${snip(r.body)}`);
    const agent = JSON.parse(r.body);
    record('25 retell: agent webhook_url -> /api/webhooks/retell',
      agent.webhook_url === `${APP}/api/webhooks/retell`, `webhook_url=${agent.webhook_url}`);
  } catch (e) { record('25 retell: agent webhook_url -> /api/webhooks/retell', false, e.message); }

  try {
    const r = await http(`https://api.retellai.com/get-retell-llm/${LLM}`, { headers: retellHeaders });
    if (r.status !== 200) throw new Error(`Retell API ${r.status}: ${snip(r.body)}`);
    const llm = JSON.parse(r.body);
    const tools = llm.general_tools || [];
    const ok = tools.some((t) => t.url === `${APP}/api/crm/book`);
    record('26 retell: LLM has book tool -> /api/crm/book', ok,
      `tool urls: ${tools.map((t) => t.url).filter(Boolean).join(', ') || '(none)'}`);
  } catch (e) { record('26 retell: LLM has book tool -> /api/crm/book', false, e.message); }

  // ---------- Cron liveness (production Vercel cron must pick the job up) ----------
  let jobId = null;
  try {
    // -tAc on INSERT..RETURNING prints the row then the "INSERT 0 1" tag — take first line
    jobId = psql(
      `insert into wk_jobs (kind, status, scheduled_for, payload) ` +
      `values ('ai_reply', 'pending', now(), '{"contact_id":"${DEAD_CONTACT}"}'::jsonb) returning id`
    ).split('\n')[0].trim();
    if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error(`unexpected insert output: "${jobId}"`);
    console.log(`   (27: inserted wk_jobs ${jobId}, polling up to 150s for production cron...)`);
    let status = 'pending';
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 15000));
      status = psql(`select status from wk_jobs where id='${jobId}'`);
      console.log(`   (27: job status=${status} @ +${Math.round((Date.now() - (deadline - 150000)) / 1000)}s)`);
      if (status === 'done') break;
    }
    record('27 cron: production pump processes wk_jobs within 150s', status === 'done', `final status=${status}`);
  } catch (e) {
    record('27 cron: production pump processes wk_jobs within 150s', false, e.message);
  } finally {
    if (jobId) {
      try { psql(`delete from wk_jobs where id='${jobId}'`); }
      catch (e) { console.log(`   (27 cleanup warning: ${e.message})`); }
    }
  }

  // ---------- Summary ----------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('Failures:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.evidence}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
