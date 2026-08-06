import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMessages as getUnipileMessages, toE164 } from "@/lib/integrations/unipile";
import {
  downloadAndStoreAttachment,
  detectContentType,
} from "@/lib/integrations/storage";

const CRON_SECRET = process.env.CRON_SECRET || "";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function counterpartyPhone(chatProviderId?: string, senderId?: string): string {
  if (chatProviderId?.includes("@s.whatsapp.net")) return toE164(chatProviderId);
  if (senderId?.includes("@s.whatsapp.net")) return toE164(senderId);
  return "";
}

export async function GET(req: Request) {
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const cutoff = Date.now() - MAX_AGE_MS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: channels } = await (admin.from("channels") as any)
    .select(
      "id, unipile_account_id, auto_reply_enabled, draft_mode, auto_reply_delay_seconds",
    )
    .eq("type", "whatsapp")
    .eq("status", "connected")
    .not("unipile_account_id", "is", null);

  const connected =
    (channels as Array<{
      id: string;
      unipile_account_id: string;
      auto_reply_enabled: boolean;
      draft_mode: boolean;
      auto_reply_delay_seconds: number;
    }> | null) ?? [];

  if (connected.length === 0) {
    return NextResponse.json({ synced: 0, accounts: 0 });
  }

  let totalInserted = 0;

  for (const channel of connected) {
    const messages = await getUnipileMessages(channel.unipile_account_id);

    for (const m of messages) {
      if (!m.id) continue;
      const msgMs = m.timestamp ? Date.parse(m.timestamp) : Date.now();
      if (Number.isFinite(msgMs) && msgMs < cutoff) continue;

      const isGroup = m.chat_provider_id?.includes("@g.us") ?? false;
      const phone = counterpartyPhone(m.chat_provider_id, m.sender_id);
      if (!phone && !isGroup) continue;

      const direction =
        m.is_sender === true || m.is_sender === 1 ? "outbound" : "inbound";

      // Dedup check
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dup } = await (admin.from("inbox_messages") as any)
        .select("id")
        .contains("metadata", { external_id: m.id })
        .maybeSingle();

      if (dup) continue;

      // Find or create conversation
      let conversationId: string | null = null;

      if (m.chat_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (admin.from("conversations") as any)
          .select("id")
          .eq("unipile_chat_id", m.chat_id)
          .maybeSingle();
        conversationId = (existing as { id: string } | null)?.id ?? null;
      }

      if (!conversationId && phone) {
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
      }

      if (!conversationId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newConvo } = await (admin.from("conversations") as any)
          .insert({
            profile_id: null,
            channel: "whatsapp",
            status: "open",
            unipile_chat_id: m.chat_id || null,
            subject: isGroup ? m.sender_name || m.chat_id : phone,
            is_group: isGroup,
            group_name: isGroup ? m.sender_name || null : null,
          })
          .select("id")
          .single();
        conversationId = (newConvo as { id: string } | null)?.id ?? null;
      }

      if (!conversationId) continue;

      // Download attachments
      const hasAttachments = (m.attachments?.length ?? 0) > 0;
      let mediaUrl: string | null = null;
      let contentType: "text" | "image" | "audio" | "video" | "file" = "text";

      if (hasAttachments && m.attachments?.[0]) {
        const att = m.attachments[0];
        const stored = await downloadAndStoreAttachment(m.id, att.id, conversationId);
        if (stored) {
          mediaUrl = stored.url;
          contentType = stored.contentType;
        } else if (att.type) {
          contentType = detectContentType(att.type);
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("inbox_messages") as any).insert({
        conversation_id: conversationId,
        direction,
        sender: direction === "inbound" ? "contact" : "admin",
        sender_name: m.sender_name || null,
        body: m.text || null,
        media_url: mediaUrl,
        content_type: contentType,
        status: "sent",
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

  return NextResponse.json({
    synced: totalInserted,
    accounts: connected.length,
    polled_at: new Date().toISOString(),
  });
}
