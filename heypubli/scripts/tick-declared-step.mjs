// Record a step a creator declared to us on WhatsApp instead of on the page.
//
// Written 07 Aug 2026, because Edelyn spent an hour on step 2 and then got
// stuck AFTER finishing it.
//
// WHY THIS IS NOT CHEATING. Three of the five steps are self-declared, and the
// code says so in as many words: "Their word is the mechanism, Skool never
// tells us." Pressing "I have joined" writes a timestamp and nothing else. It
// proves no more than the creator saying "Done" in a chat, because it IS the
// creator saying done, through a button instead of a keyboard.
//
// So when somebody tells us plainly that they have done it, asking them to go
// and press a button that records the same claim is not verification, it is
// friction. Edelyn wrote "Done" at 09:34 and was still on 1 of 5 an hour later,
// blocked from step 3 by a click.
//
// WHAT WOULD MAKE IT A LIE. Only run this off an explicit statement from the
// creator, in their own words, about that step. Not a guess, not "they probably
// did", not an ack like "ok". Pass the quote, it gets stored, so anybody
// reading the row later can see what it rests on.
//
// The two steps that are NOT self-declared are affiliate (we hold the actual
// link) and instagram (the connection either exists or it does not). Those
// cannot be ticked here, and the script refuses them.
//
//   node scripts/tick-declared-step.mjs <email> <community|photo|bio> "<their words>"

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(resolve(ROOT, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    /* file absent, fine */
  }
}

const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const COLUMNS = {
  community: "community_joined_declared_at",
  photo: "photo_declared_at",
  bio: "bio_link_declared_at",
};

const [email, step, quote] = process.argv.slice(2);
if (!email || !step || !quote) {
  console.error('Usage: node scripts/tick-declared-step.mjs <email> <community|photo|bio> "<their words>"');
  process.exit(1);
}
if (!COLUMNS[step]) {
  console.error(
    `"${step}" is not self-declared. Only ${Object.keys(COLUMNS).join(", ")} can be recorded this way.\n` +
      "affiliate needs the real link, instagram needs a real connection. Neither is somebody's word.",
  );
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const found = await fetch(
  `${URL_}/rest/v1/profiles?select=id,first_name,${COLUMNS[step]}&email=eq.${encodeURIComponent(email)}`,
  { headers },
).then((r) => r.json());

if (!Array.isArray(found) || found.length === 0) {
  console.error(`No profile for ${email}`);
  process.exit(1);
}
const profile = found[0];
if (profile[COLUMNS[step]]) {
  console.log(`${profile.first_name} already has ${step} recorded at ${profile[COLUMNS[step]]}. Nothing to do.`);
  process.exit(0);
}

const res = await fetch(`${URL_}/rest/v1/profiles?id=eq.${profile.id}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ [COLUMNS[step]]: new Date().toISOString() }),
});
if (!res.ok) {
  console.error(`Update failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

console.log(`${profile.first_name}: ${step} recorded, on their own words:`);
console.log(`  "${quote}"`);
console.log("Their next step is now open. Tell them so, or they will not know.");
