// Prove the SYSTEM-side after-call recap text fires for the demo line — including
// a dead/hang-up call. Sends a properly-signed call_ended webhook to production.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
const PROD = 'https://poppy-henna.vercel.app/api/webhooks/retell';
const AGENT = 'agent_ee268fbbb679c28d9c9ab0e852';
const CALLER = '+447863992555';
const TO = '+447576558278';

const E = (() => { const e = { ...process.env }; for (const l of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !e[m[1]]) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; })();
const KEY = E.RETELL_API_KEY;

async function fire(label, callObj) {
  const payload = { event: 'call_ended', call: { call_id: 'test_' + label + '_' + Date.now(), agent_id: AGENT, direction: 'inbound', from_number: CALLER, to_number: TO, recording_url: null, start_timestamp: Date.now() - 40000, end_timestamp: Date.now(), duration_ms: 40000, ...callObj } };
  const raw = JSON.stringify(payload);
  const ts = Date.now();
  const sig = createHmac('sha256', KEY).update(raw + ts).digest('hex');
  const r = await fetch(PROD, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-retell-signature': `v=${ts},d=${sig}` }, body: raw });
  console.log(`[${label}] HTTP ${r.status} -> ${(await r.text()).slice(0, 120)}`);
}

// 1) a full role-play booking -> should text a lead-card recap
const roleplay = "Agent: Hi, thanks for calling! Who am I speaking with?\nUser: It's Dave, I run a plumbing business, just trying you out.\nAgent: Perfect Dave! Let me show you how I'd answer for you — call in like one of your customers.\nUser: Hi, my name's Sarah Jones, I've got a leaking tap in the kitchen, can someone come out?\nAgent: Of course Sarah! Are you free Thursday afternoon?\nUser: Thursday at 2pm works great.\nAgent: Brilliant, you're booked in Thursday at 2pm and someone will confirm. Anything else?\nUser: No that's it, thanks!";
await fire('normal', {
  transcript: roleplay,
  transcript_object: roleplay.split('\n').map((l) => ({ role: l.startsWith('Agent') ? 'agent' : 'user', content: l.replace(/^\w+: /, '') })),
});

// 2) a DEAD call — caller hung up, said nothing -> should STILL text ("got cut off")
await fire('deadhangup', { duration_ms: 4000, transcript: '', transcript_object: [{ role: 'agent', content: 'Hi, thanks for calling! Who am I speaking with?' }] });

console.log('\nDone — check the phone for TWO texts: (1) a recap for Dave, (2) a "got cut off" note for the hang-up.');
