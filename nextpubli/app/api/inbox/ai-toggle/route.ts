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

  const { conversationId, enabled } = (await req.json()) as {
    conversationId: string;
    enabled: boolean;
  };

  if (!conversationId || typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "conversationId e enabled obrigatórios" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("conversations") as any)
    .update({ ai_handling: enabled })
    .eq("id", conversationId);

  return NextResponse.json({ ok: true });
}
