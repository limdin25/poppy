import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAIReply } from "@/lib/ai/reply";
import { sendWhatsAppMessage } from "@/lib/integrations/unipile";

const CRON_SECRET = process.env.CRON_SECRET || "";

export async function GET(req: Request) {
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const now = new Date();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pending } = await (admin.from("ai_takeover_queue") as any)
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (!pending || (pending as unknown[]).length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let processed = 0;
  let ownerReplied = 0;
  let aiReplied = 0;

  for (const entry of pending as Array<{
    id: string;
    conversation_id: string;
    message_id: string | null;
    grace_checked_at: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }>) {
    // Check if admin replied since message was received
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ownerReply } = await (admin.from("inbox_messages") as any)
      .select("id")
      .eq("conversation_id", entry.conversation_id)
      .eq("direction", "outbound")
      .in("sender", ["admin", "human"])
      .gt("created_at", entry.created_at)
      .limit(1)
      .maybeSingle();

    if (ownerReply) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("ai_takeover_queue") as any)
        .update({
          status: "owner_replied",
          processed_at: now.toISOString(),
        })
        .eq("id", entry.id);
      ownerReplied++;
      processed++;
      continue;
    }

    // Grace period — first pass: push back 60s
    if (!entry.grace_checked_at) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("ai_takeover_queue") as any)
        .update({
          grace_checked_at: now.toISOString(),
          scheduled_at: new Date(now.getTime() + 60 * 1000).toISOString(),
        })
        .eq("id", entry.id);
      processed++;
      continue;
    }

    // Check conversation still has AI enabled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: conversation } = await (admin.from("conversations") as any)
      .select("id, profile_id, ai_handling")
      .eq("id", entry.conversation_id)
      .single();

    if (!conversation || !(conversation as { ai_handling: boolean }).ai_handling) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("ai_takeover_queue") as any)
        .update({ status: "cancelled", processed_at: now.toISOString() })
        .eq("id", entry.id);
      processed++;
      continue;
    }

    // Get channel for draft_mode check
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: channel } = await (admin.from("channels") as any)
      .select("id, unipile_account_id, draft_mode")
      .eq("type", "whatsapp")
      .eq("status", "connected")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!channel) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("ai_takeover_queue") as any)
        .update({ status: "cancelled", processed_at: now.toISOString() })
        .eq("id", entry.id);
      processed++;
      continue;
    }

    const ch = channel as {
      id: string;
      unipile_account_id: string;
      draft_mode: boolean;
    };

    // Generate AI reply
    const reply = await generateAIReply(entry.conversation_id);
    if (!reply) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("ai_takeover_queue") as any)
        .update({ status: "cancelled", processed_at: now.toISOString() })
        .eq("id", entry.id);
      processed++;
      continue;
    }

    const draftMode = ch.draft_mode !== false;

    // If not draft mode, send immediately
    if (!draftMode) {
      const profileId = (conversation as { profile_id: string | null }).profile_id;
      if (profileId) {
        const { data: contact } = await admin
          .from("profiles")
          .select("whatsapp, phone")
          .eq("id", profileId)
          .single();
        const recipientPhone =
          (contact as { whatsapp: string | null; phone: string | null } | null)
            ?.whatsapp ||
          (contact as { whatsapp: string | null; phone: string | null } | null)?.phone;
        if (recipientPhone) {
          await sendWhatsAppMessage(ch.unipile_account_id, recipientPhone, reply);
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: aiMsg } = await (admin.from("inbox_messages") as any)
      .insert({
        conversation_id: entry.conversation_id,
        direction: "outbound",
        sender: "ai",
        body: reply,
        content_type: "text",
        status: draftMode ? "draft" : "sent",
        metadata: { via: "ai_takeover" },
      })
      .select("id")
      .single();

    if (!draftMode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("conversations") as any)
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: reply.slice(0, 100),
        })
        .eq("id", entry.conversation_id);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("ai_takeover_queue") as any)
      .update({
        status: "ai_replied",
        ai_reply_message_id: (aiMsg as { id: string } | null)?.id || null,
        processed_at: now.toISOString(),
      })
      .eq("id", entry.id);

    aiReplied++;
    processed++;
  }

  // Expire old pending entries (2+ hours old)
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("ai_takeover_queue") as any)
    .update({ status: "expired", processed_at: now.toISOString() })
    .eq("status", "pending")
    .lt("created_at", twoHoursAgo);

  return NextResponse.json({ ok: true, processed, ownerReplied, aiReplied });
}
