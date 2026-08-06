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

export async function markPostPublished(postId: string, igMediaId: string) {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("scheduled_posts") as any)
    .update({
      status: "published",
      ig_media_id: igMediaId,
      published_at: new Date().toISOString(),
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
