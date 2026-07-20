// Elsie market-readiness audit harness.
// Runs LIVE checks against Twilio / Retell / Supabase / Anthropic, sends ONE real
// SMS to Hugo's number, and runs two tool-using conversation simulations against
// the REAL receptionist prompt the product generates. No outreach to anyone else.
//
// Run:  set -a; . ./.env; set +a; export ANTHROPIC_API_KEY=...; npx tsx tests/readiness/audit.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildSystemPrompt } from '../../src/prompts/system-builder.ts';

// ---- config -----------------------------------------------------------------
const HUGO_NUMBER = '+447853992555';         // the ONLY number we're allowed to text/call
const FROM_NUMBER = '+447426495169';         // Elsie's live Twilio/Retell line
const INBOUND_AGENT = 'agent_adb8cb0848bc2d3b3a4551933e';
const ELSIE_MODEL = 'claude-sonnet-4-6';     // product default for a receptionist (sync-prompt.ts)
const CALLER_MODEL = 'claude-haiku-4-5';     // cheap driver for the pretend caller
const JUDGE_MODEL  = 'claude-sonnet-4-6';

// Parse .env ourselves (one line is multi-line/malformed for `source`).
function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}
const ENV = loadEnv();
const req = (k) => { const v = ENV[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });

const results = { checks: [], sms: null, sims: [], startedAt: new Date().toISOString() };
const mark = (name, status, detail) => {
  results.checks.push({ name, status, detail });
  const icon = status === 'pass' ? '✅' : status === 'warn' ? '⚠️ ' : '❌';
  console.log(`${icon} ${name} — ${detail}`);
};

// ---- helpers ----------------------------------------------------------------
const twilioAuth = () => 'Basic ' + Buffer.from(`${req('TWILIO_ACCOUNT_SID')}:${req('TWILIO_AUTH_TOKEN')}`).toString('base64');
async function anthropic(body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': req('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ============================================================================
// SECTION A — live wiring checks (read-only)
// ============================================================================
async function sectionChecks() {
  console.log('\n── A. WIRING CHECKS ──────────────────────────────────────');
  // A1 Twilio account
  try {
    const sid = req('TWILIO_ACCOUNT_SID');
    const acc = await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: twilioAuth() } })).json();
    const bal = await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, { headers: { Authorization: twilioAuth() } })).json();
    mark('Twilio account', acc.status === 'active' ? 'pass' : 'fail', `status=${acc.status}, balance=${bal.balance} ${bal.currency}`);
  } catch (e) { mark('Twilio account', 'fail', e.message); }

  // A2 Twilio number SMS capability
  try {
    const sid = req('TWILIO_ACCOUNT_SID');
    const nums = (await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`, { headers: { Authorization: twilioAuth() } })).json()).incoming_phone_numbers;
    const n = nums.find((x) => x.phone_number === FROM_NUMBER);
    mark('SMS number provisioned', n?.capabilities?.sms ? 'pass' : 'fail', n ? `${FROM_NUMBER} sms=${n.capabilities.sms} voice=${n.capabilities.voice}` : 'number not found');
  } catch (e) { mark('SMS number provisioned', 'fail', e.message); }

  // A3 Retell inbound routing
  try {
    const p = await (await fetch(`https://api.retellai.com/get-phone-number/${encodeURIComponent(FROM_NUMBER)}`, { headers: { Authorization: `Bearer ${req('RETELL_API_KEY')}` } })).json();
    const ag = p.inbound_agents?.[0]?.agent_id;
    mark('Inbound number → agent', ag ? 'pass' : 'fail', ag ? `${FROM_NUMBER} → ${ag}` : 'no inbound agent set');
  } catch (e) { mark('Inbound number → agent', 'fail', e.message); }

  // A4 Retell agent webhook target
  try {
    const a = await (await fetch(`https://api.retellai.com/get-agent/${INBOUND_AGENT}`, { headers: { Authorization: `Bearer ${req('RETELL_API_KEY')}` } })).json();
    const ok = /app\.heyelsie\.com/.test(a.webhook_url || '');
    mark('Call-capture webhook URL', ok ? 'pass' : 'warn', `agent webhook = ${a.webhook_url} (v${a.version})`);
  } catch (e) { mark('Call-capture webhook URL', 'fail', e.message); }

  // A5 Anthropic brain
  try {
    const j = await anthropic({ model: ELSIE_MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] });
    mark('AI brain (Anthropic)', j.content?.[0]?.text?.includes('OK') ? 'pass' : 'warn', `${ELSIE_MODEL} responded`);
  } catch (e) { mark('AI brain (Anthropic)', 'fail', e.message); }

  // A6 Supabase capture proven (recent calls with recordings)
  try {
    const h = { apikey: req('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${req('SUPABASE_SERVICE_ROLE_KEY')}` };
    const rows = await (await fetch(`${req('SUPABASE_URL')}/rest/v1/calls?select=created_at,direction,recording_url&order=created_at.desc&limit=5`, { headers: h })).json();
    const withRec = (rows || []).filter((r) => r.recording_url).length;
    mark('Call capture pipeline', Array.isArray(rows) && rows.length ? 'pass' : 'warn', `${rows?.length || 0} recent calls logged, ${withRec} with recordings (last: ${rows?.[0]?.created_at || 'none'})`);
  } catch (e) { mark('Call capture pipeline', 'fail', e.message); }
}

// ============================================================================
// SECTION B — REAL SMS to Hugo's number
// ============================================================================
async function sectionSms() {
  console.log('\n── B. LIVE SMS SEND (to Hugo only) ───────────────────────');
  try {
    const sid = req('TWILIO_ACCOUNT_SID');
    const stamp = new Date().toISOString().slice(11, 19);
    const body = `Elsie readiness test ${stamp}. This is an automated test text from your AI receptionist line. If you got this, SMS is working — reply TEST to confirm. No action needed.`;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { Authorization: twilioAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: FROM_NUMBER, To: HUGO_NUMBER, Body: body }),
    });
    const msg = await r.json();
    if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(msg).slice(0, 200)}`);
    // poll for delivery
    let status = msg.status, err = msg.error_code;
    for (let i = 0; i < 12 && !['delivered', 'undelivered', 'failed'].includes(status); i++) {
      await sleep(2500);
      const m = await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${msg.sid}.json`, { headers: { Authorization: twilioAuth() } })).json();
      status = m.status; err = m.error_code;
    }
    results.sms = { sid: msg.sid, to: HUGO_NUMBER, status, error_code: err };
    mark('Real SMS to Hugo', ['delivered', 'sent'].includes(status) ? 'pass' : 'warn', `sid=${msg.sid} status=${status}${err ? ' err=' + err : ''}`);
  } catch (e) { results.sms = { error: e.message }; mark('Real SMS to Hugo', 'fail', e.message); }
}

