#!/usr/bin/env node
// Mine the objections owners raise on Pedro's Hostunico calls (3 Oct 2026).
//
// READ ONLY against the CRM: it reads wk_calls and wk_live_transcripts and
// never writes to wk_calls, contacts or anything else. It calls an LLM to pull
// out each objection, clusters them, and writes two FILES from the same data:
//   supabase/migrations/<stamp>_seed_hostunico_objections.sql  (the table seed)
//   supabase/functions/_shared/hostunico-objections.ts          (the coach playbook)
// Apply the SQL with psql. tests/hostunico-objections.test.ts fails if the two drift.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
//     node scripts/hostunico-objections.mjs [--stamp=20261003000002]
//
// Secrets come from the environment and are never printed. Quotes are
// anonymised: no phone numbers, emails, personal names, postcodes or street
// addresses are stored.

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PEDRO = '6b26172e-d98d-4cc4-9e22-b3b4e24624ee';
const MODEL = process.env.OBJECTIONS_MODEL || 'gpt-5.4-mini';
const CACHE = '/tmp/hostunico-objections-cache';
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const STAMP = arg('stamp', '20261003000002');
const MARKET_LINE = 'Most managers charge somewhere between 15 and 20 percent, ours is 9 percent plus VAT.';

for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']) {
  if (!process.env[key]) { console.error(`Missing ${key}`); process.exit(1); }
}
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const RULES = `Facts you may use, and nothing else:
- Hostunico manages short lets on Airbnb for owners. The owner keeps their own Airbnb account and the booking income.
- Management fee: 9 percent plus VAT of booking revenue. VAT is 20 percent of our fee, added on top.
- Software: free in month one, then 29 a month from month two.
- No onboarding fee. No guaranteed rent, no lease, income is not guaranteed.
- ${MARKET_LINE}
- Elsie and the operations team handle guest messages and coordinate cleaners. Guests use a lockbox or key collection.
- The free report compares what the property could make on Airbnb with the advertised rent. It is an estimate.
- Properties are in Manchester and Liverpool.
Never invent customers, numbers or guarantees.`;

const STYLE = `Write rebuttals in Pedro's own spoken voice on the phone: plain British English, contractions, one or two short sentences, then optionally one low-pressure question. No long dashes, no curly quotes, no ellipsis, no markdown. Never use a person's name, phone number, email or address.`;

async function llm(system, user) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!resp.ok) throw new Error(`model ${resp.status}`);
  const json = await resp.json();
  return JSON.parse(json.choices[0].message.content);
}

export function clean(text) {
  return String(text ?? '')
    .replace(/[\u2012-\u2015]/g, ', ').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...')
    .replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim();
}

export function anonymise(text, names = []) {
  let t = clean(text);
  t = t.replace(/\+?\d[\d\s-]{8,}\d/g, '[number]');
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]');
  t = t.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, '[postcode]');
  t = t.replace(/\b\d+[a-z]?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Close|Drive|Dr|Way|Court|Ct|Place|Pl|Terrace|Gardens|Crescent|Square|Grove|Hill|Row)\b/g, '[address]');
  for (const name of names) {
    if (name.length < 3) continue;
    t = t.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[name]');
  }
  return t;
}

async function loadCalls() {
  const { data: calls, error } = await supa.from('wk_calls').select('id,contact_id,started_at,duration_sec').eq('agent_id', PEDRO).eq('script_key', 'sa_call').order('started_at');
  if (error) throw new Error(error.message);
  const out = [];
  for (const call of calls) {
    const { data: lines } = await supa.from('wk_live_transcripts').select('speaker,body,ts').eq('call_id', call.id).order('ts');
    const caller = (lines || []).filter((l) => l.speaker === 'caller');
    if (caller.length < 2 || caller.map((l) => l.body).join(' ').split(/\s+/).length < 25) continue;
    if (/voicemail|leave (?:a|your) message|after the tone|not available to take your call/i.test(caller.slice(0, 2).map((l) => l.body).join(' '))) continue;
    const { data: contact } = call.contact_id ? await supa.from('wk_contacts').select('name').eq('id', call.contact_id).maybeSingle() : { data: null };
    const { data: listings } = call.contact_id ? await supa.from('sa_listings').select('address').eq('wk_contact_id', call.contact_id) : { data: [] };
    const names = [...String(contact?.name || '').split(/\s+/), ...(listings || []).flatMap((l) => String(l.address || '').split(/,\s*/))].map((s) => s.trim()).filter((s) => s.length >= 3 && !/^(the|flat|studio|road|street)$/i.test(s));
    names.push('Pedro');
    out.push({ ...call, names, text: (lines || []).map((l) => `${l.speaker === 'agent' ? 'Pedro' : 'Owner'}: ${l.body}`).join('\n').slice(0, 14000) });
  }
  return out;
}

