import { AdminVideos } from "@/features/admin-videos";
import { getVideoPipelineOverview } from "@/lib/data/video-pipeline-admin";

// Hugo's authorization page for the creator video pipeline: watch each master,
// see which accounts it goes to (each with its own color) and exactly when,
// approve, and upload the next one. The cron and the Mac render worker do
// everything else.
export default async function AdminVideosPage() {
  const overview = await getVideoPipelineOverview();
  return <AdminVideos overview={overview} />;
}
