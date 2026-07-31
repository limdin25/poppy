import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    .select("id, status, conversation_id")
    .eq("id", messageId)
    .single();

  if (!msg || (msg as { status: string }).status !== "draft") {
    return NextResponse.json({ error: "Rascunho não encontrado" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("inbox_messages") as any).delete().eq("id", messageId);

  // Cancel any pending AI queue for this conversation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("ai_takeover_queue") as any)
    .update({ status: "cancelled", processed_at: new Date().toISOString() })
    .eq("conversation_id", (msg as { conversation_id: string }).conversation_id)
    .eq("status", "pending");

  return NextResponse.json({ ok: true });
}
