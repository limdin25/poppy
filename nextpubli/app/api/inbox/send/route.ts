import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendWhatsAppMessage,
  sendToExistingChat,
  sendMessageWithAttachment,
  sendAttachmentToChat,
} from "@/lib/integrations/unipile";

export async function POST(req: Request) {
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

  let conversationId: string | undefined;
  let body: string | undefined;
  let attachmentFile: {
    buffer: ArrayBuffer;
    name: string;
    type: string;
  } | null = null;

  const contentTypeHeader = req.headers.get("content-type") || "";

  if (contentTypeHeader.includes("multipart/form-data")) {
    const formData = await req.formData();
    conversationId = formData.get("conversationId") as string;
    body = formData.get("body") as string;
    const file = formData.get("attachment") as File | null;
    if (file) {
      attachmentFile = {
        buffer: await file.arrayBuffer(),
        name: file.name,
        type: file.type,
      };
    }
  } else {
    const json = (await req.json()) as {
      conversationId: string;
      body: string;
    };
    conversationId = json.conversationId;
    body = json.body;
  }

  if (!conversationId || !body) {
    return NextResponse.json(
      { error: "conversationId e body são obrigatórios" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: convo } = await (admin.from("conversations") as any)
    .select("id, profile_id, channel, unipile_chat_id, is_group")
    .eq("id", conversationId)
    .single();

  if (!convo)
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

  const conv = convo as {
    id: string;
    profile_id: string | null;
    channel: string;
    unipile_chat_id: string | null;
    is_group: boolean;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: channel } = await (admin.from("channels") as any)
    .select("id, unipile_account_id")
    .eq("type", "whatsapp")
    .eq("status", "connected")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const accountId = (channel as { unipile_account_id: string | null } | null)
    ?.unipile_account_id;

  if (!accountId) {
    return NextResponse.json(
      { error: "Nenhum WhatsApp conectado. Conecte em Configurações." },
      { status: 400 },
    );
  }

  let externalId: string | null = null;

  if (conv.unipile_chat_id) {
    if (attachmentFile) {
      externalId = await sendAttachmentToChat(conv.unipile_chat_id, body, attachmentFile);
    } else {
      externalId = await sendToExistingChat(conv.unipile_chat_id, body);
    }
  } else {
    const profileId = conv.profile_id;
    if (!profileId) {
      return NextResponse.json({ error: "Sem contato na conversa" }, { status: 400 });
    }

    const { data: contactProfile } = await admin
      .from("profiles")
      .select("whatsapp, phone")
      .eq("id", profileId)
      .single();

    const recipientPhone =
      (
        contactProfile as {
          whatsapp: string | null;
          phone: string | null;
        } | null
      )?.whatsapp ||
      (
        contactProfile as {
          whatsapp: string | null;
          phone: string | null;
        } | null
      )?.phone;

    if (!recipientPhone) {
      return NextResponse.json(
        { error: "Contato sem número de WhatsApp" },
        { status: 400 },
      );
    }

    if (attachmentFile) {
      externalId = await sendMessageWithAttachment(
        accountId,
        recipientPhone,
        body,
        attachmentFile,
      );
    } else {
      externalId = await sendWhatsAppMessage(accountId, recipientPhone, body);
    }
  }

  // Upload attachment to storage for our records
  let mediaUrl: string | null = null;
  let msgContentType: "text" | "image" | "audio" | "video" | "file" = "text";

  if (attachmentFile) {
    const { detectContentType } = await import("@/lib/integrations/storage");
    msgContentType = detectContentType(attachmentFile.type);

    const ext = attachmentFile.name.split(".").pop() || "bin";
    const path = `${conversationId}/sent_${Date.now()}.${ext}`;
    const { error } = await admin.storage
      .from("media")
      .upload(path, attachmentFile.buffer, {
        contentType: attachmentFile.type,
        upsert: true,
      });

    if (!error) {
      const { data: urlData } = admin.storage.from("media").getPublicUrl(path);
      mediaUrl = urlData.publicUrl;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: msg } = await (admin.from("inbox_messages") as any)
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      sender: "admin",
      body,
      media_url: mediaUrl,
      content_type: msgContentType,
      status: "sent",
      metadata: { external_id: externalId, via: "unipile" },
    })
    .select("id")
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("conversations") as any)
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 100),
      unread_count: 0,
    })
    .eq("id", conversationId);

  return NextResponse.json({
    ok: true,
    message_id: (msg as { id: string } | null)?.id,
    external_id: externalId,
  });
}
