import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInstagramMetrics, type OutstandIgMetrics } from "@/lib/integrations/outstand";
import { hasLinkInBio } from "@/lib/bio-check";
import type { PostingSettings, OutstandConnection } from "@/types/database";

// --- Posting Settings ---

export async function getPostingSettings(): Promise<PostingSettings | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("posting_settings").select("*").limit(1).single();
  return (data as PostingSettings | null) ?? null;
}

export async function getPostingSettingsAdmin(): Promise<PostingSettings | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("posting_settings").select("*").limit(1).single();
  return (data as PostingSettings | null) ?? null;
}

export async function savePostingSettings(params: {
  active_provider: string;
  outstand_api_key?: string | null;
  outstand_social_network_id?: string | null;
  default_timezone?: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("posting_settings")
    .select("id")
    .limit(1)
    .single();

  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("posting_settings") as any)
      .update({ ...params, updated_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("posting_settings") as any).insert(params);
  }
}

// --- Outstand Connections ---

export async function getOutstandConnection(
  profileId: string,
): Promise<OutstandConnection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("outstand_connections")
    .select("*")
    .eq("profile_id", profileId)
    .eq("is_connected", true)
    .single();
  return (data as OutstandConnection | null) ?? null;
}

// Full Instagram profile + engagement metrics for a connected influencer.
// Returns null only when there is no connection; otherwise returns the metrics.
// statsAvailable=false marks the degraded fallback (metrics API unreachable /
// key missing) so callers never render its zeros as real numbers.
export async function getOutstandInstagramData(
  profileId: string,
): Promise<(OutstandIgMetrics & { statsAvailable: boolean }) | null> {
  const conn = await getOutstandConnection(profileId);
  if (!conn) return null;

  const settings = await getPostingSettingsAdmin();
  if (settings?.outstand_api_key) {
    const metrics = await getInstagramMetrics(
      settings.outstand_api_key,
      conn.outstand_social_account_id,
    );
    if (metrics) return { ...metrics, statsAvailable: true };
  }

  return {
    statsAvailable: false,
    username: conn.ig_username ?? "",
    name: null,
    biography: null,
    website: null,
    profilePictureUrl: null,
    accountType: "BUSINESS",
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    engagement: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      reach: 0,
      accountsEngaged: 0,
      totalInteractions: 0,
    },
  };
}

export async function getAllOutstandConnections(): Promise<OutstandConnection[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("outstand_connections")
    .select("*")
    .eq("is_connected", true);
  return (data as OutstandConnection[] | null) ?? [];
}

export type BioLinkStatus = "ok" | "missing" | "unknown";

/**
 * Checks, per connected influencer, whether their referral tag shows up in the
 * Instagram bio or the clickable website field. One metrics call per account,
 * in parallel; any failure degrades to "unknown" instead of breaking the page.
 */
export async function getBioLinkStatuses(
  targets: { profileId: string; socialAccountId: string; tag: string | null }[],
): Promise<Map<string, BioLinkStatus>> {
  const result = new Map<string, BioLinkStatus>();
  if (targets.length === 0) return result;

  const settings = await getPostingSettingsAdmin();
  const apiKey = settings?.outstand_api_key;
  if (!apiKey) {
    for (const t of targets) result.set(t.profileId, "unknown");
    return result;
  }

  await Promise.all(
    targets.map(async (t) => {
      try {
        const metrics = await getInstagramMetrics(apiKey, t.socialAccountId);
        const found = hasLinkInBio({
          tag: t.tag,
          biography: metrics?.biography ?? null,
          website: metrics?.website ?? null,
        });
        result.set(t.profileId, found === null ? "unknown" : found ? "ok" : "missing");
      } catch {
        result.set(t.profileId, "unknown");
      }
    }),
  );
  return result;
}

/** Upserts the connection; isNew=true when this profile had no connection row yet. */
export async function saveOutstandConnection(
  profileId: string,
  socialAccountId: string,
  igUsername: string | null,
  igUserId?: string | null,
): Promise<{ isNew: boolean }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("outstand_connections")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();

  const row = {
    profile_id: profileId,
    outstand_social_account_id: socialAccountId,
    ig_username: igUsername,
    // The stable Instagram id — only overwrite with a real value, never null out.
    ...(igUserId ? { ig_user_id: igUserId } : {}),
    is_connected: true,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("outstand_connections") as any).upsert(row, {
    onConflict: "profile_id",
  });
  if (error) throw new Error(`Falha ao salvar conexão do Instagram: ${error.message}`);

  return { isNew: !existing };
}

export async function disconnectOutstand(connectionId: string): Promise<void> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("outstand_connections") as any)
    .update({ is_connected: false })
    .eq("id", connectionId);
}

export async function saveOutstandPostId(
  postId: string,
  outstandPostId: string,
): Promise<void> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("scheduled_posts") as any)
    .update({ outstand_post_id: outstandPostId })
    .eq("id", postId);
}
