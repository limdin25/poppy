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
 * "New account connected" — in-app notification + email to every admin.
 * Best-effort: never throws (must not break the Instagram login/connect flow).
 */
export async function notifyAccountConnected(params: {
  profileId: string;
  igUsername: string | null;
  name: string;
}): Promise<void> {
  const { profileId, igUsername, name } = params;
  const handle = igUsername ? `@${igUsername}` : name || "Conta sem nome";

  try {
    await createNotification({
      type: "account_connected",
      profile_id: profileId,
      title: `Nova conta conectada: ${handle}`,
      body: `${name || handle} conectou o Instagram e ainda não está na campanha.`,
    });
  } catch (err) {
    console.error("[notifications] failed to create in-app notification:", err);
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://nextpubli.com";
    const connectedAt = formatSaoPaulo(new Date().toISOString());
    const subject = `Nova conta conectada: ${handle}`;
    const html = `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #E1306C;">Nova conta conectada</h2>
        <p><strong>${name || handle}</strong> (${handle}) conectou o Instagram em ${connectedAt}.</p>
        <p>A conta ainda <strong>não está na campanha</strong>.</p>
        <p>
          <a href="${appUrl}/admin/campanha"
             style="display:inline-block;background:#E1306C;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">
            Adicionar à campanha
          </a>
        </p>
        <p style="color:#6B7280;font-size:12px;">NextPubli — notificação automática.</p>
      </div>`;

    const emails = await getAdminEmails();
    await Promise.all(emails.map((to) => sendEmail({ to, subject, html })));
  } catch (err) {
    console.error("[notifications] failed to email admins:", err);
  }
}
