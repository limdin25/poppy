import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAccount, toE164 } from "@/lib/integrations/unipile";
import {
  downloadAndStoreAttachment,
  detectContentType,
} from "@/lib/integrations/storage";

const WEBHOOK_SECRET = process.env.UNIPILE_WEBHOOK_SECRET || "";

function ok(note: string) {
  return NextResponse.json({ ok: true, note });
}

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return ok("invalid json");
  }

  const looksLikeHostedNotify =
    typeof payload.status === "string" ||
    (payload.account_id && payload.name && !payload.event);

  if (!looksLikeHostedNotify && WEBHOOK_SECRET) {
    const got = req.headers.get("unipile-auth") || req.headers.get("Unipile-Auth") || "";
    if (got !== WEBHOOK_SECRET) return ok("bad auth");
  }

  const admin = createAdminClient();

  // ── Branch 1: Account connected (hosted-auth callback) ──
  if (
    payload.status === "CREATION_SUCCESS" ||
    payload.status === "OK" ||
    payload.status === "RECONNECTED" ||
    (payload.account_id && payload.name && !payload.event && !payload.AccountStatus)
  ) {
    const accountId = payload.account_id;
    if (!accountId) return ok("no account_id");

    // Never trust the callback alone: a QR session that died mid-scan can fire
    // a notify for an account that no longer exists. Verify against Unipile.
    const acct = await fetchAccount(accountId);
    if (!acct) return ok("account not found at unipile — ignored");
    const phone = toE164(acct?.phone ?? "");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: byAccountId } = await (admin.from("channels") as any)
      .select("id")
      .eq("unipile_account_id", accountId)
      .eq("type", "whatsapp")
      .limit(1)
      .maybeSingle();

    if (byAccountId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("channels") as any)
        .update({
          status: "connected",
          connected_at: new Date().toISOString(),
          label: phone || null,
          config: { phone, type: acct?.type },
        })
        .eq("id", (byAccountId as { id: string }).id);
      return ok("account_connected");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pending } = await (admin.from("channels") as any)
      .select("id")
      .eq("type", "whatsapp")
      .eq("status", "disconnected")
      .is("unipile_account_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pending) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("channels") as any)
        .update({
          status: "connected",
          unipile_account_id: accountId,
          connected_at: new Date().toISOString(),
          label: phone || null,
          config: { phone, type: acct?.type },
        })
        .eq("id", (pending as { id: string }).id);
    }

    return ok("account_connected");
  }

  // ── Branch 2: Account status change ──
  // Unipile's real payload is {"AccountStatus":{account_id, account_type, message}};
  // the legacy event/account_status shapes are kept for compatibility.
  if (
    payload.AccountStatus ||
    payload.event === "account_status" ||
    payload.account_status
  ) {
    const statusData = payload.AccountStatus || payload.account_status || payload;
    const accountId = statusData.account_id || payload.account_id;
    const newStatus = statusData.message || statusData.status || "";

    if (accountId) {
      const isOk = ["OK", "CREATION_SUCCESS", "RECONNECTED", "SYNC_SUCCESS"].includes(
        newStatus,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("channels") as any)
        .update({
          status: isOk ? "connected" : "disconnected",
          ...(isOk ? {} : { disconnected_at: new Date().toISOString() }),
        })
        .eq("unipile_account_id", accountId);
    }

    return ok("account_status");
  }

  // ── Branch 3: Message reaction ──
  if (payload.event === "message_reaction") {
    const externalId = payload.message_id || payload.reaction?.message_id || "";
    const emoji = payload.reaction?.emoji || payload.emoji || "";
    const reactSender = payload.reaction?.sender_id || payload.sender_id || "";

    if (externalId && emoji) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: msg } = await (admin.from("inbox_messages") as any)
        .select("id, metadata")
        .contains("metadata", { external_id: externalId })
        .maybeSingle();

      if (msg) {
        const meta =
          (msg as { id: string; metadata: Record<string, unknown> }).metadata || {};
        const reactions =
          (meta.reactions as Array<{ emoji: string; sender: string }>) || [];
        reactions.push({ emoji, sender: reactSender });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("inbox_messages") as any)
          .update({ metadata: { ...meta, reactions } })
          .eq("id", (msg as { id: string }).id);
      }
    }

    return ok("message_reaction");
  }

  // ── Branch 4: Inbound message ──
  if (payload.event === "message_received" && payload.account_id) {
    const accountId = payload.account_id;
    const messageObj = typeof payload.message === "object" ? payload.message : null;
    const messageText =
      (typeof payload.message === "string" ? payload.message : messageObj?.text) || "";
    const chatId = payload.chat_id || messageObj?.chat_id || "";
    const chatProviderId = messageObj?.chat_provider_id || payload.chat_provider_id || "";
    const senderObj = payload.sender || {};
    const senderPhone = toE164(senderObj.identifier || senderObj.provider_id || "");
    const senderName = senderObj.display_name || senderObj.name || "";
    const externalMessageId = payload.message_id || messageObj?.id || "";

    const rawAttachments: Array<{ id: string; type?: string; name?: string }> =
      payload.attachments || messageObj?.attachments || [];
    const hasAttachments = rawAttachments.length > 0;

    if (!messageText && !hasAttachments) return ok("no text or attachments");

    // Detect group chat
    const isGroup = chatProviderId.includes("@g.us");

    // Find channel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: channel } = await (admin.from("channels") as any)
      .select("id, auto_reply_enabled, draft_mode, auto_reply_delay_seconds")
      .eq("unipile_account_id", accountId)
      .eq("status", "connected")
      .single();

    if (!channel) return ok("no channel");
    const ch = channel as {
      id: string;
      auto_reply_enabled: boolean;
      draft_mode: boolean;
      auto_reply_delay_seconds: number;
    };

    // Dedup check
    if (externalMessageId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dup } = await (admin.from("inbox_messages") as any)
        .select("id")
        .contains("metadata", { external_id: externalMessageId })
        .maybeSingle();
      if (dup) return ok("duplicate");
    }

    // Match sender to profile
    let profileId: string | null = null;
    if (senderPhone && !isGroup) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: matchedProfile } = await (admin.from("profiles") as any)
        .select("id")
        .or(`whatsapp.eq.${senderPhone},phone.eq.${senderPhone}`)
        .eq("is_admin", false)
        .limit(1)
        .maybeSingle();
      profileId = (matchedProfile as { id: string } | null)?.id ?? null;
    }

    // Find or create conversation
    let conversationId: string | null = null;

    if (chatId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: byChatId } = await (admin.from("conversations") as any)
        .select("id")
        .eq("unipile_chat_id", chatId)
        .maybeSingle();
      conversationId = (byChatId as { id: string } | null)?.id ?? null;
    }

    if (!conversationId && profileId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (admin.from("conversations") as any)
        .select("id")
        .eq("profile_id", profileId)
        .eq("channel", "whatsapp")
        .eq("status", "open")
        .maybeSingle();
      conversationId = (existing as { id: string } | null)?.id ?? null;
    }

    if (!conversationId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newConvo } = await (admin.from("conversations") as any)
        .insert({
          profile_id: profileId,
          channel: "whatsapp",
          status: "open",
          unipile_chat_id: chatId || null,
          subject: isGroup ? senderName || chatId : senderPhone || null,
          is_group: isGroup,
          group_name: isGroup ? senderName || null : null,
        })
        .select("id")
        .single();
      conversationId = (newConvo as { id: string } | null)?.id ?? null;
    }

    if (!conversationId) return ok("conversation failed");

    // Update group info if needed
    if (isGroup && chatId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("conversations") as any)
        .update({ is_group: true, ...(senderName ? { group_name: senderName } : {}) })
        .eq("id", conversationId);
    }

    // Download attachments
    let mediaUrl: string | null = null;
    let contentType: "text" | "image" | "audio" | "video" | "file" = "text";

    if (hasAttachments && externalMessageId) {
      const att = rawAttachments[0];
      const stored = await downloadAndStoreAttachment(
        externalMessageId,
        att.id,
        conversationId,
      );
      if (stored) {
        mediaUrl = stored.url;
        contentType = stored.contentType;
      } else if (att.type) {
        contentType = detectContentType(att.type);
      }
    }

    if (contentType === "text" && hasAttachments) {
      const attType = rawAttachments[0]?.type || "";
      if (attType) contentType = detectContentType(attType);
    }

    const preview = messageText.slice(0, 100) || (hasAttachments ? "📎 Anexo" : "");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insertedMsg } = await (admin.from("inbox_messages") as any)
      .insert({
        conversation_id: conversationId,
        direction: "inbound",
        sender: "contact",
        sender_name: senderName || null,
        body: messageText || null,
        media_url: mediaUrl,
        content_type: contentType,
        status: "sent",
        metadata: {
          sender_phone: senderPhone,
          sender_name: senderName,
          external_id: externalMessageId,
          chat_id: chatId,
        },
      })
      .select("id")
      .single();

    // Update conversation
    const { data: currentConvo } = await admin
      .from("conversations")
      .select("unread_count, ai_handling")
      .eq("id", conversationId)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("conversations") as any)
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
        unread_count:
          ((currentConvo as { unread_count: number } | null)?.unread_count ?? 0) + 1,
        ...(chatId ? { unipile_chat_id: chatId } : {}),
      })
      .eq("id", conversationId);

    // Queue AI takeover if enabled
    const aiHandling =
      (currentConvo as { ai_handling: boolean } | null)?.ai_handling ?? false;
    if (aiHandling && ch.auto_reply_enabled && insertedMsg && !isGroup) {
      const delay = ch.auto_reply_delay_seconds || 120;
      const scheduledAt = new Date(Date.now() + delay * 1000).toISOString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingQueue } = await (admin.from("ai_takeover_queue") as any)
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("status", "pending")
        .maybeSingle();

      if (!existingQueue) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("ai_takeover_queue") as any).insert({
          conversation_id: conversationId,
          message_id: (insertedMsg as { id: string }).id,
          status: "pending",
          scheduled_at: scheduledAt,
        });
      }
    }

    return ok("message_received");
  }

  return ok("unhandled");
}
