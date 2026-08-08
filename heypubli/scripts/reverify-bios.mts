// One-off repair, 08 Aug 2026, after the self-declare button let a creator
// reach 5/5 over an empty Instagram profile ("Abdul Latif" in the write-up).
//
// Reads every profile whose bio step counts as done, checks their REAL
// Instagram against the new rule (their sentence AND their link both
// present), and for the ones that fail: clears the bio progress stamp and
// onboarding_complete, so the funnel reopens on the bio step and the nudge
// brain chases them with the exact missing half. Verified ones are left
// exactly as they are.
//
// Dry by default. `--apply` to write.
//
//   node --experimental-strip-types scripts/reverify-bios.mts
//   node --experimental-strip-types scripts/reverify-bios.mts --apply
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (loaded below, so a bare run cannot silently hit the wrong project).

import { readFileSync } from "node:fs";
import { bioSentence } from "../lib/bio-variants.ts";
import { checkBio, bioVerified } from "../lib/bio-check.ts";
import { skoolLinkNeedle } from "../lib/skool-link.ts";

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
  "profiles?select=id,first_name,email,is_admin,onboarding_complete,bio_link_declared_at,skool_affiliate_url,bio_variant_index&is_admin=eq.false",
);
const progress = await db(
  "onboarding_progress?select=profile_id,completed_at&step=eq.bio&completed_at=not.is.null",
);
const stamped = new Set(progress.map((r) => r.profile_id));
const candidates = profiles.filter((p) => stamped.has(p.id) || p.bio_link_declared_at);
console.log(`${candidates.length} profiles carry a done bio (stamp or declaration)`);

const settings = await db("posting_settings?select=outstand_api_key&limit=1");
const apiKey = settings?.[0]?.outstand_api_key;
if (!apiKey) throw new Error("no outstand api key in posting_settings");

const conns = await db(
  "outstand_connections?select=profile_id,outstand_social_account_id&is_connected=eq.true",
);
const connBy = new Map(conns.map((c) => [c.profile_id, c.outstand_social_account_id]));

for (const p of candidates) {
  const label = `${p.first_name} <${p.email}>`;
  const accountId = connBy.get(p.id);
  if (!accountId) {
    console.log(`SKIP  ${label}: no connected Instagram, cannot judge, left as is`);
    continue;
  }
  const res = await fetch(
    `https://api.outstand.so/v1/social-accounts/${accountId}/metrics`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) {
    console.log(`SKIP  ${label}: outstand ${res.status}, cannot judge, left as is`);
    continue;
  }
  const d = (await res.json())?.data;
  const ps = d?.platform_specific ?? {};
  const evidence = checkBio({
    tag: skoolLinkNeedle(p.skool_affiliate_url)?.value ?? null,
    sentence: bioSentence(p.bio_variant_index ?? 0),
    biography: ps.biography ?? null,
    website: ps.website ?? null,
  });
  if (bioVerified(evidence)) {
    console.log(`OK    ${label}: sentence and link really are on their profile`);
    continue;
  }
  const missing =
    evidence.link && !evidence.sentence
      ? "sentence missing"
      : evidence.sentence && !evidence.link
        ? "link missing"
        : "both missing";
  console.log(`${APPLY ? "FIX " : "WOULD"} ${label}: ${missing} (bio: ${JSON.stringify((ps.biography ?? "").slice(0, 60))}, website: ${JSON.stringify(ps.website ?? "")})`);
  if (APPLY) {
    await dbPatch(`onboarding_progress?profile_id=eq.${p.id}&step=eq.bio`, {
      completed_at: null,
      updated_at: new Date().toISOString(),
    });
    await dbPatch(`profiles?id=eq.${p.id}`, {
      onboarding_complete: false,
      bio_checked_at: null,
    });
  }
}
console.log(APPLY ? "Applied." : "Dry run, nothing written. Re-run with --apply.");
