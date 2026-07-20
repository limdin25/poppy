// Verify: (1) duplicate call_ended (same call_id) -> only ONE recap text + ONE
// call row (idempotency), and (2) an on-call onboarding agreement -> a real appointment.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
const PROD = 'https://poppy-henna.vercel.app/api/webhooks/retell';
const AGENT = 'agent_ee268fbbb679c28d9c9ab0e852';
const CALLER = '+447863992555';
const B = 'f8b98eb2-192e-4c22-87fd-90c865123fe7';
const CALL_ID = 'test_fix_' + Date.now();

const E = (() => { const e = { ...process.env }; for (const l of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !e[m[1]]) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; })();
const sbH = { apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}` };
const twAuth = 'Basic ' + Buffer.from(`${E.TWILIO_ACCOUNT_SID}:${E.TWILIO_AUTH_TOKEN}`).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tx = "Agent: Hi — thanks for calling! Who am I speaking with?\nUser: It's Tom, I run a roofing business.\nAgent: Perfect Tom! Let me show you how I'd answer for you. Hello, thanks for calling, how can I help?\nUser: Hi, my roof's leaking, can someone come out?\nAgent: Of course! Can I take your name and postcode?\nUser: Jim, LS1 4DY.\nAgent: Great Jim, I'll get a roofer to call you back within the hour. So Tom, that's how I'd handle it! Fancy Elsie on your line — free tomorrow for a quick 15-minute onboarding?\nUser: Yeah, tomorrow works, let's do 2pm.\nAgent: Brilliant, 2pm tomorrow it is — I'll text you the details now.";
const payload = { event: 'call_ended', call: { call_id: CALL_ID, agent_id: AGENT, direction: 'inbound', from_number: CALLER, to_number: '+447576558278', recording_url: null, start_timestamp: Date.now() - 180000, end_timestamp: Date.now(), duration_ms: 180000, transcript: tx, transcript_object: tx.split('\n').map((l) => ({ role: l.startsWith('Agent') ? 'agent' : 'user', content: l.replace(/^\w+: /, '') })) } };

async function fire(n) {
  const raw = JSON.stringify(payload); const ts = Date.now();
  const sig = createHmac('sha256', E.RETELL_API_KEY).update(raw + ts).digest('hex');
  const r = await fetch(PROD, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-retell-signature': `v=${ts},d=${sig}` }, body: raw });
  console.log(`fire #${n}: HTTP ${r.status} -> ${(await r.text()).slice(0, 90)}`);
}

const startedAt = new Date(Date.now() - 5000).toISOString();
console.log(`call_id = ${CALL_ID}\n`);
await fire(1);
console.log('waiting 12s for first to fully process (AI + texts)...');
await sleep(12000);
await fire(2);   // simulates Retell's retry — should be rejected as duplicate
await sleep(8000);

console.log('\n=== CHECKS ===');
const calls = await (await fetch(`${E.SUPABASE_URL}/rest/v1/calls?select=id&retell_call_id=eq.${CALL_ID}`, { headers: sbH })).json();
console.log(`call rows for this call_id: ${calls.length}  ${calls.length === 1 ? '✅ (idempotent)' : '❌ DUPLICATE'}`);

const msgs = (await (await fetch(`https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_ACCOUNT_SID}/Messages.json?To=${encodeURIComponent(CALLER)}&PageSize=10`, { headers: { Authorization: twAuth } })).json()).messages;
const recent = msgs.filter((m) => m.date_created && new Date(m.date_created).toISOString() > startedAt);
const recaps = recent.filter((m) => (m.body || '').startsWith('Thanks for calling,')).length;
const pitches = recent.filter((m) => (m.body || '').startsWith('P.S.')).length;
console.log(`recap texts sent: ${recaps}  ${recaps === 1 ? '✅ (once)' : '❌'}   pitch texts: ${pitches}  ${pitches === 1 ? '✅' : '❌'}`);

const appts = await (await fetch(`${E.SUPABASE_URL}/rest/v1/appointments?select=title,starts_at,booked_via,status&business_id=eq.${B}&booked_via=eq.voice&order=created_at.desc&limit=3`, { headers: sbH })).json();
console.log(`voice-booked appointments: ${appts.length}`);
appts.forEach((a) => console.log(`  ${a.title} | ${a.starts_at} | ${a.status}`));
console.log(appts.length >= 1 ? '✅ on-call onboarding captured as appointment' : '❌ no appointment created');