async function extract(call) {
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/${call.id}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const result = await llm(
    `You review sales calls where Pedro offers Hostunico short-let management to owners and letting agents who advertised a property to rent.\n${RULES}\n${STYLE}\nReturn JSON {"objections":[{"objection":"short generic paraphrase of the concern","quote":"the owner's words, max 25 words","pedro_reply":"what Pedro answered, max 30 words, empty if nothing","handled_well":true|false,"better_rebuttal":"the best answer Pedro could give"}]}. An objection is any concern, refusal, push back or hesitation from the owner or agent (price, trust, already let, wants long-term tenant, agent not owner, legal or lease worries, not interested, send an email, too busy, etc). Ignore voicemail, greetings and logistics. Empty list if none.`,
    call.text,
  );
  const items = (result.objections || []).map((o) => ({ ...o, call_id: call.id, quote: anonymise(o.quote, call.names), pedro_reply: anonymise(o.pedro_reply, call.names), better_rebuttal: anonymise(o.better_rebuttal, call.names), objection: anonymise(o.objection, call.names) }));
  writeFileSync(file, JSON.stringify(items));
  return items;
}

async function pool(items, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { console.error('skip', e.message); out[k] = []; } } }));
  return out;
}

async function cluster(all) {
  const numbered = all.map((o, i) => `${i}. ${o.objection} | quote: ${o.quote} | Pedro said: ${o.pedro_reply || '(nothing)'} | handled well: ${o.handled_well}`).join('\n');
  const result = await llm(
    `You turn real sales-call objections into a training list for Pedro.\n${RULES}\n${STYLE}\nGroup the numbered objections into between 20 and 40 categories (fewer only if there are not enough distinct ones). Return JSON {"categories":[{"category":"2 to 4 word group name such as Price, Trust, Already let, Agent not owner, Timing, Legal and lease, Management, Not interested","objection":"what owners say, in one plain sentence","members":[indices],"best_rebuttal":"the best answer in Pedro's spoken voice, 1 or 2 short sentences, optionally ending with one low-pressure question","our_rebuttal_seen":"the best thing Pedro actually said, or empty","handled_well":true|false}]}. Every price or competition rebuttal must contain exactly this sentence: "${MARKET_LINE}" A first soft refusal is answered with a reframe and the free report offer. A request to stop calling or remove a number is always respected immediately and never rebutted.`,
    numbered,
  );
  return result.categories || [];
}

