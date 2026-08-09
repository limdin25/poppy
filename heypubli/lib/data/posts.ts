import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduledPost } from "@/types/database";

export async function getPostsByProfile(profileId: string): Promise<ScheduledPost[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("profile_id", profileId)
    .order("scheduled_at", { ascending: false });
  return (data as ScheduledPost[] | null) ?? [];
}

export async function getPostsToday() {
  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("scheduled_posts")
    .select("*", { count: "exact", head: true })
    .eq("status", "published")
    .gte("published_at", today.toISOString());
  return count ?? 0;
}

export async function getPostsThisWeek() {
  const supabase = await createClient();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { count } = await supabase
    .from("scheduled_posts")
    .select("*", { count: "exact", head: true })
    .eq("status", "published")
    .gte("published_at", weekAgo.toISOString());
  return count ?? 0;
}

export async function getPendingPosts() {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data } = await supabase
    .from("scheduled_posts")
    .select("*, instagram_connections!inner(ig_user_id, access_token)")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true });

  return data ?? [];
}

/** A claim is treated as abandoned after this long. It has to be comfortably
 *  longer than a publish run can live (maxDuration is 300s), or a run still
 *  working a post would have it stolen out from under it. */
const CLAIM_STALE_MS = 10 * 60_000;

/**
 * Take ownership of a pending post so no other publish run can work it.
 *
 * Returns false when somebody else already holds it. One conditional UPDATE
 * does the whole job: Postgres locks the row, and the loser of the race
 * re-checks the WHERE against the winner's fresh claimed_at, fails it, and gets
 * zero rows back. That matters because the gap between selecting a row and
 * recording its Outstand id is up to 90 seconds of media upload, and the cron
 * now runs every 2 minutes.
 */
export async function claimPost(postId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const stale = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("scheduled_posts") as any)
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", postId)
    .eq("status", "pending")
    .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
    .select("id");

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Hand a post back unfinished. Used when Outstand is simply slow or having a
 * bad minute: the row stays pending on purpose, and clearing the claim lets the
 * next run resolve it two minutes later instead of waiting out the stale
 * window. Re-entry is safe because the row keeps its outstand_post_id and the
 * publisher takes the already-created branch.
 */
export async function releasePostClaim(postId: string): Promise<void> {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("scheduled_posts") as any)
    .update({ claimed_at: null })
    .eq("id", postId);
}

export async function markPostPublished(
  postId: string,
  igMediaId: string,
  // Outstand hands back the live Instagram permalink on a published post and we
  // were dropping it. It is the only per-post link we will ever get, since
  // there is no per-post metrics endpoint.
  platformPostUrl?: string | null,
) {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("scheduled_posts") as any)
    .update({
      status: "published",
      ig_media_id: igMediaId,
      published_at: new Date().toISOString(),
      ...(platformPostUrl ? { platform_post_url: platformPostUrl } : {}),
    })
    .eq("id", postId);

  if (error) throw error;
}

export async function markPostFailed(postId: string, errorMessage: string) {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("scheduled_posts") as any)
    .update({
      status: "failed",
      error_message: errorMessage,
    })
    .eq("id", postId);

  if (error) throw error;
}