// ============================================================================
// SECTION C — tool-using conversation simulations vs the REAL prompt
// ============================================================================
const CALL_TOOLS = [
  { name: 'send_sms', description: 'Text the caller during the call (e.g. a confirmation).',
    input_schema: { type: 'object', properties: { to_phone: { type: 'string' }, message: { type: 'string' } }, required: ['to_phone', 'message'] } },
  { name: 'check_availability', description: 'Check available appointment slots between two dates (YYYY-MM-DD).',
    input_schema: { type: 'object', properties: { date_from: { type: 'string' }, date_to: { type: 'string' } }, required: ['date_from', 'date_to'] } },
  { name: 'book_appointment', description: 'Book a confirmed slot after the caller agrees a time.',
    input_schema: { type: 'object', properties: { service_name: { type: 'string' }, start_time: { type: 'string' }, caller_name: { type: 'string' }, caller_phone: { type: 'string' }, notes: { type: 'string' } }, required: ['service_name', 'start_time', 'caller_name', 'caller_phone'] } },
  { name: 'end_call', description: 'End the call once everything is wrapped up.',
    input_schema: { type: 'object', properties: {}, required: [] } },
];
// canned tool results so Elsie's tool-calls "succeed" like they would in production
function runTool(name, input) {
  if (name === 'send_sms') return { ok: true, spoken: `Text sent to ${input.to_phone}.` };
  if (name === 'check_availability') return { slots: ['2026-07-02T09:00:00.000Z', '2026-07-02T13:30:00.000Z', '2026-07-03T10:00:00.000Z'] };
  if (name === 'book_appointment') return { ok: true, confirmed: input.start_time };
  if (name === 'end_call') return { ok: true };
  return { ok: true };
}

