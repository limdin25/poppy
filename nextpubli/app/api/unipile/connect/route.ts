import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHostedLink } from "@/lib/integrations/unipile";

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://nextpubli.com";

  try {
    const { url } = await createHostedLink({
      successUrl: `${appUrl}/admin/mensagens?whatsapp=connected`,
      failureUrl: `${appUrl}/admin/mensagens?whatsapp=failed`,
      notifyUrl: `${appUrl}/api/webhooks/unipile`,
      label: `NextPubli-${user.id.slice(0, 8)}`,
    });

    const admin = createAdminClient();
    // Reuse an existing placeholder instead of stacking one per modal open.
    const { data: pending } = await admin
      .from("channels")
      .select("id")
      .eq("type", "whatsapp")
      .eq("status", "disconnected")
      .is("unipile_account_id", null)
      .limit(1)
      .maybeSingle();
    if (!pending) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("channels") as any).insert({
        type: "whatsapp",
        status: "disconnected",
        label: "Aguardando scan...",
      });
    }

    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao conectar";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
