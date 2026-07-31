import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardAnalytics } from "@/features/dashboard-analytics";
import {
  getSalesByProfile,
  getPostsByProfile,
  getClickCountByProfile,
  getPayoutSummary,
} from "@/lib/data";
import type { HotmartSale } from "@/types/database";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const dynamic = "force-dynamic";

function groupSalesByMonth(sales: HotmartSale[]) {
  const byMonth = new Map<string, { sales: number; commission: number }>();

  for (const sale of sales) {
    const date = new Date(sale.sold_at);
    const key = format(date, "MMMM yyyy", { locale: ptBR });
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    const existing = byMonth.get(label) ?? { sales: 0, commission: 0 };
    existing.sales += 1;
    existing.commission += sale.commission_amount;
    byMonth.set(label, existing);
  }

  return Array.from(byMonth.entries()).map(([month, data]) => ({
    month,
    sales: data.sales,
    commission: data.commission,
  }));
}

export default async function VendasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [sales, posts, profileResult, affiliateClicks, payout] = await Promise.all([
    getSalesByProfile(user.id),
    getPostsByProfile(user.id),
    supabase
      .from("profiles")
      .select("pix_key_type, pix_key")
      .eq("id", user.id)
      .single<{ pix_key_type: string | null; pix_key: string | null }>(),
    getClickCountByProfile(user.id),
    getPayoutSummary(user.id),
  ]);

  const totalSales = sales.length;
  const totalCommission = sales.reduce((sum, s) => sum + s.commission_amount, 0);

  const lastPublished = posts.find((p) => p.status === "published" && p.published_at);
  const lastPublishedAt = lastPublished
    ? format(new Date(lastPublished.published_at!), "dd/MM/yyyy")
    : null;

  const monthlySales = groupSalesByMonth(sales);

  return (
    <DashboardAnalytics
      totalSales={totalSales}
      totalCommission={totalCommission}
      affiliateClicks={affiliateClicks}
      availableBalance={payout.available.amount}
      pendingReleases={payout.pending}
      lastPublishedAt={lastPublishedAt}
      monthlySales={monthlySales}
      pixKeyType={profileResult.data?.pix_key_type ?? null}
      pixKey={profileResult.data?.pix_key ?? null}
    />
  );
}
