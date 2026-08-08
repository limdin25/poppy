// The numbers behind /admin/stats.
//
// Hugo, 08 Aug 2026: "we should see all the creators there, filter by
// creators, all the videos that are posted, the amount of views, views per
// creator... most viewed video... all type of filters there", plus "how many
// followers, people following etc, how many followers gained."
//
// TWO KINDS OF VIEWS LIVE ON THIS PAGE AND THEY ARE NOT THE SAME NUMBER.
//
//   account views  everything that creator has ever posted, theirs and ours,
//                  straight off /social-accounts/{id}/metrics
//   our views      the sum of the videos WE published for them, built up from
//                  per-post readings in lib/data/post-metrics
//
// The second one is the one that says whether this pipeline is working, so both
// are shown side by side and labelled.
//
// A note here used to say per-post metrics did not exist. It was wrong, and the
// page said so on screen for a day. `/posts/{id}/metrics` and `/insights` 404,
// but `/posts/{id}/analytics` does not, and it serves views, likes, comments,
// shares, saves and reach per post.
//
// Growth is not a field anywhere, for a creator or for a video. It is the gap
// between two readings, which is why creator_metrics_snapshots and
// post_metrics_snapshots exist and why history only starts at the first capture.

import { createAdminClient } from "@/lib/supabase/admin";
import { getInstagramMetrics } from "@/lib/integrations/outstand";
import { buildPostMetricRows } from "@/lib/data/post-metrics";

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
  /** This video's own numbers. Null means never read, which is not zero. */
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  metricsCapturedAt: string | null;
  /** Movement since the newest reading at least 24h old, null if unmeasurable. */
  views24h: number | null;
  likes24h: number | null;
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
  /** Views on OUR videos only, summed. Null when none of them has been read
   *  yet, so a creator we have simply not measured is never shown as a zero. */
  ourViews: number | null;
  ourLikes: number | null;
  ourViews24h: number | null;
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

    // Sum only what has actually been read. A creator with three published
    // videos and no reading yet is unmeasured, not on zero views, so the sum
    // stays null until at least one of their videos has a number.
    const sumRead = (f: (p: StatsPost) => number | null): number | null => {
      const vals = posts.map(f).filter((v): v is number => v != null);
      return vals.length ? vals.reduce((n, v) => n + v, 0) : null;
    };

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
      ourViews: sumRead((p) => p.views),
      ourLikes: sumRead((p) => p.likes),
      ourViews24h: sumRead((p) => p.views24h),
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
  /** Our videos only, as opposed to `views` which is every account's lifetime. */
  ourViews: number;
  ourLikes: number;
  ourViews24h: number;
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
    ourViews: add((r) => r.ourViews),
    ourLikes: add((r) => r.ourLikes),
    ourViews24h: add((r) => r.ourViews24h),
  };
}

// ---- loading and capture ---------------------------------------------------

export async function loadCreatorStats(now = new Date()): Promise<CreatorStatsRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // A week of history is all the page needs; keeping the query bounded stops it
  // growing into a full-table read as the snapshot count climbs.
  const since = new Date(now.getTime() - 8 * 24 * H).toISOString();

  const [conns, profiles, snaps, posts, masters, postSnaps] = await Promise.all([
    admin.from("outstand_connections").select("profile_id, ig_username, is_connected, created_at"),
    admin.from("profiles").select("id, first_name"),
    admin
      .from("creator_metrics_snapshots")
      .select("*")
      .gte("captured_at", since)
      .order("captured_at", { ascending: false }),
    admin
      .from("scheduled_posts")
      .select(
        "id, profile_id, status, published_at, platform_post_url, master_video_id, views, likes, comments, shares, saves, reach, metrics_captured_at",
      )
      .not("master_video_id", "is", null),
    admin.from("master_videos").select("id, seq, title"),
    admin
      .from("post_metrics_snapshots")
      .select("post_id, captured_at, views, likes")
      .gte("captured_at", since)
      .order("captured_at", { ascending: false }),
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

  const deltas = buildPostMetricRows(
    ((posts.data ?? []) as Array<{ id: string }>).map((p) => ({ id: p.id })),
    (postSnaps.data ?? []) as Array<{ post_id: string; captured_at: string }>,
    now,
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
      id: string;
      profile_id: string;
      status: string;
      published_at: string | null;
      platform_post_url: string | null;
      master_video_id: string;
      views: number | null;
      likes: number | null;
      comments: number | null;
      shares: number | null;
      saves: number | null;
      reach: number | null;
      metrics_captured_at: string | null;
    }>).map((p) => {
      const m = masterBy.get(p.master_video_id);
      const d = deltas.get(p.id);
      return {
        profileId: p.profile_id,
        masterSeq: m?.seq ?? null,
        masterTitle: m?.title ?? null,
        publishedAt: p.published_at,
        status: p.status,
        platformPostUrl: p.platform_post_url,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        saves: p.saves,
        reach: p.reach,
        metricsCapturedAt: p.metrics_captured_at,
        views24h: d?.views24h ?? null,
        likes24h: d?.likes24h ?? null,
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
