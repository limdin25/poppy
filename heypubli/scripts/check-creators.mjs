// Who is really onboarded, checked against the source of truth rather than our own
// hopeful columns.
//
// Written 07 Aug 2026, the day the first real creator signed up, because two things
// were believed and neither was checked:
//   1. "Instagram is connected" was read off instagram_connections, which is EMPTY and
//      always has been. The live integration writes to outstand_connections. Wrong
//      table, wrong answer, reported to Hugo as fact.
//   2. "He joined Skool" was taken from the creator saying "Done" on WhatsApp. He had
//      not. The funnel's own button is on the creator's word, and Skool sends us
//      nothing for a free invite, so nobody on our side ever knows.
//
// So this asks the outside world:
//   Instagram -> Outstand's own API (the account exists, is active, and its metrics
//                endpoint answers, which Instagram only does for professional accounts)
//   Skool     -> skool_members.membership. Checked 07 Aug against Zapier's own docs:
//                Skool's app has exactly two triggers, "New Paid Member" and "Answered
//                Membership Questions". There is NO free-join trigger, so a free member
//                joining is genuinely undetectable by us today. This script therefore
//                never prints "joined" off a free invite. It prints DECLARED when the
//                creator pressed the button and says so, and that word is the honest
//                one: it is their word, not a fact we checked.
//
// Usage:  node scripts/check-creators.mjs
// Needs:  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL), read
//         from .env.local automatically.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadEnv();

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function db(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Only PGRST205 means the table is not there. A bad COLUMN (PGRST204/42703)
    // is my mistake in this file and must be loud, not quietly reported as
    // "table missing" - that is precisely how "Instagram is not connected" got
    // told to Hugo as a fact when the real answer lived in another table.
    if (/PGRST205/.test(body)) return { missing: true, rows: [] };
    throw new Error(`supabase ${path} -> ${res.status} ${body.slice(0, 300)}`);
  }
  return { missing: false, rows: await res.json() };
}