async function elsieTurn(systemPrompt, history) {
  // history: array of {role, content} in Anthropic format
  let msgs = history.slice();
  let spoken = '';
  const toolLog = [];
  for (let hop = 0; hop < 4; hop++) {
    const j = await anthropic({ model: ELSIE_MODEL, max_tokens: 500, system: systemPrompt, tools: CALL_TOOLS, messages: msgs });
    const textParts = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
    if (textParts) spoken += (spoken ? ' ' : '') + textParts;
    const toolUses = (j.content || []).filter((c) => c.type === 'tool_use');
    msgs.push({ role: 'assistant', content: j.content });
    if (!toolUses.length) break;
    const toolResults = toolUses.map((t) => {
      toolLog.push({ name: t.name, input: t.input });
      return { type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(runTool(t.name, t.input)) };
    });
    msgs.push({ role: 'user', content: toolResults });
    if (toolUses.some((t) => t.name === 'end_call')) break;
  }
  return { spoken: spoken || '(silence)', msgs, toolLog, ended: toolLog.some((t) => t.name === 'end_call') };
}

async function callerTurn(scenario, elsieSaid, callerHistory) {
  const sys = `You are role-playing a CUSTOMER phoning a UK small business. Stay fully in character, speak naturally and briefly like a real phone call (1-2 sentences), never break character, never mention you are an AI or a test. Your scenario:\n${scenario}\nWhen the receptionist has taken your details and told you what happens next, say a natural goodbye and stop.`;
  const msgs = callerHistory.concat([{ role: 'user', content: `The receptionist just said: "${elsieSaid}"\nReply as the customer.` }]);
  const j = await anthropic({ model: CALLER_MODEL, max_tokens: 160, system: sys, messages: msgs });
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
  return text || 'Okay, thanks.';
}

async function runSim(sim) {
  console.log(`\n── C. SIM: ${sim.label} ─────────────────────────────`);
  const systemPrompt = sim.prompt.replace(/\{\{from_number\}\}/g, HUGO_NUMBER);
  const transcript = [];
  let elsieHistory = [{ role: 'user', content: `[Call connected from ${HUGO_NUMBER}. Greet the caller as instructed, then wait.]` }];
  let callerHistory = [];
  // Elsie greets first
  let turn = await elsieTurn(systemPrompt, elsieHistory);
  elsieHistory = turn.msgs;
  transcript.push({ who: 'Elsie', text: turn.spoken, tools: turn.toolLog });
  console.log(`  Elsie: ${turn.spoken}`);

  for (let i = 0; i < 8; i++) {
    const callerText = await callerTurn(sim.scenario, turn.spoken, callerHistory);
    callerHistory.push({ role: 'user', content: `The receptionist said: "${turn.spoken}"` }, { role: 'assistant', content: callerText });
    transcript.push({ who: 'Caller', text: callerText });
    console.log(`  Caller: ${callerText}`);
    elsieHistory.push({ role: 'user', content: callerText });
    turn = await elsieTurn(systemPrompt, elsieHistory);
    elsieHistory = turn.msgs;
    transcript.push({ who: 'Elsie', text: turn.spoken, tools: turn.toolLog });
    console.log(`  Elsie: ${turn.spoken}${turn.toolLog.length ? '   [tools: ' + turn.toolLog.map((t) => t.name).join(', ') + ']' : ''}`);
    if (turn.ended || /\b(bye|goodbye|take care|speak soon)\b/i.test(callerText)) break;
  }

  // Judge
  const flat = transcript.map((t) => `${t.who}: ${t.text}${t.tools?.length ? ' [used: ' + t.tools.map((x) => x.name).join(',') + ']' : ''}`).join('\n');
  const judgePrompt = `You are auditing an AI phone receptionist for a UK ${sim.kind}. Read the transcript and score STRICTLY. Return JSON only:
{"captured_name":bool,"captured_number":bool,"captured_job_or_reason":bool,"captured_address_or_relevant_detail":bool,"confirmed_next_step":bool,"sounded_human":bool,"no_hallucinated_prices":bool,"appropriate_urgency":bool,"overall_pass":bool,"notes":"1-2 sentence verdict"}
Scenario expectation: ${sim.expectation}
Transcript:\n${flat}`;
  const jr = await anthropic({ model: JUDGE_MODEL, max_tokens: 400, messages: [{ role: 'user', content: judgePrompt }] });
  const jtext = (jr.content?.[0]?.text) || '{}';
  let verdict = {};
  try { verdict = JSON.parse(jtext.match(/\{[\s\S]*\}/)[0]); } catch { verdict = { parse_error: jtext.slice(0, 200) }; }
  console.log(`  JUDGE: ${JSON.stringify(verdict)}`);
  const rec = { label: sim.label, kind: sim.kind, transcript, verdict };
  results.sims.push(rec);
  mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`./out/${sim.key}.json`, import.meta.url), JSON.stringify(rec, null, 2));
  mark(`Sim: ${sim.label}`, verdict.overall_pass ? 'pass' : 'warn', verdict.notes || 'see transcript');
}

