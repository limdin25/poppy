// Top up N extra leads from the master CSV — excludes numbers already in the
// safest-100 file and anyone already a contact, then sends + wires like the batch.
import { readFileSync } from 'node:fs';

const MASTER = '/Users/hugo/Desktop/BigRun-MobileOnly.csv';
const SAFEST = '/Users/hugo/Desktop/bigrun-safest-100.csv';
const FROM = '+447576558278';
const BUSINESS = 'f8b98eb2-192e-4c22-87fd-90c865123fe7';
const MSG = 'Missing calls = missed jobs. Our AI answers 24/7 & books them in. Hear it live: 07576558278';
const N = parseInt(process.argv[2] || '2', 10);

const E = (() => { const e = { ...process.env }; for (const l of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !e[m[1]]) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; })();
const TSID = E.TWILIO_ACCOUNT_SID, TTOK = E.TWILIO_AUTH_TOKEN;
const twAuth = 'Basic ' + Buffer.from(`${TSID}:${TTOK}`).toString('base64');
const SB = E.SUPABASE_URL, SK = E.SUPABASE_SERVICE_ROLE_KEY;
const sbH = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sbGet(q) { return (await fetch(`${SB}/rest/v1/${q}`, { headers: sbH })).json(); }
async function sbIns(t, row) { const r = await fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(row) }); const j = await r.json(); return Array.isArray(j) ? j[0] : j; }
async function sbPatch(t, q, row) { await fetch(`${SB}/rest/v1/${t}?${q}`, { method: 'PATCH', headers: sbH, body: JSON.stringify(row) }); }

const numsIn = (txt) => new Set((txt.match(/\+447\d{9}/g) || []));
const exclude = numsIn(readFileSync(SAFEST, 'utf8'));

const rows = readFileSync(MASTER, 'utf8').split('\n').slice(1).filter((l) => l.trim());
const picks = []; const seen = new Set();
for (const line of rows) {
  const m = line.match(/\+447\d{9}/); if (!m) continue;
  const num = m[0];
  if (exclude.has(num) || seen.has(num)) continue; seen.add(num);
  // skip if already a contact
  const existing = await sbGet(`contacts?select=id&business_id=eq.${BUSINESS}&phone=eq.${encodeURIComponent(num)}`);
  if (existing.length) continue;
  const name = (line.match(/^"([^"]+)"/)?.[1] || line.split(',')[0]).slice(0, 60);
  picks.push({ name, num });
  if (picks.length >= N) break;
}
console.log(`Topping up ${picks.length} extra leads from master:\n`);

for (const l of picks) {
  const contact = await sbIns('contacts', { business_id: BUSINESS, name: l.name, phone: l.num, status: 'new', lead_status: 'new', tags: ['outreach'], notes: 'Elsie SMS outreach (topup)' });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TSID}/Messages.json`, { method: 'POST', headers: { Authorization: twAuth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: FROM, To: l.num, Body: MSG }) });
  const j = await r.json();
  const now = new Date().toISOString();
  const convo = await sbIns('conversations', { business_id: BUSINESS, contact_id: contact.id, channel: 'sms', status: 'open', ai_handling: true, last_message_at: now, last_message_preview: MSG, unread_count: 0 });
  await sbIns('messages', { conversation_id: convo.id, direction: 'outbound', sender: 'ai', content_type: 'text', body: MSG, metadata: { via: 'outreach', twilio_sid: j.sid } });
  await sbPatch('conversations', `id=eq.${convo.id}`, { last_message_at: now, last_message_preview: MSG });
  console.log(`  ✓ ${l.num}  ${l.name.slice(0, 40).padEnd(40)} [${j.status || j.message}]`);
  await sleep(4000);
}
console.log(`\nTop-up done: ${picks.length} added.`);
