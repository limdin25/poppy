// Read-only audit. Full phone details go only to the requested private report.
// SUPABASE_ACCESS_TOKEN is a management token for this project's database API.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
if (!out || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Set SUPABASE_ACCESS_TOKEN and --out=<private report.json>');
const project = 'loggyxryrhqsbtqpteog';
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Database audit failed (${response.status})`);
  return response.json();
}
const contacts = await query(`select c.id,c.phone,c.created_at,c.desk,c.do_not_call,p.name stage,
  (select count(*) from wk_calls k where k.contact_id=c.id) calls,
  (select count(*) from wk_contact_followups f where f.contact_id=c.id) followups
  from wk_contacts c left join wk_pipeline_columns p on p.id=c.pipeline_column_id order by c.created_at,c.id`);
const queues = await query('select id,contact_id,campaign_id,status,hostunico_uplift_hold,created_at from wk_dialer_queue');
const counts = (await query('select count(*) calls,(select count(*) from wk_contact_followups) followups from wk_calls'))[0];
function normalize(phone) {
  if (/[a-z@]/i.test(phone)) return null;
  let digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('440')) digits = '44' + digits.slice(3);
  if (digits.startsWith('0')) digits = '44' + digits.slice(1);
  if (/^7[0-9]{9}$/.test(digits)) digits = '44' + digits;
  return /^[1-9][0-9]{7,14}$/.test(digits) ? '+' + digits : null;
}
const byPhone = new Map(), byId = new Map(), queueByPhone = new Map();
for (const row of contacts) {
  const phone = normalize(row.phone); byId.set(row.id, phone);
  if (phone) byPhone.set(phone, [...(byPhone.get(phone) || []), row]);
}
for (const row of queues) {
  const phone = byId.get(row.contact_id);
  if (phone && (['pending', 'dialing', 'connected', 'review'].includes(row.status) || (row.status === 'skipped' && row.hostunico_uplift_hold))) queueByPhone.set(phone, [...(queueByPhone.get(phone) || []), row]);
}
const groups = (map) => [...map].filter(([, rows]) => rows.length > 1).map(([normalized_phone, rows]) => ({ normalized_phone, rows }));
const contact_groups = groups(byPhone), queue_groups = groups(queueByPhone);
const report = { project, captured_at: new Date().toISOString(), contacts: contacts.length, queues: queues.length, ...counts, contact_groups, queue_groups };
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ report: out, duplicateContactGroups: contact_groups.length, extraContacts: contact_groups.reduce((n,g) => n+g.rows.length-1,0), duplicateActiveQueueGroups: queue_groups.length, ...counts }));
