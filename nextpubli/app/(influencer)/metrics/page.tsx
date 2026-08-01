import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getInstagramConnection } from "@/lib/data/instagram";
import { getInstagramProfile, getInstagramMedia } from "@/lib/integrations/instagram";
import { getPostingSettingsAdmin, getOutstandInstagramData } from "@/lib/data/outstand";
import { DashboardMetrics } from "@/features/dashboard-metrics";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import type { ProfileMetrics } from "@/features/dashboard-metrics";

export const dynamic = "force-dynamic";

function buildMetrics(
  profile: {
    followers_count?: number;
    follows_count?: number;
    media_count: number;
  },
  media: {
    media_type: string;
    like_count?: number;
    comments_count?: number;
  }[],
): ProfileMetrics {
  const totalLikes = media.reduce((s, m) => s + (m.like_count ?? 0), 0);
  const totalComments = media.reduce((s, m) => s + (m.comments_count ?? 0), 0);
  const followers = profile.followers_count ?? 0;
  const engagement =
    followers > 0 && media.length > 0
      ? ((totalLikes + totalComments) / media.length / followers) * 100
      : 0;

  const typeMap: Record<string, { reach: number; engagement: number; count: number }> =
    {};
  for (const m of media) {
    const t =
      m.media_type === "CAROUSEL_ALBUM"
        ? "Carousel"
        : m.media_type === "REELS"
          ? "Reels"
          : m.media_type === "VIDEO"
            ? "Video"
            : "Image";
    if (!typeMap[t]) typeMap[t] = { reach: 0, engagement: 0, count: 0 };
    typeMap[t].reach += (m.like_count ?? 0) + (m.comments_count ?? 0);
    typeMap[t].count += 1;
    const e =
      followers > 0
        ? (((m.like_count ?? 0) + (m.comments_count ?? 0)) / followers) * 100
        : 0;
    typeMap[t].engagement += e;
  }

  const contentBreakdown = Object.entries(typeMap).map(([type, v]) => ({
    type: `${type} (${v.count})`,
    reach: v.reach,
    engagement: v.count > 0 ? v.engagement / v.count : 0,
  }));

  return {
    period: `Last ${media.length} posts`,
    reach: totalLikes + totalComments,
    reachChange: 0,
    views: 0,
    viewsChange: 0,
    engagement: Math.round(engagement * 10) / 10,
    engagementChange: 0,
    likes: totalLikes,
    comments: totalComments,
    shares: 0,
    saves: 0,
    newFollowers: 0,
    followersChange: 0,
    profileVisits: 0,
    topCities: [],
    topCountries: [],
    ageGender: [],
    contentBreakdown,
  };
}

export default async function MetricsPage() {
  // Instagram-only page — nothing to show while Instagram is hidden.
  if (!INSTAGRAM_ENABLED) redirect("/dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const postingSettings = await getPostingSettingsAdmin();
  const provider = postingSettings?.active_provider ?? "heypubli";
  const connectUrl =
    provider === "outstand" ? "/api/outstand/connect" : "/api/instagram/connect";

  // Outstand (analytics tier) exposes profile + engagement metrics.
  if (provider === "outstand") {
    const ig = await getOutstandInstagramData(user.id);
    let profileMetrics: ProfileMetrics[] = [];
    if (ig && ig.followersCount > 0) {
      const e = ig.engagement;
      const engagementRate = (e.totalInteractions / ig.followersCount) * 100;
      profileMetrics = [
        {
          period: "Last 30 days",
          reach: e.reach,
          reachChange: 0,
          views: e.views,
          viewsChange: 0,
          engagement: Math.round(engagementRate * 100) / 100,
          engagementChange: 0,
          likes: e.likes,
          comments: e.comments,
          shares: e.shares,
          saves: e.saves,
          newFollowers: 0,
          followersChange: 0,
          profileVisits: 0,
          topCities: [],
          topCountries: [],
          ageGender: [],
          contentBreakdown: [],
        },
      ];
    }
    return (
      <DashboardMetrics
        profileMetrics={profileMetrics}
        isConnected={!!ig}
        igUsername={ig?.username}
        connectUrl={connectUrl}
      />
    );
  }

  const igConnection = await getInstagramConnection(user.id);
  if (!igConnection) {
    return (
      <DashboardMetrics profileMetrics={[]} isConnected={false} connectUrl={connectUrl} />
    );
  }

  let profileMetrics: ProfileMetrics[] = [];

  try {
    const [igProfile, media] = await Promise.all([
      getInstagramProfile(igConnection.access_token),
      getInstagramMedia(igConnection.access_token, 50),
    ]);

    if (media.length > 0) {
      const limits = [5, 10, 25, 50].filter((n) => n <= media.length);
      profileMetrics = limits.map((n) => buildMetrics(igProfile, media.slice(0, n)));
    }
  } catch {
    // Token expired or API error — show connected but no data
  }

  return (
    <DashboardMetrics
      profileMetrics={profileMetrics}
      isConnected={true}
      igUsername={igConnection.ig_username}
      connectUrl={connectUrl}
    />
  );
}
