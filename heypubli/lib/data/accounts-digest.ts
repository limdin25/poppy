// The twice-daily roster email.
//
// Hugo, 08 Aug 2026: "every day I want an email summary of all the accounts,
// 7am and 8pm. I want an email summary of all the accounts connected,
// hyperlinked. You need to bake that in, because we have email, we have
// notifications already, so this is one more that I need as an admin."
//
// Deliberately the whole roster, not just the new ones. The single most useful
// thing this can tell him is an account that has quietly DISCONNECTED, because
// a disconnected account stops posting silently and nothing else surfaces that.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/integrations/resend";
import { igLink } from "./notifications";

export interface DigestAccount {
  igUsername: string | null;
  firstName: string;
  connectedAt: string | null;
  isConnected: boolean;
  enrolled: boolean;
  nextSeq: number;
  postsPublished: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(iso: string | null): string {
  if (!iso) return "unknown";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;">
          ${igLink(a.igUsername)}${badge}${warn}
          <div style="color:#6B7280;font-size:12px;">${esc(a.firstName || "")}${waiting}</div>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:12px;white-space:nowrap;">
          joined ${fmtDate(a.connectedAt)}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:12px;white-space:nowrap;">
          ${a.postsPublished} posted, next #${a.nextSeq}
        </td>
      </tr>`;
  };

  const body = accounts.length
    ? `<table style="width:100%;border-collapse:collapse;">${[...connected, ...disconnected]
        .map(row)
        .join("")}</table>`
    : `<p style="color:#6B7280;">No accounts yet.</p>`;

  return `
    <div style="font-family:sans-serif;max-width:640px;">
      <h2 style="color:#E1306C;margin-bottom:4px;">Creator accounts</h2>
      <p style="color:#6B7280;font-size:13px;margin-top:0;">
        <strong>${connected.length} connected</strong>, ${disconnected.length} disconnected,
        ${accounts.length} total.
      </p>
      ${body}
      <p style="color:#6B7280;font-size:12px;margin-top:16px;">
        HeyPubli, twice daily at 07:00 and 20:00.
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
}> {
  const accounts = await getDigestAccounts();
  const html = buildAccountsDigestHtml(accounts, now);
  const connected = accounts.filter((a) => a.isConnected).length;
  const subject = `Creator accounts: ${connected} connected`;
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
  return { sent, accounts: accounts.length };
}
