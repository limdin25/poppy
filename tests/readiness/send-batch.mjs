// Elsie SMS outreach — creates a Lead (contact) + Inbox thread (sms conversation)
// per lead so it shows in the dashboard, and threads any reply.
// Usage: npx tsx send-batch.mjs <count> <offset> <mode:send|backfill> [csvPath]
// Handles both +447... and national 07... numbers; skips anyone already a contact.
import { readFileSync } from 'node:fs';

const FROM = '+447576558278';
const BUSINESS = 'f8b98eb2-192e-4c22-87fd-90c865123fe7';
const MSG = 'Missing calls = missed jobs. Our AI answers 24/7 & books them in. Hear it live: 07576558278';
const LIMIT = parseInt(process.argv[2] || '10', 10);
const OFFSET = parseInt(process.argv[3] || '0', 10);
const MODE = process.argv[4] || 'send';
const CSV = process.argv[5] || '/Users/hugo/Desktop/bigrun-safest-100.csv';
const GAP_MS = 4000;

const E = (() => { const e = { ...process.env }; for (const l of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !e[m[1]]) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; })();
const TSID = E.TWILIO_ACCOUNT_SID, TTOK = E.TWILIO_AUTH_TOKEN;
const twAuth = 'Basic ' + Buffer.from(`${TSID}:${TTOK}`).toString('base64');
const SB = E.SUPABASE_URL, SK = E.SUPABASE_SERVICE_ROLE_KEY;
const sbH = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sbGet(q) { return (await fetch(`${SB}/rest/v1/${q}`, { headers: sbH })).json(); }
async function sbIns(t, row) { const r = await fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(row) }); const j = await r.json(); return Array.isArray(j) ? j[0] : j; }
async function sbPatch(t, q, row) { await fetch(`${SB}/rest/v1/${t}?${q}`, { method: 'PATCH', headers: sbH, body: JSON.stringify(row) }); }

function parseCsvLine(line) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } } out.push(cur); return out; }
function normMobile(s) { s = (s || '').replace(/\s/g, ''); if (/^\+447\d{9}$/.test(s)) return s; if (/^07\d{9}$/.test(s)) return '+44' + s.slice(1); return null; }

// already-contacted phones (bulk) so we never double-send
const existing = new Set((await sbGet(`contacts?select=phone&business_id=eq.${BUSINESS}&limit=5000`)).map((c) => c.phone));

const lines = readFileSync(CSV, 'utf8').split('\n').slice(1).filter((l) => l.trim());
const all = []; const seen = new Set();
for (const line of lines) {
  const f = parseCsvLine(line);
  const num = f.map(normMobile).find(Boolean);
  if (!num || seen.has(num) || existing.has(num)) continue;
  seen.add(num);
  all.push({ name: (f[0] || '').slice(0, 60), num });
}
const batch = all.slice(OFFSET, OFFSET + LIMIT);
console.log(`MODE=${MODE}  csv=${CSV.split('/').pop()}  new leads available=${all.length}  sending ${batch.length}  from ${FROM}\n`);

let done = 0, failed = 0;
for (const l of batch) {
  try {
    let contact = (await sbGet(`contacts?select=id&business_id=eq.${BUSINESS}&phone=eq.${encodeURIComponent(l.num)}`))[0];
    if (!contact) contact = await sbIns('contacts', { business_id: BUSINESS, name: l.name, phone: l.num, status: 'new', lead_status: 'new', tags: ['outreach'], notes: 'Elsie SMS outreach' });
    let sid = null, status = 'backfilled';
    if (MODE === 'send') { const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TSID}/Messages.json`, { method: 'POST', headers: { Authorization: twAuth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: FROM, To: l.num, Body: MSG }) }); const j = await r.json(); sid = j.sid; status = j.status || j.message; }
    let convo = (await sbGet(`conversations?select=id&business_id=eq.${BUSINESS}&contact_id=eq.${contact.id}&channel=eq.sms&status=neq.archived&limit=1`))[0];
    const now = new Date().toISOString();
    if (!convo) convo = await sbIns('conversations', { business_id: BUSINESS, contact_id: contact.id, channel: 'sms', status: 'open', ai_handling: true, last_message_at: now, last_message_preview: MSG, unread_count: 0 });
    await sbIns('messages', { conversation_id: convo.id, direction: 'outbound', sender: 'ai', content_type: 'text', body: MSG, metadata: { via: 'outreach', twilio_sid: sid } });
    await sbPatch('conversations', `id=eq.${convo.id}`, { last_message_at: now, last_message_preview: MSG });
    done++;
    console.log(`  ✓ ${l.num}  ${l.name.slice(0, 32).padEnd(32)} [${status}]`);
  } catch (e) { failed++; console.log(`  ✗ ${l.num}  ${l.name}  ERROR: ${e.message}`); }
  if (MODE === 'send') await sleep(GAP_MS);
}
console.log(`\nDone: ${done} sent+wired, ${failed} failed.`);
