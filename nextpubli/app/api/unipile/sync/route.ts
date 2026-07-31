import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMessages as getUnipileMessages, toE164 } from "@/lib/integrations/unipile";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function counterpartyPhone(chatProviderId?: string, senderId?: string): string {
  if (chatProviderId?.includes("@s.whatsapp.net")) {
    return toE164(chatProviderId);
  }
  if (senderId?.includes("@s.whatsapp.net")) {
    return toE164(senderId);
  }
  return "";
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single<{ is_admin: boolean }>();

  if (!profile?.is_admin)
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

  const admin = createAdminClient();
  const cutoff = Date.now() - MAX_AGE_MS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: channels } = await (admin.from("channels") as any)
    .select("id, unipile_account_id")
    .eq("type", "whatsapp")
    .eq("status", "connected")
    .not("unipile_account_id", "is", null);

  const connectedChannels =
    (channels as Array<{ id: string; unipile_account_id: string }> | null) ?? [];

  if (connectedChannels.length === 0) {
    return NextResponse.json({ synced: 0, message: "Nenhum WhatsApp conectado" });
  }

  let totalInserted = 0;

  for (const channel of connectedChannels) {
    const messages = await getUnipileMessages(channel.unipile_account_id);

    for (const m of messages) {
      if (!m.id) continue;
      const msgMs = m.timestamp ? Date.parse(m.timestamp) : Date.now();
      if (Number.isFinite(msgMs) && msgMs < cutoff) continue;

      const phone = counterpartyPhone(m.chat_provider_id, m.sender_id);
      if (!phone) continue;

      const direction =
        m.is_sender === true || m.is_sender === 1 ? "outbound" : "inbound";

      // Find or create conversation by chat_id
      let conversationId: string | null = null;

      if (m.chat_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (admin.from("conversations") as any)
          .select("id")
          .eq("unipile_chat_id", m.chat_id)
          .maybeSingle();
        conversationId = (existing as { id: string } | null)?.id ?? null;
      }

      if (!conversationId) {
        // Try to match by profile phone
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: matchedProfile } = await (admin.from("profiles") as any)
          .select("id")
          .or(`whatsapp.eq.${phone},phone.eq.${phone}`)
          .eq("is_admin", false)
          .limit(1)
          .maybeSingle();

        const profileId = (matchedProfile as { id: string } | null)?.id ?? null;

        if (profileId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: byProfile } = await (admin.from("conversations") as any)
            .select("id")
            .eq("profile_id", profileId)
            .eq("channel", "whatsapp")
            .eq("status", "open")
            .maybeSingle();
          conversationId = (byProfile as { id: string } | null)?.id ?? null;
        }

        if (!conversationId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: newConvo } = await (admin.from("conversations") as any)
            .insert({
              profile_id: null,
              channel: "whatsapp",
              status: "open",
              unipile_chat_id: m.chat_id || null,
              subject: phone,
            })
            .select("id")
            .single();
          conversationId = (newConvo as { id: string } | null)?.id ?? null;
        }
      }

      if (!conversationId) continue;

      // Idempotent insert — skip if external_id already exists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingMsg } = await (admin.from("inbox_messages") as any)
        .select("id")
        .contains("metadata", { external_id: m.id })
        .maybeSingle();

      if (existingMsg) continue;

      const hasAttachments = (m.attachments?.length ?? 0) > 0;
      const contentType =
        hasAttachments && m.attachments?.[0]?.type?.includes("image") ? "image" : "text";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("inbox_messages") as any).insert({
        conversation_id: conversationId,
        direction,
        sender: direction === "inbound" ? "contact" : "admin",
        body: m.text || null,
        content_type: contentType,
        metadata: {
          external_id: m.id,
          sender_phone: direction === "inbound" ? phone : undefined,
          chat_id: m.chat_id,
        },
      });

      const preview = (m.text ?? "").slice(0, 100) || (hasAttachments ? "📎 Anexo" : "");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("conversations") as any)
        .update({
          last_message_at: m.timestamp ?? new Date().toISOString(),
          last_message_preview: preview,
          ...(m.chat_id ? { unipile_chat_id: m.chat_id } : {}),
        })
        .eq("id", conversationId);

      totalInserted++;
    }
  }

  return NextResponse.json({ synced: totalInserted });
}
