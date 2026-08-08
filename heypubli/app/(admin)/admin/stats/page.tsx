import { AdminStats } from "@/features/admin-stats";
import { loadCreatorStats, loadViewsTimeline } from "@/lib/data/creator-stats";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const [rows, timeline] = await Promise.all([loadCreatorStats(), loadViewsTimeline()]);
  return <AdminStats rows={rows} timeline={timeline} />;
}
