import { AdminStats } from "@/features/admin-stats";
import { loadCreatorStats } from "@/lib/data/creator-stats";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const rows = await loadCreatorStats();
  return <AdminStats rows={rows} />;
}
