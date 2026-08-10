// Companion to fix-mismatched-instagram.mts, 10 Aug 2026.
//
// Twenty six creators had their videos published to somebody else's Instagram
// while their connection pointed the wrong way. Moving them back to their own
// account fixed everything still QUEUED, but not what had already gone out:
// each of them had between one and four videos, always from the start of the
// sequence, published to a profile they do not own. Their own Instagram has
// none of them.
//
// Hugo, 10 Aug 2026: "need to give videos 1 to 6 for the accounts."
//
// NOTHING IS DELETED AND NOTHING IS RE-RENDERED. Every one of those videos was
// already rendered in that creator's OWN colour (156 of 156 confirmed ready);
// only the publish went to the wrong place. So the repair is two small moves:
//
//   1. Clear master_video_id on the posts that were published to the wrong
//      Instagram. That column is what the unique index (master_video_id,
//      profile_id) uses to mean "this creator has already had this video, ever",
//      so while it is set the pipeline will never give them that video again.
//      The row itself stays, with its ig_media_id and permalink, as the record
//      of where it really went. It also quietly stops 56 posts' worth of
//      somebody else's views being counted as these creators' performance.
//   2. Rewind creator_video_state.next_seq to 1, so the pipeline walks the
//      sequence again from the top.
//
// The pipeline then fills the gaps on its own and needs no help: a video the
// creator already has QUEUED trips the same unique index, which that code
// already treats as "already scheduled, move on". So nobody gets anything
// twice, and nobody loses a video that is currently waiting to go out.
//
// Because their queued videos keep their existing times, a creator may receive
// a later-numbered video before an earlier one. Left alone on purpose: each
// video stands by itself, and re-timing a queue that is already correct risks
// far more than the tidiness is worth.
//
// Dry by default. `--apply` to write.
//
//   node --experimental-strip-types scripts/regive-lost-videos.mts
//   node --experimental-strip-types scripts/regive-lost-videos.mts --apply

import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

const env: Record<string, string> = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
  if (m) env[m[1]] = m[2];
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error("missing supabase env");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// WHO. Not a hardcoded list: anyone whose pipeline posts were published while
// their connection pointed at an account that is now somebody else's. The
// published post carries the Outstand post id, but the cheapest honest signal
// is the one the repair left behind, so we re-derive it the same way: a creator
// whose OWN account holds none of the videos our own table says they published.
//
// In practice the caller passes the same 26. Keep it explicit rather than
// clever: an over-broad guess here re-gives videos to people who really did
// receive them.
const AFFECTED = JSON.parse(
  readFileSync(new URL("./affected-profiles.json", import.meta.url), "utf8"),
) as string[];

const masters = await db("master_videos?select=id,seq,status&order=seq");
const seqOf = new Map(masters.map((m) => [m.id, m.seq]));
// PostgREST wants each uuid quoted inside in.(); the file holds them bare so
// that the ids still compare equal to the ones coming back from the rows.
const inList = `(${AFFECTED.map((id) => `"${id}"`).join(",")})`;

const posts = await db(
  `scheduled_posts?select=id,profile_id,status,master_video_id,platform_post_url&profile_id=in.${inList}&master_video_id=not.is.null`,
);
const conns = await db(
  `outstand_connections?select=profile_id,ig_username&profile_id=in.${inList}`,
);
const nameBy = new Map(conns.map((c) => [c.profile_id, c.ig_username]));
const states = await db(`creator_video_state?select=profile_id,next_seq&profile_id=in.${inList}`);

const published = posts.filter((p) => p.status === "published");
const queued = posts.filter((p) => p.status === "pending");

console.log(
  `${AFFECTED.length} creators. ${published.length} videos went to the wrong Instagram, ` +
    `${queued.length} are still queued and will now land on the right one.\n`,
);

const lostBy = new Map<string, number[]>();
for (const p of published) {
  const s = seqOf.get(p.master_video_id);
  if (s == null) continue;
  lostBy.set(p.profile_id, [...(lostBy.get(p.profile_id) ?? []), s].sort((a, b) => a - b));
}

for (const pid of AFFECTED) {
  const lost = lostBy.get(pid) ?? [];
  const at = states.find((s) => s.profile_id === pid)?.next_seq;
  if (!lost.length) {
    console.log(`  @${nameBy.get(pid)}: nothing was published to the wrong account, left alone`);
    continue;
  }
  console.log(
    `${APPLY ? "GIVE" : "WOULD"} @${nameBy.get(pid)}: video${lost.length > 1 ? "s" : ""} ` +
      `${lost.join(", ")} back (was starting from #${at})`,
  );
}

if (!APPLY) {
  console.log(`\nDry run, nothing written. ${published.length} posts would be released.`);
  process.exit(0);
}

// 1. release the videos that went to the wrong Instagram
for (const p of published) {
  await dbPatch(`scheduled_posts?id=eq.${p.id}`, { master_video_id: null });
}
// 2. walk the sequence again from the top
for (const pid of AFFECTED) {
  if (!(lostBy.get(pid) ?? []).length) continue;
  await dbPatch(`creator_video_state?profile_id=eq.${pid}`, { next_seq: 1 });
}

console.log(
  `\nDone. ${published.length} videos released, ${lostBy.size} creators rewound to video 1.\n` +
    `The pipeline picks it up within 2 minutes and skips anything already queued.`,
);
