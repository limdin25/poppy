// Undo the two contact names the first backfill run got wrong.
//
// WHY. scripts/backfill-lead-names.mjs read the Facebook lead-ad form and
// wrote whatever was in the "First name" box. Two people did not put a name in
// it, so the CRM ended up with:
//
//   +919495068152   name "Hi"                                   (a greeting)
//   +917989848576   name "Rishvanth Ram Koushik| Reel Creator| Bgms |"
//                                                               (an Instagram bio)
//
// Both were then texted with it ("Hi Hi, Maria from HeyPubli here"). The
// parser has since been tightened (src/core/heypubli/lead-form.ts, greetings
// and pipes are refused), so neither would be written again. This fixes the
// two rows that already exist.
//
// WHAT IT DOES TO EACH ROW. It re-reads that contact's own first lead-form
// message with the tightened parser:
//   - a usable name comes out  -> the contact is renamed to it
//   - nothing usable comes out -> the contact goes back to the phone-number
//     placeholder the webhook would have given it, which is honest: we do not
//     know this person's name
// custom_fields.owner_name is corrected the same way, because the reply brain
// reads that one.
//
// DRY BY DEFAULT. It prints the plan and writes NOTHING until you add --apply.
// It touches ONLY the two phone numbers hardcoded below. It cannot wander.
//
//   node scripts/repair-lead-names.mjs             # show me
//   node scripts/repair-lead-names.mjs --apply     # do it

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

/**
 * The only rows this script may touch, ever. A hardcoded list, so it cannot
 * wander into anybody else no matter what the data does.
 *
 * The first two are the ones that were reported. Scanning all 125 HeyPubli
 * contacts on 2026-08-07 with the tightened rule found five more of the same
 * two shapes, so they are here as well. Read the dry run before applying: it
 * prints exactly what each name becomes.
 *
 *   +919495068152   "Hi"                                          reported
 *   +917989848576   "Rishvanth Ram Koushik| Reel Creator| Bgms |"  reported
 *   +917988140674   "Keshav | Powerbuilder |"
 *   +918670729796   "<3"
 *   +8801766156255  "Fuad Newaz | Animated"
 *   +917973351725   "Arjun||srivastaua"
 *   +916001013058   "Soulful | Ai Lofi"
 */
const TARGETS = [
  '+919495068152',
  '+917989848576',
  '+917988140674',
  '+918670729796',
  '+8801766156255',
  '+917973351725',
  '+916001013058',
];

// --- the tightened parser, mirrored from src/core/heypubli/lead-form.ts ----

const MAX_NAME = 60;
const FIRST_NAME_RE = /^[^\S\n]*First\s*name[^\S\n]*:[^\S\n]*(.*)$/im;

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

function firstNameFrom(body) {
  const raw = (String(body ?? '').match(FIRST_NAME_RE)?.[1] ?? '').trim();
  return raw ? usableName(raw) : null;
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

console.log(
  APPLY
    ? `\nAPPLY: this run WILL write to ${TARGETS.length} wk_contacts row(s).\n`
    : '\nDRY RUN: nothing is written. Add --apply to write.\n',
);

const plan = [];
for (const phone of TARGETS) {
  const rows = await rest(
    `wk_contacts?select=id,name,phone,email,custom_fields&phone=eq.${encodeURIComponent(phone)}`,
  );
  const c = rows[0];
  if (!c) {
    console.log(`${phone}: no such contact, skipping.`);
    continue;
  }
  if ((c.custom_fields ?? {}).product !== 'heypubli') {
    // Belt and braces. These two are HeyPubli leads; if one somehow is not,
    // this script is looking at the wrong row and stops rather than guessing.
    console.log(`${phone}: not a HeyPubli contact, skipping.`);
    continue;
  }

  const msgs = await rest(
    `wk_sms_messages?select=body,created_at&direction=eq.inbound&contact_id=eq.${c.id}` +
      `&body=ilike.*First%20name*&order=created_at.asc&limit=1`,
  );
  const parsed = msgs[0] ? firstNameFrom(msgs[0].body) : null;
  // A usable name, or the placeholder the webhook would have used. Never the
  // string that is already there, which is the thing being repaired.
  const wanted = parsed ? displayName(parsed) : c.phone;

  const cf = c.custom_fields ?? {};
  const patch = {};
  if (c.name !== wanted) patch.name = wanted;
  const ownerWanted = parsed ? displayName(parsed) : null;
  if ((cf.owner_name ?? null) !== ownerWanted) {
    const next = { ...cf };
    if (ownerWanted) next.owner_name = ownerWanted;
    else delete next.owner_name;
    patch.custom_fields = next;
  }

  if (Object.keys(patch).length === 0) {
    console.log(`${phone}: already correct, nothing to do.`);
    continue;
  }
  plan.push({ contact: c, patch, wanted });
}

console.log('');
for (const { contact, patch, wanted } of plan) {
  console.log(`${contact.phone}`);
  console.log(`   name now:     ${JSON.stringify(contact.name)}`);
  console.log(`   name becomes: ${JSON.stringify(wanted)}`);
  if (patch.custom_fields) {
    console.log(
      `   owner_name:   ${JSON.stringify((contact.custom_fields ?? {}).owner_name ?? null)}` +
        ` -> ${JSON.stringify(patch.custom_fields.owner_name ?? null)}`,
    );
  }
}
console.log(`\n${plan.length} row(s) would change.\n`);

if (!APPLY) {
  console.log('Nothing was written. Run again with --apply to make these changes.\n');
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const { contact, patch } of plan) {
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
