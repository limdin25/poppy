import { createClient } from "@/lib/supabase/server";
import type { Sector } from "@/types/database";

export async function getAllSectors(): Promise<Sector[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sectors")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  return (data as Sector[] | null) ?? [];
}

export async function getInfluencerSectors(
  profileId: string,
): Promise<{ sector_id: string; type: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("influencer_sectors")
    .select("sector_id, type")
    .eq("profile_id", profileId);
  return (data as { sector_id: string; type: string }[] | null) ?? [];
}
