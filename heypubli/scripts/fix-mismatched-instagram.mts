// One-off repair, 10 Aug 2026, after 26 creators were found connected to
// somebody else's Instagram.
//
// WHAT HAPPENED. Outstand's GET /social-accounts pages at 50 and IGNORES the
// tenant_id query param entirely (verified: asking for one tenant returns all
// 82). getSocialAccountByTenant read one page, so from the moment the 51st
// account was created nothing new could ever appear in the list it searched.
// Its "if our tenant is not there, take the newest account overall" fallback
// then handed every new creator the newest account ON PAGE ONE, which has been
// frozen since 09 Aug 06:31 at i5QdB, @ziddiqueen15200. 26 people were wired to
// it, and 54 videos were published to that one Instagram in their name.
//
// WHAT THIS FIXES. Only the pointer. Every one of those creators really did
// authorise Instagram and really does have their own Outstand account sitting
// there unused, so nobody has to connect anything again.
//
// HOW EACH CREATOR IS MATCHED BACK, in this order:
//   1. tenant_id === their profile id. The connect-from-inside-the-app flow
//      passes the user's own id, so this is theirs beyond argument.
//   2. otherwise, the account created immediately BEFORE their connection row.
//      The signup flow passes a random nonce we never stored, so time is what
//      is left. It is not a guess: the failing lookup above burns a fixed
//      ~20 seconds (10 attempts, 1.5s apart) before writing the row, and both
//      sequences are strictly ordered, so the pairing is forced. It is also
//      independently confirmed by the handles: sheperdsmkb@gmail.com lands on
//      @sheperdsmkb, tutulmahmud04@gmail.com on @tutulmahmud04, and so on for
//      most of the batch.
//
// A match over 180 seconds old is refused rather than written, and the script
// stops before writing anything if two creators resolve to the same account.
//
// It sends NOTHING and it touches no video. creator_video_state is keyed by
// profile, so every creator keeps their colour, their posting minute and their
// place in the sequence; their pending posts simply land on the right
// Instagram from the next beat.
//
// Dry by default. `--apply` to write.
//
//   node --experimental-strip-types scripts/fix-mismatched-instagram.mts
//   node --experimental-strip-types scripts/fix-mismatched-instagram.mts --apply

import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
/** Widest gap we will accept between an account being created and the
 *  connection row that should point at it. The real ones cluster at 20s. */
const MAX_MATCH_SECONDS = 180;

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

interface OstAccount {
  id: string;
  username: string;
  tenant_id: string | null;
  network_unique_id?: string | null;
  createdAt: string;
  isActive?: number | boolean;
}

/** EVERY page. Reading one page is the bug this script exists to repair. */
async function allOutstandAccounts(apiKey: string): Promise<OstAccount[]> {
  const out: OstAccount[] = [];
  for (let offset = 0; ; offset += 50) {
    const res = await fetch(
      `https://api.outstand.so/v1/social-accounts?network=instagram&limit=50&offset=${offset}`,
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } },
    );
    if (!res.ok) throw new Error(`outstand ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: OstAccount[]; total?: number };
    out.push(...json.data);
    if (!json.data.length || out.length >= (json.total ?? out.length)) return out;
  }
}

const settings = await db("posting_settings?select=outstand_api_key&limit=1");
const apiKey = settings[0]?.outstand_api_key;
if (!apiKey) throw new Error("no outstand api key in posting_settings");

const accounts = await allOutstandAccounts(apiKey);
const conns = await db(
  "outstand_connections?select=profile_id,outstand_social_account_id,ig_username,ig_user_id,created_at&order=created_at",
);
const profiles = await db("profiles?select=id,first_name,last_name,email");
const profileBy = new Map(profiles.map((p) => [p.id, p]));
const byTenant = new Map(accounts.filter((a) => a.tenant_id).map((a) => [a.tenant_id!, a]));
const byId = new Map(accounts.map((a) => [a.id, a]));
const ms = (iso: string) => new Date(iso).getTime();
const oldestFirst = [...accounts].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

console.log(`${accounts.length} Instagram accounts in Outstand, ${conns.length} connections here.\n`);

interface Fix {
  profileId: string;
  label: string;
  from: string;
  to: OstAccount;
  how: string;
}
const fixes: Fix[] = [];
const unresolved: string[] = [];

for (const c of conns) {
  const p = profileBy.get(c.profile_id) ?? {};
  const label = `${[p.first_name, p.last_name].filter(Boolean).join(" ") || "?"} <${p.email ?? "?"}>`;

  let match = byTenant.get(c.profile_id);
  let how = "their own id is on the account";
  if (!match) {
    const before = oldestFirst.filter((a) => ms(a.createdAt) <= ms(c.created_at));
    const candidate = before[before.length - 1];
    const gap = candidate ? (ms(c.created_at) - ms(candidate.createdAt)) / 1000 : Infinity;
    if (!candidate || gap > MAX_MATCH_SECONDS) {
      unresolved.push(`${label} (nearest account ${Math.round(gap / 3600)}h away)`);
      continue;
    }
    match = candidate;
    how = `connected ${gap.toFixed(0)}s before their row was written`;
  }
  if (match.id === c.outstand_social_account_id) continue;
  fixes.push({
    profileId: c.profile_id,
    label,
    from: byId.get(c.outstand_social_account_id)?.username ?? c.ig_username ?? "?",
    to: match,
    how,
  });
}

// Two creators cannot own one Instagram. If this ever trips, the matching is
// wrong and writing would trade one mix-up for another, so nothing is written.
const targets = fixes.map((f) => f.to.id);
const collisions = [...new Set(targets.filter((t) => targets.filter((x) => x === t).length > 1))];
const stolen = fixes.filter((f) =>
  conns.some(
    (c) =>
      c.outstand_social_account_id === f.to.id &&
      !fixes.some((g) => g.profileId === c.profile_id),
  ),
);
if (collisions.length || stolen.length) {
  console.error("REFUSING TO WRITE.");
  if (collisions.length) console.error(`  two creators resolve to: ${collisions.join(", ")}`);
  if (stolen.length)
    console.error(`  would take an account already held: ${stolen.map((s) => s.label).join(", ")}`);
  process.exit(1);
}

if (unresolved.length) {
  console.log(`${unresolved.length} could not be matched and are left alone:`);
  for (const u of unresolved) console.log(`  ${u}`);
  console.log();
}

if (!fixes.length) {
  console.log("Every connection already points at the right account. Nothing to do.");
  process.exit(0);
}

console.log(`${fixes.length} connections point at the wrong Instagram:\n`);
for (const f of fixes) {
  console.log(`${APPLY ? "MOVE" : "WOULD"} ${f.label}`);
  console.log(`      @${f.from}  ->  @${f.to.username}  (${f.to.id}, ${f.how})`);
  if (!APPLY) continue;
  await dbPatch(`outstand_connections?profile_id=eq.${f.profileId}`, {
    outstand_social_account_id: f.to.id,
    ig_username: f.to.username,
    ...(f.to.network_unique_id ? { ig_user_id: f.to.network_unique_id } : {}),
  });
}

console.log(
  `\n${APPLY ? `Done, ${fixes.length} moved.` : "Dry run, nothing written."} ` +
    `Nobody has to reconnect: every account above was already authorised by that creator.`,
);
