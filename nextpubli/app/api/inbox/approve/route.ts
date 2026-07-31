import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppMessage, sendToExistingChat } from "@/lib/integrations/unipile";

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

  const { messageId } = (await req.json()) as { messageId: string };
  if (!messageId)
    return NextResponse.json({ error: "messageId obrigatório" }, { status: 400 });

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: msg } = await (admin.from("inbox_messages") as any)
    .select("id, body, conversation_id, status")
    .eq("id", messageId)
    .single();

  if (!msg || (msg as { status: string }).status !== "draft") {
    return NextResponse.json({ error: "Rascunho não encontrado" }, { status: 404 });
  }

  const m = msg as {
    id: string;
    body: string;
    conversation_id: string;
    status: string;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conv } = await (admin.from("conversations") as any)
    .select("id, profile_id, unipile_chat_id")
    .eq("id", m.conversation_id)
    .single();

  if (!conv)
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

  const conversation = conv as {
    id: string;
    profile_id: string | null;
    unipile_chat_id: string | null;
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

  if (!accountId)
    return NextResponse.json({ error: "Nenhum WhatsApp conectado" }, { status: 400 });

  // Send via Unipile
  if (conversation.unipile_chat_id) {
    await sendToExistingChat(conversation.unipile_chat_id, m.body);
  } else if (conversation.profile_id) {
    const { data: contact } = await admin
      .from("profiles")
      .select("whatsapp, phone")
      .eq("id", conversation.profile_id)
      .single();
    const recipientPhone =
      (contact as { whatsapp: string | null; phone: string | null } | null)?.whatsapp ||
      (contact as { whatsapp: string | null; phone: string | null } | null)?.phone;
    if (recipientPhone) {
      await sendWhatsAppMessage(accountId, recipientPhone, m.body);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("inbox_messages") as any)
    .update({ status: "sent" })
    .eq("id", messageId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("conversations") as any)
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: m.body.slice(0, 100),
    })
    .eq("id", conversation.id);

  return NextResponse.json({ ok: true });
}