// The approved answer wins wherever a mined group touches a policy point, and
// fills the list where the calls have not raised it yet. like: matched against
// the group's category and objection.
const POLICY = [
  { like: /price|fee|expensive|cost|unprofitable|commission/i, category: 'Price', objection: 'Your fee is too expensive.', best_rebuttal: `I understand. ${MARKET_LINE} Software is free in month one, then 29 a month, and the report shows what you'd keep compared with your rent.` },
  { like: /already (?:have|got|partnered)|manager already|letting agent|another (?:agent|company)/i, category: 'Management', objection: 'We already have a manager or letting agent.', best_rebuttal: `That's fine. ${MARKET_LINE} Would it help to see the report so you can compare?` },
  { like: /^not interested|not interested in (?:short|the service)/i, category: 'Not interested', objection: 'Not interested, no thanks.', best_rebuttal: "No problem, I'm not asking you to decide anything today. The report is free and just shows what your property could make on Airbnb compared with the rent. Can I send it over?" },
  { like: /happy as|happy with/i, category: 'Happy as is', objection: 'We are happy as we are.', best_rebuttal: "That's fair, and nothing has to change. The free report just shows what the same property could earn on Airbnb, so you know your options. Shall I send it over?" },
  { like: /long.term/i, category: 'Long-term tenant', objection: 'I prefer a long-term tenant.', best_rebuttal: "I understand, a steady tenant is simple. The report just shows what the same property could make on Airbnb, so you can compare before you decide. Can I send it over?" },
  { like: /think about|consider|future interest/i, category: 'Timing', objection: 'I need to think about it.', best_rebuttal: "Of course. It's easier to think it over with the numbers in front of you, and there's no obligation. Shall I send you the report?" },
  { like: /self.manag|do (?:it|airbnb) (?:themselves|myself)|already do airbnb/i, category: 'Self-managing', objection: 'I do it myself.', best_rebuttal: "That makes sense. We can take the guest messages, pricing and cleaning coordination off your hands, and you still keep your Airbnb account and the booking income." },
  { like: /guarantee|fixed rent|lease/i, category: 'Guarantee', objection: 'Do you pay guaranteed rent?', best_rebuttal: "No, we don't pay guaranteed rent or take a lease. You keep the booking income, so you benefit when it does well, but income isn't guaranteed." },
  { like: /e.?mail/i, category: 'Send an email', objection: 'Just send me an email.', best_rebuttal: "Of course. What's the best email address? I'll send the report now so you can look at it while we're on the phone." },
  { like: /whatsapp|by text|message instead/i, category: 'Text it', objection: 'Send it by text instead.', best_rebuttal: "Of course, I can text you the report link. Can I send it to this number?" },
  { like: /wrong area|outside the area|area you cover|another area|located/i, category: 'Where we work', objection: 'Do you cover my area?', best_rebuttal: "We manage remotely, with local cleaners and our operations team. Our properties are in Manchester and Liverpool, so I'd confirm your area with Hugo before promising anything." },
];

function bad(text) {
  if (/[\u2012-\u2015\u2018\u2019\u201C\u201D\u2026]/.test(text)) return 'long dash or curly quote';
  if (/\bguarantee(?:d|s)?\b/i.test(text) && !/\b(?:no|not|isn't|don't)\b[^.]*guarantee/i.test(text)) return 'guarantee claim';
  if (/\b(\d{1,2}) ?(?:%|percent)/i.test(text) && !text.includes(MARKET_LINE) && !/\b9 ?(?:%|percent)/i.test(text)) return 'unknown percentage';
  if (/\b15 (?:and|to) 20\b/.test(text) && !text.includes(MARKET_LINE)) return 'market range not in the approved wording';
  if (/\+?\d[\d\s-]{8,}\d|@/.test(text)) return 'contact detail';
  return null;
}

