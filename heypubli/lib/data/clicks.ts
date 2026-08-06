import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ResolvedTag {
  profileId: string;
  brandId: string | null;
}

/**
 * Service-role: map a referral tag to its influencer (+ the active brand).
 * Used by the public /api/click route, which handles anonymous traffic (no RLS context).
 */
export async function resolveTag(tag: string): Promise<ResolvedTag | null> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("referral_tag", tag)
    .maybeSingle<{ id: string }>();
  if (!profile) return null;

  const { data: brand } = await admin
    .from("brands")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

  return { profileId: profile.id, brandId: brand?.id ?? null };
}

export interface LogClickInput {
  profileId: string;
  brandId: string | null;
  referralTag: string;
  referer: string | null;
  userAgent: string | null;
  ipHash: string | null;
  isBot: boolean;
}

/** Service-role best-effort insert of one click. Callers wrap in catch — never block the response. */
export async function logClick(input: LogClickInput): Promise<void> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("link_clicks") as any).insert({
    profile_id: input.profileId,
    brand_id: input.brandId,
    referral_tag: input.referralTag,
    referer: input.referer,
    user_agent: input.userAgent,
    ip_hash: input.ipHash,
    is_bot: input.isBot,
  });
}

/** An influencer's own real (non-bot) click count. RLS scopes it to them. */
export async function getClickCountByProfile(profileId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("link_clicks")
    .select("*", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("is_bot", false);
  return count ?? 0;
}

/** Admin: real click counts keyed by influencer id. */
export async function getClickCountsByInfluencer(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("link_clicks")
    .select("profile_id")
    .eq("is_bot", false);

  const rows = (data as { profile_id: string | null }[] | null) ?? [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.profile_id) continue;
    counts.set(row.profile_id, (counts.get(row.profile_id) ?? 0) + 1);
  }
  return counts;
}

/** Admin: clicks grouped per day for an influencer (small timeline chart). */
export async function getClicksTimeline(
  profileId: string,
): Promise<{ date: string; clicks: number }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("link_clicks")
    .select("clicked_at")
    .eq("profile_id", profileId)
    .eq("is_bot", false)
    .order("clicked_at", { ascending: true });

  const rows = (data as { clicked_at: string }[] | null) ?? [];
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = row.clicked_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()].map(([date, clicks]) => ({ date, clicks }));
}
