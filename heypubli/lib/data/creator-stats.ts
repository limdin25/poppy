// The numbers behind /admin/stats.
//
// Hugo, 08 Aug 2026: "we should see all the creators there, filter by
// creators, all the videos that are posted, the amount of views, views per
// creator... most viewed video... all type of filters there", plus "how many
// followers, people following etc, how many followers gained."
//
// WHAT IS AND IS NOT AVAILABLE, because it shapes everything here. Outstand
// reports metrics per ACCOUNT, never per post: there is no /posts/{id}/metrics
// (404) and the post payload carries no view count. So "views" is a creator's
// whole-account figure, NOT the views on one video, and no amount of UI can
// turn one into the other. What we do know per post is who posted which master,
// when, and its Instagram permalink.
//
// Growth is likewise not a field anywhere. It is the gap between two readings,
// which is why creator_metrics_snapshots exists and why history only starts the
// first time the capture cron runs.

import { createAdminClient } from "@/lib/supabase/admin";
import { getInstagramMetrics } from "@/lib/integrations/outstand";

export interface MetricsSnapshot {
  profile_id: string;
  captured_at: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  accounts_engaged: number | null;
  total_interactions: number | null;
}

export interface StatsAccount {
  profileId: string;
  igUsername: string | null;
  firstName: string;
  isConnected: boolean;
  connectedAt: string | null;
}

export interface StatsPost {
  profileId: string;
  masterSeq: number | null;
  masterTitle: string | null;
  publishedAt: string | null;
  status: string;
  platformPostUrl: string | null;
}

export interface StatsInput {
  accounts: StatsAccount[];
  snapshots: MetricsSnapshot[];
  posts: StatsPost[];
}

export interface CreatorStatsRow {
  profileId: string;
  igUsername: string | null;
  firstName: string;
  isConnected: boolean;
  connectedAt: string | null;
  measuredAt: string | null;
  followers: number | null;
  following: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  /** Null, not zero, when there is no earlier reading to compare against. */
  followersGained24h: number | null;
  followersGained7d: number | null;
  postsPublished: number;
  posts: StatsPost[];
}

const H = 60 * 60 * 1000;

/** The newest reading at or before `at`, or null. */
function readingBefore(rows: MetricsSnapshot[], at: number): MetricsSnapshot | null {
  let best: MetricsSnapshot | null = null;
  for (const r of rows) {
    const t = Date.parse(r.captured_at);
    if (t <= at && (!best || t > Date.parse(best.captured_at))) best = r;
  }
  return best;
}

export function buildCreatorStats(input: StatsInput, now: Date): CreatorStatsRow[] {
  const byProfile = new Map<string, MetricsSnapshot[]>();
  for (const s of input.snapshots) {
    const list = byProfile.get(s.profile_id) ?? [];
    list.push(s);
    byProfile.set(s.profile_id, list);
  }

  const postsBy = new Map<string, StatsPost[]>();
  for (const p of input.posts) {
    const list = postsBy.get(p.profileId) ?? [];
    list.push(p);
    postsBy.set(p.profileId, list);
  }

  return input.accounts.map((a) => {
    const rows = (byProfile.get(a.profileId) ?? [])
      .slice()
      .sort((x, y) => Date.parse(y.captured_at) - Date.parse(x.captured_at));
    const latest = rows[0] ?? null;

    // A gain needs a genuine earlier reading. Falling back to the latest row
    // would report 0 and read as "flat", a different claim from "unmeasured".
    const gain = (hours: number): number | null => {
      if (!latest || latest.followers == null) return null;
      const cutoff = now.getTime() - hours * H;
      const earlier = readingBefore(rows, cutoff);
      if (!earlier || earlier.followers == null) return null;
      if (earlier.captured_at === latest.captured_at) return null;
      return latest.followers - earlier.followers;
    };

    const posts = (postsBy.get(a.profileId) ?? [])
      .slice()
      .sort((x, y) => (y.publishedAt ?? "").localeCompare(x.publishedAt ?? ""));

    return {
      profileId: a.profileId,
      igUsername: a.igUsername,
      firstName: a.firstName,
      isConnected: a.isConnected,
      connectedAt: a.connectedAt,
      measuredAt: latest?.captured_at ?? null,
      followers: latest?.followers ?? null,
      following: latest?.following ?? null,
      views: latest?.views ?? null,
      likes: latest?.likes ?? null,
      comments: latest?.comments ?? null,
      shares: latest?.shares ?? null,
      saves: latest?.saves ?? null,
      reach: latest?.reach ?? null,
      followersGained24h: gain(24),
      followersGained7d: gain(24 * 7),
      postsPublished: posts.filter((p) => p.status === "published").length,
      posts,
    };
  });
}

export interface StatsSummary {
  creators: number;
  /** How many of them we actually have a reading for. The rest are not zeros. */
  measured: number;
  followers: number;
  following: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
  followersGained24h: number;
  postsPublished: number;
}

