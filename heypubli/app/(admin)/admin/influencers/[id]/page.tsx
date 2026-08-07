import { notFound } from "next/navigation";
import { AdminInfluencerDetail } from "@/features/admin-influencers";
import {
  getProfileById,
  getInstagramConnection,
  getPostsByProfile,
  getInfluencerSectors,
  getAllSectors,
} from "@/lib/data";
import { getOutstandConnection } from "@/lib/data/outstand";

export default async function InfluencerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getProfileById(id);
  if (!profile) notFound();

  const [instagram, outstand, posts, influencerSectors, allSectors] = await Promise.all([
    getInstagramConnection(id),
    getOutstandConnection(id),
    getPostsByProfile(id),
    getInfluencerSectors(id),
    getAllSectors(),
  ]);

  const sectorMap = new Map(allSectors.map((s) => [s.id, s.name]));
  const sectorNames = influencerSectors.map(
    (is) => sectorMap.get(is.sector_id) ?? is.sector_id,
  );

  return (
    <AdminInfluencerDetail
      profile={profile}
      instagram={instagram}
      outstand={outstand}
      posts={posts}
      sectors={sectorNames}
    />
  );
}
