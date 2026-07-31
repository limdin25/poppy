import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { markConversationRead } from "@/lib/data/inbox";

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

  const { conversationId } = (await req.json()) as { conversationId: string };

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId é obrigatório" }, { status: 400 });
  }

  await markConversationRead(conversationId);

  return NextResponse.json({ ok: true });
}
