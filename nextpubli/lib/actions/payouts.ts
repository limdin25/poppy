"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { availableBalance, type ClearableSale } from "@/lib/payouts";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

type SaleRow = ClearableSale & { id: string; commission_amount: number };

/**
 * Influencer requests payout of their cleared balance. Race-safe: it creates a
 * 'requested' payout, then atomically claims only sales still unclaimed
 * (`payout_id IS NULL`), so two concurrent requests can never pay the same sale
 * twice. The payout total is computed from the sales actually claimed.
 */
export async function requestPayout(): Promise<
  { error: string } | { success: true; amount: number }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Service-role (RLS-bypassing); we only ever act on the caller's own rows.
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("pix_key, pix_key_type")
    .eq("id", user.id)
    .single<{ pix_key: string | null; pix_key_type: string | null }>();

  if (!profile?.pix_key) {
    return { error: "Cadastre sua chave PIX antes de solicitar o pagamento." };
  }

  const { data: salesData } = await admin
    .from("hotmart_sales")
    .select("id, commission_amount, status, payout_id, purchase_complete_at, sold_at")
    .eq("profile_id", user.id)
    .eq("status", "confirmed")
    .is("payout_id", null);

  const { saleIds } = availableBalance((salesData as SaleRow[] | null) ?? []);
  if (saleIds.length === 0) {
    return { error: "Nenhum valor disponível para saque ainda." };
  }

  // Create the payout row first so we have an id to claim sales with.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: payout, error } = await (admin.from("payouts") as any)
    .insert({
      profile_id: user.id,
      commission_amount: 0,
      sales_count: 0,
      status: "requested",
      pix_key: profile.pix_key,
      pix_key_type: profile.pix_key_type,
    })
    .select("id")
    .single();

  if (error || !payout) {
    return { error: "Não foi possível solicitar o pagamento. Tente novamente." };
  }
  const payoutId = (payout as { id: string }).id;

  // Claim ONLY sales still unclaimed — `is("payout_id", null)` serializes concurrent
  // requests at the row level, so each sale is settled by exactly one payout.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed } = await (admin.from("hotmart_sales") as any)
    .update({ payout_id: payoutId })
    .in("id", saleIds)
    .is("payout_id", null)
    .select("commission_amount");

  const claimedRows = (claimed as { commission_amount: number }[] | null) ?? [];
  if (claimedRows.length === 0) {
    // Lost the race (another request already claimed these) — roll back the empty payout.
    await admin.from("payouts").delete().eq("id", payoutId);
    return { error: "Você já tem uma solicitação de pagamento em andamento." };
  }

  // Set the payout total from what we actually claimed (never the pre-read estimate).
  const amount =
    Math.round(claimedRows.reduce((s, r) => s + Number(r.commission_amount), 0) * 100) /
    100;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("payouts") as any)
    .update({ commission_amount: amount, sales_count: claimedRows.length })
    .eq("id", payoutId);

  revalidatePath("/vendas");
  revalidatePath("/dashboard");
  return { success: true, amount };
}
