import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardSettings } from "@/features/dashboard-settings";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import { getInstagramConnection, getAllSectors, getInfluencerSectors } from "@/lib/data";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import type { Profile } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  const [instagram, sectors, influencerSectors, postingSettings] = await Promise.all([
    getInstagramConnection(user.id),
    getAllSectors(),
    getInfluencerSectors(user.id),
    getPostingSettingsAdmin(),
  ]);

  const selectedSectorIds = influencerSectors.map((is) => is.sector_id);
  const connectUrl =
    postingSettings?.active_provider === "outstand"
      ? "/api/outstand/connect"
      : "/api/instagram/connect";

  return (
    <DashboardSettings
      profile={profile as Profile}
      sectors={sectors}
      selectedSectors={selectedSectorIds}
      instagramConnected={!!instagram}
      instagramUsername={instagram ? `@${instagram.ig_username}` : null}
      connectUrl={connectUrl}
      instagramEnabled={INSTAGRAM_ENABLED}
    />
  );
}