async function outstand(apiKey, path) {
  const res = await fetch(`https://api.outstand.so/v1${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

const STEPS = ["instagram", "community", "affiliate", "photo", "bio"];

const profiles = (
  await db(
    // referral_tag was dropped from profiles on 07 Aug 2026 by the refactor
    // stripping the Brazilian stack. It was only printed, never decided on, so
    // the column is gone rather than restored. If this 400s again on a column,
    // check what else that refactor took with it before assuming a typo.
    "profiles?select=id,first_name,last_name,email,whatsapp,skool_affiliate_url,created_at&order=created_at",
  )
).rows;
const connections = (
  await db("outstand_connections?select=profile_id,outstand_social_account_id,ig_username,is_connected")
).rows;
const progress = (await db("onboarding_progress?select=profile_id,step,completed_at")).rows;
const invites = (await db("skool_invites?select=profile_id,email,status,sent_at")).rows;
const members = await db("skool_members?select=email_normalized,membership,paid_at");

// Who somebody has SEEN in the member list. Skool tells us nothing, so this is
// a human looking, written down, with the date they looked. Stale by nature:
// somebody joining after _checked_at will not be in here.
let seenInGroup = { members: {}, not_members: {}, _checked_at: null };
try {
  seenInGroup = JSON.parse(readFileSync(resolve(HERE, "skool-members.json"), "utf8"));
} catch {
  /* absent is fine, we just fall back to the ref-link proof */
}

const settings = (await db("posting_settings?select=outstand_api_key&limit=1")).rows;
const outstandKey = settings?.[0]?.outstand_api_key || null;

// One call, not one per creator.
let liveAccounts = [];
if (outstandKey) {
  const raw = await outstand(outstandKey, "/social-accounts?network=instagram");
  liveAccounts = Array.isArray(raw) ? raw : raw?.data || [];
}

// 'free_invited' means we SENT an invite, never that they opened it. Only paid
// and trial are memberships Skool actually told us about.
const confirmedMembers = new Set(
  (members.rows || [])
    .filter((m) => ["paid", "trial"].includes(String(m.membership)))
    .map((m) => String(m.email_normalized || "").toLowerCase()),
);

const report = [];
for (const p of profiles) {
  const conn = connections.find((c) => c.profile_id === p.id) || null;
  const live = conn
    ? liveAccounts.find((a) => a.id === conn.outstand_social_account_id) || null
    : null;

  // Instagram is only "ok" when the outside world agrees: our row, Outstand's
  // account list, and an insights response Instagram only gives professionals.
  let instagram = "NOT CONNECTED";
  let igDetail = "";
  let igType = null;
  let bio = null;
  let website = null;
  if (conn && !live && !outstandKey) {
    instagram = "UNVERIFIED";
    igDetail = "no outstand_api_key in posting_settings, cannot ask Outstand";
  } else if (conn && !live) {
    instagram = "BROKEN";
    igDetail = `our row says ${conn.ig_username}, Outstand does not list account ${conn.outstand_social_account_id}`;
  } else if (conn && live) {
    const metrics = await outstand(
      outstandKey,
      `/social-accounts/${conn.outstand_social_account_id}/metrics`,
    );
    const postable = Boolean(metrics?.success);
    instagram = live.isActive && postable ? "OK" : "CHECK";
    // Instagram's OWN account_type when we have it. Outstand's label is NOT
    // trustworthy: it called the first creator "personal" while Instagram said
    // MEDIA_CREATOR.
    //
    // AND WHEN METRICS FAIL WE DO NOT KNOW THE TYPE AT ALL. On 07 Aug this
    // printed "igType=personal metrics=NO" for Edelyn, I read it as a personal
    // account, and told her to switch to Professional. She sent a screenshot:
    // her account was ALREADY Professional. Twenty minutes of her time wasted
    // chasing a diagnosis this column invented. If metrics did not answer, the
    // type is UNKNOWN and must say so rather than repeating Outstand's guess.
    igType = metrics?.data?.platform_specific?.account_type
      || (postable ? live.accountType : "unknown, metrics did not answer");
    bio = metrics?.data?.platform_specific?.biography ?? null;
    website = metrics?.data?.platform_specific?.website ?? null;
    igDetail = [
      `@${live.username}`,
      `active=${live.isActive ? "yes" : "no"}`,
      `igType=${igType}`,
      `metrics=${postable ? "yes" : "NO"}`,
      metrics?.data ? `followers=${metrics.data.followers_count}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const done = STEPS.filter((s) =>
    progress.some((r) => r.profile_id === p.id && r.step === s && r.completed_at),
  );

  const invite = invites.find((i) => i.profile_id === p.id) || null;
  const declaredJoined = done.includes("community");

  // A ?ref= LINK IS PROOF OF MEMBERSHIP. Hugo, 07 Aug 2026: "you can see he has
  // a referral link, that's the proof."
  //
  // He is right, and this file was being obtuse. Skool only hands a member
  // their referral link from inside the group, so holding one is not a claim
  // about having joined, it is a thing that could only have happened after
  // joining. I had Bhupender's ref link on file and still reported him as
  // "declared, unverifiable" because his Skool display name is "Bhyg G" rather
  // than "Bhupender", which proves nothing either way: people do not sign up to
  // Skool with the name they gave us.
  //
  // Note the shapes are not equal evidence. `GROUP/about?ref=CODE` comes from
  // the Invite COPY button and is per-member. `@handle?g=GROUP` is the shape
  // the member list uses for profile links, so it does NOT prove the same
  // thing and is not accepted here.
  const holdsRefLink = /[?&]ref=[A-Za-z0-9]+/.test(String(p.skool_affiliate_url || ""));

  let skool;
  if (confirmedMembers.has(String(p.email || "").toLowerCase())) {
    skool = "PAID MEMBER (verified)";
  } else if (holdsRefLink) {
    skool = "IN THE GROUP (holds a ref link)";
  } else if (seenInGroup.members?.[String(p.email || "").toLowerCase()]) {
    skool = "IN THE GROUP (seen in the list)";
  } else if (seenInGroup.not_members?.[String(p.email || "").toLowerCase()]) {
    skool = "NOT IN THE GROUP (checked)";
  } else if (declaredJoined) {
    // The honest word. Skool has no free-join trigger, so this is the creator's
    // own claim and nothing more. Printing "joined" here would be the same lie
    // the funnel told about Instagram.
    skool = "DECLARED by creator, unverifiable";
  } else if (invite?.status === "confirmed" || invite?.sent_at) {
    skool = "INVITE SENT, not joined";
  } else if (invite) {
    skool = `INVITE ${String(invite.status).toUpperCase()}`;
  } else {
    skool = "NO INVITE";
  }

  // Step 5 is the one step we CAN check for real: the referral link either is
  // in their Instagram bio or it is not. The funnel lets a creator tick it off
  // on their word, so "done" in our table proves nothing on its own.
  // SKOOL GIVES OUT TWO DIFFERENT LINK SHAPES AND BOTH ARE REAL.
  //
  //   https://www.skool.com/GROUP/about?ref=CODE          (Bhupender, Marry)
  //   https://www.skool.com/@their-handle?g=GROUP         (Prem)
  //
  // 07 Aug 2026: this only ever looked for `ref=`, so Prem, whose link was live
  // in his bio and whose page was finished, came out as "CLAIMED, NOT FOUND".
  // On that reading I would have told a creator to redo work he had already
  // done, which is the exact mistake that cost Edelyn twenty minutes the same
  // morning. Match the distinctive part of whatever link WE stored for them,
  // rather than one hardcoded shape.
  let bioLink = "-";
  if (conn && p.skool_affiliate_url) {
    const url = String(p.skool_affiliate_url);
    const needle =
      (url.match(/ref=([A-Za-z0-9]+)/) || [])[1] ||
      (url.match(/@([A-Za-z0-9._-]+)/) || [])[1] ||
      "";
    const haystack = `${bio || ""} ${website || ""}`;
    // "No link at all" and "somebody else's link" are completely different
    // problems and need opposite answers, so stop reporting them as one.
    //
    // 07 Aug 2026: a 5/5 account had a perfectly good skool.com link live in
    // its bio carrying ref=5062958e..., while the link saved on our page was
    // ref=3d5d0ae6.... Reported as "CLAIMED, NOT FOUND" that reads like a
    // creator who did nothing. It is the opposite: they did the work and the
    // commission would go to whoever owns the OTHER code.
    const otherSkoolLink = /skool\.com/i.test(haystack);
    if (needle && haystack.includes(needle)) bioLink = "LIVE";
    else if (bio === null && website === null) bioLink = "unreadable";
    else if (otherSkoolLink) bioLink = "WRONG LINK, not their code";
    else bioLink = done.includes("bio") ? "CLAIMED, NOT FOUND" : "not yet";
  }

  report.push({
    name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || "(no name)",
    email: p.email,
    whatsapp: p.whatsapp || "-",
    instagram,
    igDetail,
    bioLink,
    skool,
    steps: `${done.length}/5 (${done.join(", ") || "none"})`,
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log("");
console.log(
  pad("CREATOR", 20) +
    pad("INSTAGRAM", 14) +
    pad("BIO LINK", 20) +
    pad("SKOOL", 34) +
    "STEPS",
);
console.log("-".repeat(120));
for (const r of report) {
  console.log(
    pad(r.name, 20) +
      pad(r.instagram, 14) +
      pad(r.bioLink, 20) +
      pad(r.skool, 34) +
      r.steps,
  );
  if (r.igDetail) console.log(pad("", 20) + r.igDetail);
}
console.log("");
console.log(
  `${report.length} creator(s). ` +
    `${report.filter((r) => r.instagram === "OK").length} with a verified Instagram, ` +
    `${report.filter((r) => r.skool.startsWith("PAID") || r.skool.startsWith("IN THE GROUP")).length} proven inside the community` +
    (seenInGroup._checked_at ? ` (member list last read ${seenInGroup._checked_at}).` : "."),
);

// NO EMAIL MEANS NO INVITE, EVER. Hugo, 07 Aug: "if you are missing the emails
// you cannot send them the invitation, right?" Right. The Instagram signup path
// can mint a synthetic name@instagram.heypubli.com address, which cannot
// receive anything and which the skool_invites CHECK constraint refuses, so
// that creator silently cannot be invited and step 2 becomes impossible for
// them. Nobody is in that state today; this makes sure we hear about it if
// anybody ever is.
const unreachable = profiles.filter((p) => {
  const e = String(p.email || "").toLowerCase();
  return !e || e.endsWith("@instagram.heypubli.com");
});
if (unreachable.length) {
  console.log(
    `\nCANNOT BE INVITED, no usable email address (${unreachable.length}):`,
  );
  for (const p of unreachable) {
    console.log(
      `   ${(p.first_name || "(no name)").padEnd(20)} ${p.email || "NULL"}`,
    );
  }
  console.log(
    "   Step 2 is impossible for these creators until a real address is on the profile.",
  );
}
console.log(
  "\nSkool: checked against Zapier 07 Aug 2026, the Skool app has only two triggers,\n" +
    '"New Paid Member" and "Answered Membership Questions". There is no free-join\n' +
    "trigger, so DECLARED is as far as we can ever get on a free invite without\n" +
    "either turning on membership questions or reading the member list by hand.",
);
