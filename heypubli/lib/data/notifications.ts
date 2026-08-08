import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/integrations/resend";
import { formatSaoPaulo } from "@/lib/timezone";
import type { AppNotification, NotificationType } from "@/types/database";

// Synthetic Instagram-login auth emails are not real inboxes.
const SYNTHETIC_EMAIL_DOMAIN = "@instagram.heypubli.com";

/** Insert an admin notification (service role — callable from auth/webhook flows). */
export async function createNotification(params: {
  type: NotificationType;
  profile_id: string | null;
  title: string;
  body?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("notifications") as any).insert({
    type: params.type,
    profile_id: params.profile_id,
    title: params.title,
    body: params.body ?? null,
    read_at: null,
  });
  if (error) throw error;
}

/** Unread count for the admin bell badge (RLS: admins only). */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

/** Latest notifications for the admin page (RLS: admins only). */
export async function getNotifications(limit = 100): Promise<AppNotification[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as AppNotification[] | null) ?? [];
}

/** Real (contactable) emails of all admins. */
async function getAdminEmails(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, email, is_admin")
    .eq("is_admin", true);
  return ((data as { email: string }[] | null) ?? [])
    .map((p) => p.email)
    .filter((e) => e && e.includes("@") && !e.endsWith(SYNTHETIC_EMAIL_DOMAIN));
}

/**
 * A creator's handle as a link straight to their Instagram profile.
 *
 * Hugo, 08 Aug 2026: "I want the handle to come hyperlinked so I can click and
 * visit their profile as well." Falls back to plain text when there is no
 * username, because a link to instagram.com/null is worse than no link.
 *
 * The username is escaped: it is attacker-controlled text landing in an email
 * body, and a handle containing a quote would otherwise break out of the href.
 */
export function igLink(igUsername: string | null): string {
  if (!igUsername) return "no handle yet";
  const safe = igUsername.replace(/[^A-Za-z0-9._]/g, "");
  if (!safe) return "no handle yet";
  return `<a href="https://instagram.com/${safe}" style="color:#E1306C;font-weight:600;text-decoration:none;">@${safe}</a>`;
}

/**
 * "New account connected" — in-app notification + email to every admin.
 * Best-effort: never throws (must not break the Instagram login/connect flow).
 */
export async function notifyAccountConnected(params: {
  profileId: string;
  igUsername: string | null;
  name: string;
}): Promise<void> {
  const { profileId, igUsername, name } = params;
  const handle = igUsername ? `@${igUsername}` : name || "Unnamed account";

  try {
    await createNotification({
      type: "account_connected",
      profile_id: profileId,
      title: `New account connected: ${handle}`,
      body: `${name || handle} connected their Instagram and is not in the campaign yet.`,
    });
  } catch (err) {
    console.error("[notifications] failed to create in-app notification:", err);
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://heypubli.com";
    const connectedAt = formatSaoPaulo(new Date().toISOString());
    const subject = `New account connected: ${handle}`;
    const html = `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #E1306C;">New account connected</h2>
        <p><strong>${name || handle}</strong> (${igLink(igUsername)}) connected their Instagram on ${connectedAt}.</p>
        <p>The account is <strong>not in the campaign yet</strong>.</p>
        <p>
          <a href="${appUrl}/admin/campaign"
             style="display:inline-block;background:#E1306C;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">
            Add to campaign
          </a>
        </p>
        <p style="color:#6B7280;font-size:12px;">HeyPubli, automated notification.</p>
      </div>`;

    const emails = await getAdminEmails();
    await Promise.all(emails.map((to) => sendEmail({ to, subject, html })));
  } catch (err) {
    console.error("[notifications] failed to email admins:", err);
  }
}