// ---- build the two REAL receptionist prompts --------------------------------
function plumberPrompt() {
  return buildSystemPrompt(
    { name: 'Rapid Response Plumbing', industry: 'Emergency & general plumber', address: 'Manchester M1', phone: FROM_NUMBER, greeting: "Thanks for calling Rapid Response Plumbing, you're through to Elsie. How can I help?" },
    [{ name: 'Emergency call-out', description: 'Burst pipes, leaks, no hot water', bookable: false }, { name: 'Boiler service', bookable: false }],
    [{ question: 'What areas do you cover?', answer: 'All of Greater Manchester.' }, { question: 'Are you available out of hours?', answer: 'Yes, we run a 24/7 emergency line.' }],
    [{ name: 'Job details', enabled: true, fields: [
      { name: 'caller name', type: 'text', required: true }, { name: 'contact number', type: 'text', required: true },
      { name: 'what the problem is', type: 'text', required: true }, { name: 'property address', type: 'text', required: true }] }],
    'VOICE', undefined, 'Europe/London', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], false,
  ) + `\n\n## Things you can do during the call\n- **send_sms** — text the caller. Default to their own number (${HUGO_NUMBER}).\nFor a genuine emergency, reassure the caller, take their details, and confirm a plumber will call them straight back. Offer to text them a confirmation.`;
}
function salonPrompt() {
  return buildSystemPrompt(
    { name: 'Glow Beauty Salon', industry: 'Beauty salon', address: 'Manchester M2', phone: FROM_NUMBER, greeting: "Hello, welcome to Glow Beauty Salon, this is Elsie. How can I help?" },
    [{ name: 'Gel manicure', price_from: 30, price_to: 40, bookable: true }, { name: 'Facial', price_from: 45, bookable: true }],
    [{ question: 'Where are you located?', answer: 'On King Street in Manchester city centre.' }],
    [{ name: 'Booking details', enabled: true, fields: [
      { name: 'caller name', type: 'text', required: true }, { name: 'contact number', type: 'text', required: true },
      { name: 'service wanted', type: 'text', required: true }, { name: 'preferred day/time', type: 'text', required: true }] }],
    'VOICE', undefined, 'Europe/London', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], false,
  );
}

// ---- run --------------------------------------------------------------------
const ONLY = process.argv[2]; // 'checks' | 'sms' | 'sims' | undefined(all)
if (!ONLY || ONLY === 'checks') await sectionChecks();
if (!ONLY || ONLY === 'sms') await sectionSms();
if (!ONLY || ONLY === 'sims') {
  await runSim({ key: 'plumber', label: 'Plumber — burst-pipe emergency', kind: 'emergency plumber', prompt: plumberPrompt(),
    scenario: 'Your kitchen pipe has burst and water is going everywhere. You are panicking. Your name is Dave Wilkinson, your mobile is 07853 992555, the address is 14 Oak Lane, Manchester M14 5TP.',
    expectation: 'Reassure, capture name+number+problem+address, confirm a plumber calls straight back, ideally offer an SMS confirmation.' });
  await runSim({ key: 'salon', label: 'Salon — appointment booking', kind: 'beauty salon', prompt: salonPrompt(),
    scenario: 'You want to book a gel manicure. Your name is Sarah Okafor, mobile 07853 992555. You would like Thursday afternoon if possible. You accept the first suitable time offered.',
    expectation: 'Capture name+number+service+preferred time, use booking tools, confirm the booked slot and next step.' });
}

writeFileSync(new URL('./out/report.json', import.meta.url), JSON.stringify(results, null, 2));
console.log('\n── SUMMARY ───────────────────────────────────────────────');
const counts = results.checks.reduce((a, c) => ((a[c.status] = (a[c.status] || 0) + 1), a), {});
console.log('Checks:', JSON.stringify(counts));
console.log('Report written to tests/readiness/out/report.json');
