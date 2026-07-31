import { AdminHotmart } from "@/features/admin-hotmart";
import { getAllSales, getSalesStats, getSalesByInfluencer } from "@/lib/data";

export default async function HotmartPage() {
  const [sales, stats, byInfluencer] = await Promise.all([
    getAllSales(),
    getSalesStats(),
    getSalesByInfluencer(),
  ]);

  return (
    <AdminHotmart
      sales={sales}
      byInfluencer={byInfluencer}
      totalRevenue={stats.totalRevenue}
      totalCommission={stats.totalCommission}
    />
  );
}
