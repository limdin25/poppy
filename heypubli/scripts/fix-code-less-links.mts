// One-off repair, 09 Aug 2026, after four creators were found holding a
// skool.com link with NO referral code in it.
//
// Shoaib copied Skool's "share my profile" button, which gives
// skool.com/@his-name?g=our-community, and put the same page in his Instagram
// bio. Every check we owned asked only "is the link you gave us on your
// profile?", so it matched itself and the roster printed "YES, their link and
// sentence are live" over a page that credits nobody. Jonaid saved the bare
// community page with nothing on the end. The code is the only part that pays
// them, so from now on a link without one never counts anywhere.
//
// This script only repairs the STATE the old rule left behind:
//
//   - a bio step stamped done because their bio matched a link that pays
//     nobody. That stamp was earned against the wrong thing, so it goes.
//   - onboarding_complete, which held one of them at 5/5.
//   - bio_checked_at, cleared so the funnel tick looks at them on its very
//     next run.
//
// It sends NOTHING. Telling them is the tick's job (runBioVerification now
// has a no-referral-code branch, keyed on the profile so it says it once), and
// the wording lives in one place, reply-brain's `link_no_ref_code`.
//
// Dry by default. `--apply` to write.
//
//   node --experimental-strip-types scripts/fix-code-less-links.mts
//   node --experimental-strip-types scripts/fix-code-less-links.mts --apply
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (loaded below, so a bare run cannot silently hit the wrong project).

import { readFileSync } from "node:fs";
import { skoolReferralCode } from "../lib/skool-link.ts";

const APPLY = process.argv.includes("--apply");

const env: Record<string, string> = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
  if (m) env[m[1]] = m[2];
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error("missing supabase env");

async function db(path: string): Promise<any[]> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function dbPatch(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status} ${await res.text()}`);
}

const profiles = await db(
  "profiles?select=id,first_name,last_name,email,whatsapp,ig_username,skool_affiliate_url,onboarding_complete&skool_affiliate_url=not.is.null",
);
const bad = profiles.filter((p) => !skoolReferralCode(p.skool_affiliate_url));
console.log(
  `${profiles.length} creators have saved a link. ${bad.length} of them carry no referral code.\n`,
);
if (!bad.length) process.exit(0);

const ids = bad.map((p) => `"${p.id}"`).join(",");
const stamps = await db(
  `onboarding_progress?select=profile_id,step,completed_at&step=eq.bio&completed_at=not.is.null&profile_id=in.(${ids})`,
);
const bioStamped = new Set(stamps.map((r) => r.profile_id));

for (const p of bad) {
  const label = `${[p.first_name, p.last_name].filter(Boolean).join(" ")} <@${p.ig_username}>`;
  const fixes: string[] = [];
  if (bioStamped.has(p.id)) fixes.push("clear the bio stamp it earned off the wrong link");
  if (p.onboarding_complete) fixes.push("reopen the funnel (onboarding_complete false)");
  fixes.push("clear bio_checked_at so the next tick tells them");

  console.log(`${APPLY ? "FIX " : "WOULD"} ${label}`);
  console.log(`      saved: ${p.skool_affiliate_url}`);
  console.log(`      ${fixes.join("; ")}`);

  if (!APPLY) continue;
  if (bioStamped.has(p.id)) {
    await dbPatch(`onboarding_progress?profile_id=eq.${p.id}&step=eq.bio`, {
      completed_at: null,
      updated_at: new Date().toISOString(),
    });
  }
  await dbPatch(`profiles?id=eq.${p.id}`, {
    onboarding_complete: false,
    bio_checked_at: null,
  });
}

console.log(
  `\n${APPLY ? "Done." : "Dry run, nothing written."} The tick tells each of them once, in their own daytime.`,
);
