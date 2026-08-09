// Give the Facebook lead-ad leads already in the CRM their real names.
//
// WHY. A Facebook lead ad drops the person into WhatsApp with a first message
// Meta composes out of the form they filled in:
//
//   Hello! I filled out your form and would like to know more about your business.
//
//   Phone number: +919305415993
//   First name: lakshmi
//   Email: as3816519@gmail.com
//
// Nothing ever read it. wk-sms-incoming names a brand-new inbound contact after
// the number it came from, so every one of those leads sits in the inbox as its
// own phone number, and Hugo cannot tell one from another. The webhook now
// parses the form on the way in; this is the one-off catch-up for everybody who
// arrived before it did.
//
// DRY BY DEFAULT. It prints exactly what it would change and writes NOTHING
// until you add --apply. It costs no money either way: no Twilio, no lookups,
// two Supabase reads.
//
//   node scripts/backfill-lead-names.mjs              # show me
//   node scripts/backfill-lead-names.mjs --apply      # do it
//   node scripts/backfill-lead-names.mjs --limit 5    # try five first
//
// THE RULE IT WILL NOT BREAK: a name somebody actually chose is never
// overwritten. The only thing it replaces is the phone-number placeholder the
// webhook invented, and it only ever fills an email that is empty.
//
// SCOPE. It starts from HeyPubli contacts and asks about nothing else. This
// CRM is shared: 125 of its 5,656 contacts are creators and the rest are
// plumbers, Reviews customers and receptionist customers. The first version
// scanned every inbound message in the whole database for "First name" and,
// had a Reviews client ever forwarded a form, would have renamed them.
//
// The parsing rules are the ones in src/core/heypubli/lead-form.ts, restated
// here because a plain .mjs script cannot import a .ts. Same arrangement, and
// same reason, as scripts/lib/line-status.mjs and api/lib/twilio-lookup.ts.
// tests/heypubli-lead-form.test.ts holds the canonical behaviour.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    let raw;
    try {
      raw = readFileSync(resolve(REPO, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (repo .env).');
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) || 0 : 0;

// --- the parser, mirrored from src/core/heypubli/lead-form.ts --------------

const MAX_NAME = 60;
const FIRST_NAME_RE = /^[^\S\n]*First\s*name[^\S\n]*:[^\S\n]*(.*)$/im;
const EMAIL_RE = /^[^\S\n]*Email[^\S\n]*:[^\S\n]*(.*)$/im;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

// What people put in the name box that is not a name. The first run of this
// script named a contact "Hi" and another one after their Instagram bio.
const GREETING_WORDS = new Set([
  'hello', 'helo', 'hlo', 'hallo', 'halo', 'namaste', 'salam', 'assalamualaikum',
  'ok', 'okay', 'okk', 'k', 'yes', 'ya', 'yeah', 'yep', 'no', 'nope', 'na', 'nil', 'none',
  'sir', 'madam', 'mam', 'maam', 'bro', 'boss',
  'thanks', 'thankyou', 'ty', 'please', 'plz',
  'test', 'testing', 'asdf', 'abc', 'xyz', 'nan', 'null', 'undefined',
  'gm', 'ge', 'goodmorning', 'goodevening', 'goodafternoon', 'goodnight',
]);
const GREETING_RE = /^h+[iey]+$/;

function usableName(raw) {
  const cut = raw.split('|')[0].trim().replace(/\s+/g, ' ');
  if (!cut || cut.length > MAX_NAME) return null;
  if (!/\p{L}/u.test(cut)) return null;
  const bare = cut.toLowerCase().replace(/[^a-z]/g, '');
  if (bare && (GREETING_WORDS.has(bare) || GREETING_RE.test(bare))) return null;
  return cut;
}

function parseLeadForm(body) {
  const text = String(body ?? '');
  const rawName = (text.match(FIRST_NAME_RE)?.[1] ?? '').trim();
  const rawEmail = (text.match(EMAIL_RE)?.[1] ?? '').trim().toLowerCase();
  return {
    firstName: rawName ? usableName(rawName) : null,
    email: EMAIL_SHAPE.test(rawEmail) ? rawEmail : null,
  };
}

function displayName(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s
    .split(' ')
    .map((w) => {
      const oneCase = /[A-Za-z]/.test(w) && (w === w.toLowerCase() || w === w.toUpperCase());
      return oneCase ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
    })
    .join(' ');
}

function isPlaceholderName(name, phone) {
  const n = String(name ?? '').trim();
  if (!n) return true;
  const bare = n.replace(/^whatsapp:/i, '').replace(/[\s()+-]/g, '');
  if (/^\d{5,}$/.test(bare)) return true;
  const p = String(phone ?? '').replace(/^whatsapp:/i, '').replace(/[\s()+-]/g, '');
  return Boolean(p) && bare === p;
}

// --- Supabase --------------------------------------------------------------

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// --- run -------------------------------------------------------------------

console.log(APPLY ? '\nAPPLY: this run WILL write to wk_contacts.\n' : '\nDRY RUN: nothing is written. Add --apply to write.\n');

// STEP 1, THE SCOPE. Every HeyPubli contact, and nothing else in this CRM is
// ever loaded, let alone written. custom_fields.product is the stamp
// wk-partner-api and wk-sms-incoming both set.
const contacts = [];
for (let page = 0; ; page += 1) {
  const rows = await rest(
    `wk_contacts?select=id,name,phone,email,custom_fields&custom_fields->>product=eq.heypubli` +
      `&order=created_at.asc&limit=1000&offset=${page * 1000}`,
  );
  contacts.push(...rows);
  if (rows.length < 1000) break;
}
console.log(`${contacts.length} HeyPubli contact(s) in the CRM.`);

// STEP 2. Their inbound messages that carry a lead form, and only theirs.
// `ilike` on the label rather than the greeting: the greeting is translated
// into the lead's own Facebook locale (we have Bengali ones), the label is not.
const allIds = contacts.map((c) => c.id);
const messages = [];
for (let i = 0; i < allIds.length; i += 100) {
  const chunk = allIds.slice(i, i + 100);
  const rows = await rest(
    `wk_sms_messages?select=contact_id,body,created_at&direction=eq.inbound` +
      `&body=ilike.*First%20name*&contact_id=in.(${chunk.join(',')})` +
      `&order=created_at.asc&limit=5000`,
  );
  messages.push(...rows);
}
console.log(`${messages.length} inbound message(s) carry a lead form.`);

// Oldest first above, so the FIRST form a lead ever sent wins if they somehow
// sent two. Each contact lives in exactly one chunk, so the per-chunk ordering
// is the ordering that matters.
const formByContact = new Map();
for (const m of messages) {
  if (!m.contact_id || formByContact.has(m.contact_id)) continue;
  const parsed = parseLeadForm(m.body);
  if (parsed.firstName || parsed.email) formByContact.set(m.contact_id, parsed);
}
console.log(`${formByContact.size} contact(s) have something worth reading.`);

const plan = [];
for (const c of contacts) {
  const form = formByContact.get(c.id);
  if (!form) continue;
  const patch = {};
  const nice = form.firstName ? displayName(form.firstName) : '';
  const cf = c.custom_fields ?? {};

  if (nice && isPlaceholderName(c.name, c.phone)) patch.name = nice;
  if (form.email && !c.email) patch.email = form.email;
  if (nice && !String(cf.owner_name ?? '').trim()) {
    patch.custom_fields = { ...cf, owner_name: nice };
  }
  if (Object.keys(patch).length > 0) plan.push({ contact: c, patch });
}

const work = LIMIT > 0 ? plan.slice(0, LIMIT) : plan;

console.log(`\n${plan.length} contact(s) would change${LIMIT > 0 ? `, doing ${work.length}` : ''}.\n`);
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log(pad('PHONE', 18) + pad('NOW', 20) + pad('BECOMES', 20) + 'EMAIL');
console.log('-'.repeat(90));
for (const { contact, patch } of work) {
  console.log(
    pad(contact.phone, 18) +
      pad(contact.name, 20) +
      pad(patch.name ?? '(kept)', 20) +
      (patch.email ?? (contact.email ? '(kept)' : '-')),
  );
}

// Counted against the contacts that HAD a form to read, not against every
// HeyPubli contact, or the number would just be "everybody we did not touch".
const skipped = formByContact.size - plan.length;
if (skipped > 0) {
  console.log(`\n${skipped} contact(s) left alone: they already have a name somebody chose.`);
}

if (!APPLY) {
  console.log('\nNothing was written. Run again with --apply to make these changes.\n');
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const { contact, patch } of work) {
  try {
    await rest(`wk_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    ok += 1;
  } catch (e) {
    failed += 1;
    console.error(`  FAILED ${contact.phone}: ${e.message}`);
  }
}
console.log(`\nWrote ${ok} contact(s). ${failed} failed.\n`);
