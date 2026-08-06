import { createClient } from "@/lib/supabase/server";
import { availableBalance, pendingReleases, type ClearableSale } from "@/lib/payouts";
import type { Payout } from "@/types/database";

type SaleRow = ClearableSale & { id: string; commission_amount: number };

const CLEARABLE_COLUMNS =
  "id, commission_amount, status, payout_id, purchase_complete_at, sold_at";

/** An influencer's cleared, not-yet-requested commission available to withdraw. */
export async function getAvailableBalance(profileId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("hotmart_sales")
    .select(CLEARABLE_COLUMNS)
    .eq("profile_id", profileId)
    .eq("status", "confirmed")
    .is("payout_id", null);
  return availableBalance((data as SaleRow[] | null) ?? []);
}

/**
 * One query → both the withdrawable balance AND the upcoming releases (commissions
 * still in the 21-day hold, grouped by the date each unlocks).
 */
export async function getPayoutSummary(profileId: string): Promise<{
  available: ReturnType<typeof availableBalance>;
  pending: ReturnType<typeof pendingReleases>;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("hotmart_sales")
    .select(CLEARABLE_COLUMNS)
    .eq("profile_id", profileId)
    .eq("status", "confirmed")
    .is("payout_id", null);
  const rows = (data as SaleRow[] | null) ?? [];
  return { available: availableBalance(rows), pending: pendingReleases(rows) };
}

export async function getPayoutsByProfile(profileId: string): Promise<Payout[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payouts")
    .select("*")
    .eq("profile_id", profileId)
    .order("requested_at", { ascending: false });
  return (data as Payout[] | null) ?? [];
}

export async function getAllPayouts(): Promise<Payout[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payouts")
    .select("*")
    .order("requested_at", { ascending: false });
  return (data as Payout[] | null) ?? [];
}

/** Admin view: open payout requests with the influencer's name attached. */
export async function getPendingPayoutRequests(): Promise<(Payout & { name: string })[]> {
  const supabase = await createClient();
  const { data: payouts } = await supabase
    .from("payouts")
    .select("*")
    .eq("status", "requested")
    .order("requested_at", { ascending: true });
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name");

  const names = new Map<string, string>();
  for (const p of (profiles as
    | { id: string; first_name: string; last_name: string }[]
    | null) ?? []) {
    names.set(p.id, `${p.first_name} ${p.last_name}`.trim());
  }
  return ((payouts as Payout[] | null) ?? []).map((p) => ({
    ...p,
    name: names.get(p.profile_id) ?? "—",
  }));
}
