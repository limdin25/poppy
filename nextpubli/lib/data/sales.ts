import { createClient } from "@/lib/supabase/server";
import type { HotmartSale } from "@/types/database";

export async function getSalesByProfile(profileId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("hotmart_sales")
    .select("*")
    .eq("profile_id", profileId)
    .order("sold_at", { ascending: false });
  return (data as HotmartSale[] | null) ?? [];
}

export async function getAllSales() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("hotmart_sales")
    .select("*")
    .order("sold_at", { ascending: false });
  return (data as HotmartSale[] | null) ?? [];
}

export async function getSalesStats() {
  const supabase = await createClient();
  const { data } = await supabase.from("hotmart_sales").select("*");
  const sales = (data as HotmartSale[] | null) ?? [];

  const totalRevenue = sales.reduce((sum, s) => sum + s.sale_amount, 0);
  const totalCommission = sales.reduce((sum, s) => sum + s.commission_amount, 0);

  return { totalRevenue, totalCommission, totalSales: sales.length };
}

export async function getSalesByInfluencer() {
  const supabase = await createClient();
  const { data: salesData } = await supabase.from("hotmart_sales").select("*");
  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("is_admin", false);

  const sales = (salesData as HotmartSale[] | null) ?? [];
  const profiles =
    (profilesData as { id: string; first_name: string; last_name: string }[] | null) ??
    [];

  if (sales.length === 0 || profiles.length === 0) return [];

  const byProfile = new Map<string, { totalSales: number; totalCommission: number }>();
  for (const sale of sales) {
    const existing = byProfile.get(sale.profile_id) ?? {
      totalSales: 0,
      totalCommission: 0,
    };
    existing.totalSales += 1;
    existing.totalCommission += sale.commission_amount;
    byProfile.set(sale.profile_id, existing);
  }

  return profiles
    .filter((p) => byProfile.has(p.id))
    .map((p) => ({
      profileId: p.id,
      name: `${p.first_name} ${p.last_name}`,
      ...byProfile.get(p.id)!,
    }));
}
