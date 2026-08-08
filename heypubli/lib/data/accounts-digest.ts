// The HOURLY roster email.
//
// Hugo, 08 Aug 2026, first: "every day I want an email summary of all the
// accounts, 7am and 8pm... hyperlinked." Then, the same day, after an audit
// found most creators had no link in their bio: "I wanna every hour a report
// with the accounts connected and also that has hyperlink for the account,
// but also says which ones has the school URL connected as well... the date
// joined, the time joined, the posts and the school URL and everything."
//
// Deliberately the whole roster, not just the new ones, and deliberately more
// than a yes/no on the link. A browser-verified audit of all 24 accounts found
// three things a count would have hidden: a creator whose bio carried SOMEBODY
// ELSE'S referral code, a creator who had done it perfectly but whose
// Instagram connection had expired so every check said otherwise, and a
// creator who swapped our link for their own crypto referral. So the table
// says what we SAW, and when we could not see, it says that instead.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/integrations/resend";
import { igLink } from "./notifications";
import {
  buildCreatorRoster,
  syncConnectionHealth,
  VERDICT_LABEL,
  type BioVerdict,
} from "./creator-roster";

export interface DigestAccount {
  igUsername: string | null;
  firstName: string;
  connectedAt: string | null;
  isConnected: boolean;
  enrolled: boolean;
  nextSeq: number;
  postsPublished: number;
  /** From the live read of their real Instagram. See lib/data/creator-roster. */
  bioVerdict?: BioVerdict;
  savedSkoolUrl?: string | null;
  bioSkoolUrl?: string | null;
  followers?: number | null;
  igPosts?: number | null;
  stepsDone?: number;
  openStep?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(iso: string | null): string {
  if (!iso) return "unknown";
  // Hugo asked for the TIME as well as the date: two accounts joining the
  // same afternoon read as one event without it.
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

/** Green when it is genuinely live, red when it needs Hugo, amber otherwise. */
function verdictColour(v: BioVerdict | undefined): string {
  if (v === "verified") return "#047857";
  if (v === "wrong_code" || v === "unreadable") return "#B91C1C";
  return "#92400E";
}

/** Plain text into HTML. Names and handles are creator-supplied. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildAccountsDigestHtml(accounts: DigestAccount[], now: Date): string {
  const connected = accounts.filter((a) => a.isConnected);
  const disconnected = accounts.filter((a) => !a.isConnected);

  const row = (a: DigestAccount) => {
    const isNew =
      a.connectedAt && now.getTime() - new Date(a.connectedAt).getTime() < DAY_MS;
    const badge = isNew
      ? ' <span style="background:#10B981;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;">NEW</span>'
      : "";
    const warn = a.isConnected
      ? ""
      : ' <span style="background:#EF4444;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;">DISCONNECTED</span>';
    const waiting = a.isConnected && !a.enrolled ? " (joining on the next beat)" : "";
    const v = a.bioVerdict;
    const skoolCell = v
      ? `<span style="color:${verdictColour(v)};font-weight:600">${esc(VERDICT_LABEL[v])}</span>` +
        (a.bioSkoolUrl && v === "wrong_code"
          ? `<div style="color:#B91C1C;font-size:11px">in their bio: ${esc(a.bioSkoolUrl.slice(0, 70))}</div>`
          : "") +
        (a.savedSkoolUrl
          ? `<div style="color:#6B7280;font-size:11px">theirs: <a href="${esc(a.savedSkoolUrl)}">${esc(a.savedSkoolUrl.slice(0, 62))}</a></div>`
          : `<div style="color:#B91C1C;font-size:11px">no link saved with us yet</div>`)
      : '<span style="color:#6B7280">not checked</span>';
    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;">
          ${igLink(a.igUsername)}${badge}${warn}
          <div style="color:#6B7280;font-size:12px;">${esc(a.firstName || "")}${waiting}</div>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:12px;white-space:nowrap;">
          ${fmtDate(a.connectedAt)}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:12px;white-space:nowrap;">
          ${a.followers ?? "?"} followers<div>${a.igPosts ?? "?"} IG posts</div>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:12px;white-space:nowrap;">
          ${a.postsPublished} by us, next #${a.nextSeq}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:12px;white-space:nowrap;">
          ${a.stepsDone ?? "?"}/5${a.openStep ? `<div>on ${esc(a.openStep)}</div>` : ""}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;">
          ${skoolCell}
        </td>
      </tr>`;
  };

  const body = accounts.length
    ? `<table style="width:100%;border-collapse:collapse;">
        <tr style="background:#F9FAFB;text-align:left;font-size:12px;color:#374151;">
          <th style="padding:8px 10px;">Account</th>
          <th style="padding:8px 10px;">Joined</th>
          <th style="padding:8px 10px;">Instagram</th>
          <th style="padding:8px 10px;">Our posts</th>
          <th style="padding:8px 10px;">Steps</th>
          <th style="padding:8px 10px;">Skool link in their bio?</th>
        </tr>
        ${[...connected, ...disconnected]
        .map(row)
        .join("")}</table>`
    : `<p style="color:#6B7280;">No accounts yet.</p>`;

  const live = accounts.filter((a) => a.bioVerdict === "verified");
  const needsHugo = accounts.filter(
    (a) => a.bioVerdict === "wrong_code" || a.bioVerdict === "unreadable",
  );
  const chase = accounts.filter(
    (a) =>
      a.isConnected &&
      a.bioVerdict &&
      !["verified", "wrong_code", "unreadable"].includes(a.bioVerdict),
  );

  const alarm = needsHugo.length
    ? `<div style="background:#FEE2E2;padding:10px;border-radius:6px;margin:10px 0;">
        <strong style="color:#B91C1C;">${needsHugo.length} need you, and neither is "not done yet":</strong>
        <ul style="margin:6px 0;color:#B91C1C;font-size:13px;">
          ${needsHugo
            .map((a) =>
              a.bioVerdict === "wrong_code"
                ? `<li><strong>${esc(a.firstName)}</strong> (${esc(a.igUsername ?? "")}) has a Skool link in their bio with someone ELSE'S referral code, so their sales credit that person.</li>`
                : `<li><strong>${esc(a.firstName)}</strong> (${esc(a.igUsername ?? "")}): their Instagram connection is broken. We cannot read their profile and we cannot post to them.</li>`,
            )
            .join("")}
        </ul>
      </div>`
    : "";

  return `
    <div style="font-family:sans-serif;max-width:840px;">
      <h2 style="color:#E1306C;margin-bottom:4px;">Creator accounts</h2>
      <p style="color:#6B7280;font-size:13px;margin-top:0;">
        <strong>${connected.length} connected</strong>, ${disconnected.length} disconnected,
        ${accounts.length} total.
        <br><strong style="color:#047857;">${live.length} have their own Skool link AND their sentence live on Instagram</strong>, checked on their real profile just now.
        ${chase.length ? `<br><span style="color:#92400E;">${chase.length} still to chase.</span>` : ""}
      </p>
      ${alarm}
      ${body}
      <p style="color:#6B7280;font-size:12px;margin-top:16px;">
        HeyPubli, every hour. The Skool column is a live read of each creator's
        real Instagram, not what they told us.
      </p>
    </div>`;
}

/** Pull the roster the digest describes. */
export async function getDigestAccounts(): Promise<DigestAccount[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const [conns, states, profiles, posts] = await Promise.all([
    admin.from("outstand_connections").select("profile_id, ig_username, is_connected, created_at"),
    admin.from("creator_video_state").select("profile_id, next_seq"),
    admin.from("profiles").select("id, first_name"),
    admin.from("scheduled_posts").select("profile_id, status").eq("status", "published"),
  ]);

  const stateBy = new Map<string, { next_seq: number }>(
    ((states.data ?? []) as Array<{ profile_id: string; next_seq: number }>).map((s) => [
      s.profile_id,
      s,
    ]),
  );
  const nameBy = new Map<string, string>(
    ((profiles.data ?? []) as Array<{ id: string; first_name: string | null }>).map((p) => [
      p.id,
      p.first_name ?? "",
    ]),
  );
  const publishedBy = new Map<string, number>();
  for (const p of (posts.data ?? []) as Array<{ profile_id: string }>) {
    publishedBy.set(p.profile_id, (publishedBy.get(p.profile_id) ?? 0) + 1);
  }

  return ((conns.data ?? []) as Array<{
    profile_id: string;
    ig_username: string | null;
    is_connected: boolean;
    created_at: string | null;
  }>)
    .map((c) => ({
      igUsername: c.ig_username,
      firstName: nameBy.get(c.profile_id) ?? "",
      connectedAt: c.created_at,
      isConnected: Boolean(c.is_connected),
      enrolled: stateBy.has(c.profile_id),
      nextSeq: stateBy.get(c.profile_id)?.next_seq ?? 1,
      postsPublished: publishedBy.get(c.profile_id) ?? 0,
    }))
    .sort((a, b) => (b.connectedAt ?? "").localeCompare(a.connectedAt ?? ""));
}

/** Admin recipients. Kept local so the digest cannot be broken by a change to
 *  the connect notification's own recipient rules. */
async function adminEmails(): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin.from("profiles").select("email, is_admin").eq("is_admin", true);
  return ((data ?? []) as Array<{ email: string | null }>)
    .map((p) => p.email ?? "")
    .filter((e) => e.includes("@") && !e.endsWith("@heypubli.local"));
}

export async function sendAccountsDigest(now = new Date()): Promise<{
  sent: number;
  accounts: number;
  verified: number;
  needsYou: number;
}> {
  const accounts = await getDigestAccounts();

  // Merge in the live read of every real Instagram profile. This is the whole
  // point of the hourly email: whether their own Skool link is genuinely on
  // their page, not whether they told us it is. A failure here must not lose
  // the email, so the table falls back to "not checked" rather than lying.
  let verified = 0;
  let needsYou = 0;
  try {
    const admin = createAdminClient();
    const roster = await buildCreatorRoster(admin);
    // Act on what the read found before reporting it: an Instagram that has
    // revoked us cannot be posted to, so the account goes back to "connect
    // your Instagram" instead of sitting at a 5/5 nothing can deliver.
    const health = await syncConnectionHealth(admin, roster);
    if (health.disconnected.length) {
      console.warn(`[accounts-digest] reopened step 1 for: ${health.disconnected.join(", ")}`);
    }
    const byHandle = new Map(
      roster.filter((r) => r.igUsername).map((r) => [r.igUsername!.toLowerCase(), r]),
    );
    for (const a of accounts) {
      const r = a.igUsername ? byHandle.get(a.igUsername.toLowerCase()) : undefined;
      if (!r) continue;
      a.bioVerdict = r.verdict;
      a.savedSkoolUrl = r.savedSkoolUrl;
      a.bioSkoolUrl = r.bioSkoolUrl;
      a.followers = r.followers;
      a.igPosts = r.posts;
      a.stepsDone = r.stepsDone;
      a.openStep = r.openStep;
      if (r.verdict === "verified") verified++;
      if (
        r.verdict === "wrong_code" ||
        r.verdict === "unreadable" ||
        r.verdict === "link_not_clickable"
      )
        needsYou++;
    }
  } catch (err) {
    console.error("[accounts-digest] live Instagram read failed:", err);
  }
  const html = buildAccountsDigestHtml(accounts, now);
  const connected = accounts.filter((a) => a.isConnected).length;
  // The subject line carries the number Hugo actually cares about, so the
  // inbox list alone answers "is anybody's link live yet".
  const subject = needsYou
    ? `Creator accounts: ${verified} of ${connected} links live, ${needsYou} NEED YOU`
    : `Creator accounts: ${verified} of ${connected} links live`;
  const emails = await adminEmails();
  // One at a time rather than Promise.all: Resend throws on a 429 and losing
  // the whole digest because the second recipient was rate limited is worse
  // than a slightly slower send.
  let sent = 0;
  for (const to of emails) {
    try {
      await sendEmail({ to, subject, html });
      sent++;
    } catch (err) {
      console.error("[accounts-digest] failed to email", to, err);
    }
  }
  return { sent, accounts: accounts.length, verified, needsYou };
}