export function summarise(rows: CreatorStatsRow[]): StatsSummary {
  const add = (f: (r: CreatorStatsRow) => number | null) =>
    rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  return {
    creators: rows.length,
    measured: rows.filter((r) => r.measuredAt).length,
    followers: add((r) => r.followers),
    following: add((r) => r.following),
    views: add((r) => r.views),
    likes: add((r) => r.likes),
    comments: add((r) => r.comments),
    shares: add((r) => r.shares),
    saves: add((r) => r.saves),
    reach: add((r) => r.reach),
    followersGained24h: add((r) => r.followersGained24h),
    postsPublished: add((r) => r.postsPublished),
  };
}

// ---- loading and capture ---------------------------------------------------

export async function loadCreatorStats(now = new Date()): Promise<CreatorStatsRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // A week of history is all the page needs; keeping the query bounded stops it
  // growing into a full-table read as the snapshot count climbs.
  const since = new Date(now.getTime() - 8 * 24 * H).toISOString();

  const [conns, profiles, snaps, posts, masters] = await Promise.all([
    admin.from("outstand_connections").select("profile_id, ig_username, is_connected, created_at"),
    admin.from("profiles").select("id, first_name"),
    admin
      .from("creator_metrics_snapshots")
      .select("*")
      .gte("captured_at", since)
      .order("captured_at", { ascending: false }),
    admin
      .from("scheduled_posts")
      .select("profile_id, status, published_at, platform_post_url, master_video_id")
      .not("master_video_id", "is", null),
    admin.from("master_videos").select("id, seq, title"),
  ]);

  const nameBy = new Map<string, string>(
    ((profiles.data ?? []) as Array<{ id: string; first_name: string | null }>).map((p) => [
      p.id,
      p.first_name ?? "",
    ]),
  );
  const masterBy = new Map<string, { seq: number; title: string | null }>(
    ((masters.data ?? []) as Array<{ id: string; seq: number; title: string | null }>).map((m) => [
      m.id,
      m,
    ]),
  );

  const input: StatsInput = {
    accounts: ((conns.data ?? []) as Array<{
      profile_id: string;
      ig_username: string | null;
      is_connected: boolean;
      created_at: string | null;
    }>).map((c) => ({
      profileId: c.profile_id,
      igUsername: c.ig_username,
      firstName: nameBy.get(c.profile_id) ?? "",
      isConnected: Boolean(c.is_connected),
      connectedAt: c.created_at,
    })),
    snapshots: (snaps.data ?? []) as MetricsSnapshot[],
    posts: ((posts.data ?? []) as Array<{
      profile_id: string;
      status: string;
      published_at: string | null;
      platform_post_url: string | null;
      master_video_id: string;
    }>).map((p) => {
      const m = masterBy.get(p.master_video_id);
      return {
        profileId: p.profile_id,
        masterSeq: m?.seq ?? null,
        masterTitle: m?.title ?? null,
        publishedAt: p.published_at,
        status: p.status,
        platformPostUrl: p.platform_post_url,
      };
    }),
  };

  return buildCreatorStats(input, now).sort(
    (a, b) => (b.followers ?? -1) - (a.followers ?? -1),
  );
}

/** Read every connected account's numbers and store one row each.
 *  Best effort per account: one bad account must not lose the whole sweep. */
export async function captureCreatorMetrics(): Promise<{ captured: number; skipped: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: settings } = await admin
    .from("posting_settings")
    .select("outstand_api_key")
    .limit(1);
  const apiKey = (settings ?? [])[0]?.outstand_api_key as string | undefined;
  if (!apiKey) return { captured: 0, skipped: 0 };

  const { data: conns } = await admin
    .from("outstand_connections")
    .select("profile_id, outstand_social_account_id")
    .eq("is_connected", true);

  let captured = 0;
  let skipped = 0;
  for (const c of (conns ?? []) as Array<{
    profile_id: string;
    outstand_social_account_id: string | null;
  }>) {
    if (!c.outstand_social_account_id) {
      skipped++;
      continue;
    }
    try {
      const m = await getInstagramMetrics(apiKey, c.outstand_social_account_id);
      if (!m) {
        skipped++;
        continue;
      }
      const { error } = await admin.from("creator_metrics_snapshots").insert({
        profile_id: c.profile_id,
        followers: m.followersCount,
        following: m.followingCount,
        posts: m.postsCount,
        views: m.engagement.views,
        likes: m.engagement.likes,
        comments: m.engagement.comments,
        shares: m.engagement.shares,
        saves: m.engagement.saves,
        reach: m.engagement.reach,
        accounts_engaged: m.engagement.accountsEngaged,
        total_interactions: m.engagement.totalInteractions,
      });
      if (error) {
        console.error("[creator-stats] insert failed", c.profile_id, error.message);
        skipped++;
      } else {
        captured++;
      }
    } catch (err) {
      console.error("[creator-stats] metrics failed", c.profile_id, err);
      skipped++;
    }
  }
  return { captured, skipped };
}