async function main() {
  const calls = await loadCalls();
  console.log(`calls with real conversation: ${calls.length}`);
  const extracted = (await pool(calls, 6, extract)).flat().filter((o) => o?.objection);
  console.log(`objections extracted: ${extracted.length}`);
  const categories = await cluster(extracted);
  const rows = [];
  for (const c of categories) {
    const members = (c.members || []).map((i) => extracted[i]).filter(Boolean);
    if (!members.length) continue;
    const callIds = [...new Set(members.map((m) => m.call_id))];
    const row = {
      category: clean(c.category), objection: clean(c.objection),
      example_quotes: [...new Set(members.map((m) => m.quote).filter((q) => q && q.length > 3))].slice(0, 4),
      call_ids: callIds, times_heard: members.length,
      best_rebuttal: clean(c.best_rebuttal), our_rebuttal_seen: clean(c.our_rebuttal_seen) || null,
      handled_well: typeof c.handled_well === 'boolean' ? c.handled_well : null,
    };
    const problem = bad(`${row.best_rebuttal} ${row.objection}`);
    if (problem) { console.log(`dropped "${row.objection}": ${problem}`); continue; }
    rows.push(row);
  }
  for (const policy of POLICY) {
    const matched = rows.filter((r) => policy.like.test(`${r.category} ${r.objection}`));
    for (const r of matched) r.best_rebuttal = policy.best_rebuttal;
    if (!matched.length) rows.push({ category: policy.category, objection: policy.objection, best_rebuttal: policy.best_rebuttal, example_quotes: [], call_ids: [], times_heard: 0, our_rebuttal_seen: null, handled_well: null });
  }
  rows.sort((a, b) => b.times_heard - a.times_heard || a.category.localeCompare(b.category));
  rows.forEach((r, i) => { r.sort_order = i; });
  const generatedAt = new Date().toISOString().slice(0, 10);
  const meta = { generated_at: generatedAt, calls_read: calls.length, objections_extracted: extracted.length };

  const json = JSON.stringify(rows.map((r) => ({ ...r, desk: 'sa' })));
  if (json.includes('$seed$')) throw new Error('seed delimiter clash');
  writeFileSync(resolve(ROOT, `supabase/migrations/${STAMP}_seed_hostunico_objections.sql`), `-- Seed of the Hostunico objections list, GENERATED by scripts/hostunico-objections.mjs
-- on ${generatedAt} from ${calls.length} of Pedro's real calls (${extracted.length} objections), plus
-- the standard owner objections. Quotes are anonymised. Re-running the script
-- writes a new seed; older generated rows are switched off, never deleted.
-- meta: ${JSON.stringify(meta)}
update public.wk_objections set is_active = false, updated_at = now() where desk = 'sa' and is_active;
insert into public.wk_objections (category, objection, example_quotes, call_ids, times_heard, best_rebuttal, our_rebuttal_seen, handled_well, sort_order, desk)
select category, objection, coalesce(example_quotes, '[]'::jsonb), coalesce(call_ids, '{}'), times_heard, best_rebuttal, our_rebuttal_seen, handled_well, sort_order, desk
from jsonb_to_recordset($seed$${json}$seed$::jsonb)
  as x(category text, objection text, example_quotes jsonb, call_ids uuid[], times_heard int, best_rebuttal text, our_rebuttal_seen text, handled_well boolean, sort_order int, desk text);
`);

  const top = rows.slice(0, 22);
  const lit = (s) => JSON.stringify(s);
  writeFileSync(resolve(ROOT, 'supabase/functions/_shared/hostunico-objections.ts'), `// The objections playbook the live coach carries (3 Oct 2026).
//
// GENERATED by scripts/hostunico-objections.mjs from the same data as the
// wk_objections seed (supabase/migrations/${STAMP}_seed_hostunico_objections.sql).
// Do not hand-edit: re-run the script. tests/hostunico-objections.test.ts
// fails if this file and the seed drift apart, or if any entry has a long dash.

export interface HostunicoObjection { category: string; objection: string; rebuttal: string; timesHeard: number }

export const HOSTUNICO_OBJECTIONS_GENERATED_AT = ${lit(generatedAt)};
export const HOSTUNICO_OBJECTIONS_SEED = ${lit(`${STAMP}_seed_hostunico_objections.sql`)};
export const HOSTUNICO_OBJECTIONS: readonly HostunicoObjection[] = [
${top.map((r) => `  { category: ${lit(r.category)}, objection: ${lit(r.objection)}, rebuttal: ${lit(r.best_rebuttal)}, timesHeard: ${r.times_heard} },`).join('\n')}
];

export const HOSTUNICO_OBJECTION_PLAYBOOK = \`OBJECTION PLAYBOOK (real owner objections and the best answers, adapt to the call; a do-not-call request is never rebutted):
\${HOSTUNICO_OBJECTIONS.map((o) => \`- \${o.objection} \${o.rebuttal}\`).join('\\n')}\`;
`);
  console.log(JSON.stringify({ ...meta, categories: rows.length, inModule: top.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
