// Per-VIDEO numbers: how many views and likes each post we published actually got.
//
// Hugo, 08 Aug 2026: "on the video posted we should be able to see a column as
// well with the numbers of views and likes per video. Isn't that correct?"
//
// It is. An earlier note here claimed per-post metrics did not exist. That was
// wrong: only `/posts/{id}/metrics` and `/insights` 404. The real endpoint is
// `/posts/{id}/analytics` and it serves views, likes, comments, shares, saves
// and reach for every post, plus the permalink. See lib/integrations/outstand.
//
// Two stores, because they answer different questions. The current count lives
// on the scheduled_posts row (one query for the page). The history lives in
// post_metrics_snapshots, because "views in the last 24 hours" is a gap between
// two readings and cannot be derived from a single number. Same reasoning as
// creator followers in 037, and the same hard limit: nothing is backfillable.

import { createAdminClient } from "@/lib/supabase/admin";
import { getPostAnalytics } from "@/lib/integrations/outstand";

/** Videos older than this stop being re-read every hour. Reels do almost all of
 *  their traffic in the first days, and the cost of asking is one API call per
 *  post per hour, which grows with every post we ever publish. */
const REFRESH_WINDOW_DAYS = 30;

/** The periods the dashboard can be read over.
 *
 *  Hugo, 08 Aug 2026: "I should have a drop-down to put last 24 hours, last 72
 *  hours, or maybe even like a calendar where I can choose."
 *
 *  Every one is precomputed on the server from the same single pass over the
 *  readings, so switching period on the page is instant and costs no query.
 *  A custom calendar range is handled differently, by publish date, because an
 *  arbitrary window would need its own anchor reading per post. */
export const WINDOWS = [
  { key: "h24", label: "Last 24 hours", short: "24h", hours: 24 },
  { key: "h72", label: "Last 72 hours", short: "72h", hours: 72 },
  { key: "d7", label: "Last 7 days", short: "7d", hours: 24 * 7 },
  { key: "d30", label: "Last 30 days", short: "30d", hours: 24 * 30 },
] as const;

export type WindowKey = (typeof WINDOWS)[number]["key"];

export interface PostDelta {
  views: number | null;
  likes: number | null;
  reach: number | null;
}

export type PostMetricDeltas = Record<WindowKey, PostDelta>;

/** Every window unmeasured. What a post with no second reading honestly is. */
export function emptyDeltas(): PostMetricDeltas {
  return WINDOWS.reduce((acc, w) => {
    acc[w.key] = { views: null, likes: null, reach: null };
    return acc;
  }, {} as PostMetricDeltas);
}

type Snap = { captured_at: string; [k: string]: unknown };

/** The change in one metric over `hours`, or null when we cannot honestly say.
 *
 *  Null rather than 0 in every uncertain case. Zero is a claim ("this video did
 *  not move"), and reporting it for a video we have only measured once is a
 *  false claim.
 *
 *  `publishedAt` matters more than it looks. A video posted three days ago has
 *  no reading from thirty days ago, so asking for its 30-day gain by subtraction
 *  finds no anchor and yields null. But the truthful answer is not "unknown", it
 *  is "all of it": the video did not exist before the window, so everything it
 *  has, it earned inside the window. Without this every period but the shortest
 *  reads blank on a young account, which is exactly the empty dashboard this
 *  work set out to fix. */
export function deltaFor(
  rows: Array<Snap>,
  now: Date,
  hours: number,
  key: string,
  publishedAt?: string | null,
): number | null {
  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at),
  );
  const latest = sorted.find((r) => typeof r[key] === "number");
  if (!latest) return null;

  const cutoff = now.getTime() - hours * 60 * 60 * 1000;

  // Born inside the window: its whole count is this window's gain.
  if (publishedAt && Date.parse(publishedAt) >= cutoff) {
    return latest[key] as number;
  }

  const earlier = sorted.find(
    (r) => Date.parse(r.captured_at) <= cutoff && typeof r[key] === "number",
  );
  if (!earlier || earlier.captured_at === latest.captured_at) return null;

  const d = (latest[key] as number) - (earlier[key] as number);
  // A video cannot lose views. Instagram does restate figures downward, so a
  // negative is an artefact of the source, not something to show as a loss.
  return d < 0 ? null : d;
}

export function buildPostMetricRows(
  posts: Array<{ id: string; publishedAt?: string | null }>,
  snapshots: Array<{ post_id: string } & Snap>,
  now: Date,
): Map<string, PostMetricDeltas> {
  const by = new Map<string, Array<Snap>>();
  for (const s of snapshots) {
    const list = by.get(s.post_id) ?? [];
    list.push(s);
    by.set(s.post_id, list);
  }
  const out = new Map<string, PostMetricDeltas>();
  for (const p of posts) {
    const rows = by.get(p.id) ?? [];
    const deltas = emptyDeltas();
    for (const w of WINDOWS) {
      deltas[w.key] = {
        views: deltaFor(rows, now, w.hours, "views", p.publishedAt),
        likes: deltaFor(rows, now, w.hours, "likes", p.publishedAt),
        reach: deltaFor(rows, now, w.hours, "reach", p.publishedAt),
      };
    }
    out.set(p.id, deltas);
  }
  return out;
}

export interface CaptureResult {
  read: number;
  skipped: number;
  urlsBackfilled: number;
}

/** Read every recently published video's numbers, store them, and recover any
 *  permalink we failed to keep at publish time.
 *
 *  Best effort per post: one dead post must not cost the whole sweep. */
export async function capturePostMetrics(now = new Date()): Promise<CaptureResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: settings } = await admin
    .from("posting_settings")
    .select("outstand_api_key")
    .limit(1);
  const apiKey = (settings ?? [])[0]?.outstand_api_key as string | undefined;
  if (!apiKey) return { read: 0, skipped: 0, urlsBackfilled: 0 };

  const since = new Date(
    now.getTime() - REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: posts } = await admin
    .from("scheduled_posts")
    .select("id, outstand_post_id, platform_post_url, published_at")
    .eq("status", "published")
    .eq("provider", "outstand")
    .not("outstand_post_id", "is", null)
    .gte("published_at", since);

  let read = 0;
  let skipped = 0;
  let urlsBackfilled = 0;

  for (const p of (posts ?? []) as Array<{
    id: string;
    outstand_post_id: string;
    platform_post_url: string | null;
    published_at: string | null;
  }>) {
    try {
      const a = await getPostAnalytics(apiKey, p.outstand_post_id);
      if (!a) {
        skipped++;
        continue;
      }

      const patch: Record<string, unknown> = {
        views: a.views,
        likes: a.likes,
        comments: a.comments,
        shares: a.shares,
        saves: a.saves,
        reach: a.reach,
        metrics_captured_at: now.toISOString(),
      };
      // The permalink is served here too, so a post published before we started
      // storing it is recoverable rather than lost. Only ever filled in, never
      // overwritten: the stored one came straight from the publish response.
      if (!p.platform_post_url && a.platformPostUrl) {
        patch.platform_post_url = a.platformPostUrl;
        urlsBackfilled++;
      }

      await admin.from("scheduled_posts").update(patch).eq("id", p.id);
      await admin.from("post_metrics_snapshots").insert({
        post_id: p.id,
        captured_at: now.toISOString(),
        views: a.views,
        likes: a.likes,
        comments: a.comments,
        shares: a.shares,
        saves: a.saves,
        reach: a.reach,
      });
      read++;
    } catch (err) {
      console.error("[post-metrics] failed for", p.id, err);
      skipped++;
    }
  }

  return { read, skipped, urlsBackfilled };
}
