import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccountStatus, toE164 } from "@/lib/integrations/unipile";
import { syncWhatsAppChannelStatuses } from "@/lib/data/inbox";

export async function GET(req: Request) {
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

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");

  // No accountId → reconcile every channel against Unipile and report whether
  // ANY WhatsApp is connected (used by the connect modal's polling).
  if (!accountId) {
    const channels = await syncWhatsAppChannelStatuses();
    const connected = channels.find(
      (c) => c.type === "whatsapp" && c.status === "connected",
    );
    return NextResponse.json({
      connected: Boolean(connected),
      phone: connected?.label ?? null,
    });
  }

  try {
    const { status, phone } = await getAccountStatus(accountId);
    const connected = status === "OK" || status === "CREATION_SUCCESS";

    if (connected) {
      const admin = createAdminClient();
      const phoneE164 = toE164(phone ?? "");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("channels") as any)
        .update({
          status: "connected",
          connected_at: new Date().toISOString(),
          label: phoneE164 || null,
          config: { phone: phoneE164, type: "WHATSAPP" },
        })
        .eq("unipile_account_id", accountId);
    }

    return NextResponse.json({ status, connected, phone: toE164(phone ?? "") });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro" },
      { status: 500 },
    );
  }
}
