import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Campaign,
  CampaignItem,
  CampaignMember,
  InstagramPostOptions,
  PostingProvider,
  PostMediaType,
  Profile,
  ScheduledPost,
} from "@/types/database";

// A scheduled_posts insert row derived from a campaign item.
export interface CampaignPostInsert {
  profile_id: string;
  brand_id: string;
  media_type: PostMediaType;
  media_url: string;
  caption: string;
  scheduled_at: string;
  status: "pending";
  provider: PostingProvider;
  instagram_options: InstagramPostOptions | null;
  campaign_id: string;
  campaign_item_id: string;
  ig_media_id: null;
  outstand_post_id: null;
  published_at: null;
  error_message: null;
  reach: null;
  likes: null;
  comments: null;
  shares: null;
}

function toPostRow(
  item: CampaignItem,
  brandId: string,
  profileId: string,
  scheduledAt: string,
  provider: PostingProvider,
): CampaignPostInsert {
  return {
    profile_id: profileId,
    brand_id: brandId,
    media_type: item.media_type,
    media_url: item.media_url,
    caption: item.caption,
    scheduled_at: scheduledAt,
    status: "pending",
    provider,
    instagram_options: item.instagram_options ?? null,
    campaign_id: item.campaign_id,
    campaign_item_id: item.id,
    ig_media_id: null,
    outstand_post_id: null,
    published_at: null,
    error_message: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
  };
}

/**
 * Posts to create when an account joins a campaign.
 * - schedule mode: every item still in the future, at its own time.
 * - start-now: additionally, the campaign's FIRST item (earliest, even if past)
 *   fires immediately — never duplicated when it is also in the future set.
 * Items with no brand (own or campaign fallback) are skipped: posts require one.
 */
export function buildPostsForMember(params: {
  campaign: Campaign;
  items: CampaignItem[];
  profileId: string;
  startNow: boolean;
  provider: PostingProvider;
  now: Date;
}): CampaignPostInsert[] {
  const { campaign, items, profileId, startNow, provider, now } = params;
  const sorted = [...items].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
  );
  const firstId = sorted[0]?.id;

  const rows: CampaignPostInsert[] = [];
  for (const item of sorted) {
    const brandId = item.brand_id ?? campaign.brand_id;
    if (!brandId) continue;
    const fireNow = startNow && item.id === firstId;
    const isFuture = new Date(item.scheduled_at) > now;
    if (!fireNow && !isFuture) continue;
    const scheduledAt = fireNow
      ? now.toISOString()
      : new Date(item.scheduled_at).toISOString();
    rows.push(toPostRow(item, brandId, profileId, scheduledAt, provider));
  }
  return rows;
}

/** Posts to create for every member when a new item is added (future items only). */
export function buildPostsForItem(params: {
  campaign: Campaign;
  item: CampaignItem;
  profileIds: string[];
  provider: PostingProvider;
  now: Date;
}): CampaignPostInsert[] {
  const { campaign, item, profileIds, provider, now } = params;
  const brandId = item.brand_id ?? campaign.brand_id;
  if (!brandId) return [];
  if (new Date(item.scheduled_at) <= now) return [];
  const scheduledAt = new Date(item.scheduled_at).toISOString();
  return profileIds.map((profileId) =>
    toPostRow(item, brandId, profileId, scheduledAt, provider),
  );
}

// --- Queries (admin) ---

export async function getDefaultCampaign(): Promise<Campaign | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("campaigns")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as Campaign | null) ?? null;
}

export async function getCampaignById(campaignId: string): Promise<Campaign | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  return (data as Campaign | null) ?? null;
}

export async function getCampaignItems(campaignId: string): Promise<CampaignItem[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("campaign_items")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("scheduled_at", { ascending: true });
  return (data as CampaignItem[] | null) ?? [];
}

export async function getCampaignItemById(itemId: string): Promise<CampaignItem | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("campaign_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  return (data as CampaignItem | null) ?? null;
}

export async function getCampaignMembers(campaignId: string): Promise<CampaignMember[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("campaign_members")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("added_at", { ascending: false });
  return (data as CampaignMember[] | null) ?? [];
}

/** Drops suspended profiles from a list of ids — suspended accounts never get posts. */
export async function filterActiveProfileIds(profileIds: string[]): Promise<string[]> {
  if (profileIds.length === 0) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .in("id", profileIds)
    .is("suspended_at", null);
  const active = new Set(((data as { id: string }[] | null) ?? []).map((p) => p.id));
  return profileIds.filter((id) => active.has(id));
}

export interface CampaignMemberRow extends CampaignMember {
  name: string;
  ig_username: string | null;
}

/** Members with the influencer's name + IG handle attached (for the admin table). */
export async function getCampaignMembersWithProfiles(
  campaignId: string,
): Promise<CampaignMemberRow[]> {
  const admin = createAdminClient();
  const members = await getCampaignMembers(campaignId);
  if (members.length === 0) return [];

  const ids = members.map((m) => m.profile_id);
  const [{ data: profiles }, { data: connections }] = await Promise.all([
    admin.from("profiles").select("id, first_name, last_name").in("id", ids),
    admin
      .from("outstand_connections")
      .select("profile_id, ig_username")
      .in("profile_id", ids),
  ]);

  const nameById = new Map(
    ((profiles as Pick<Profile, "id" | "first_name" | "last_name">[] | null) ?? []).map(
      (p) => [p.id, `${p.first_name} ${p.last_name}`.trim()],
    ),
  );
  const igById = new Map(
    (
      (connections as { profile_id: string; ig_username: string | null }[] | null) ?? []
    ).map((c) => [c.profile_id, c.ig_username]),
  );

  return members.map((m) => ({
    ...m,
    name: nameById.get(m.profile_id) || "—",
    ig_username: igById.get(m.profile_id) ?? null,
  }));
}

export interface ConnectedAccountRow {
  profile_id: string;
  name: string;
  ig_username: string | null;
  connected_at: string;
}

/** Connected Instagram accounts NOT yet in the given campaign (candidates to add). */
export async function getAccountsNotInCampaign(
  campaignId: string,
): Promise<ConnectedAccountRow[]> {
  const admin = createAdminClient();
  const [{ data: connections }, members] = await Promise.all([
    admin
      .from("outstand_connections")
      .select("profile_id, ig_username, created_at")
      .eq("is_connected", true)
      .order("created_at", { ascending: false }),
    getCampaignMembers(campaignId),
  ]);

  const memberIds = new Set(members.map((m) => m.profile_id));
  const candidates = (
    (connections as
      | { profile_id: string; ig_username: string | null; created_at: string }[]
      | null) ?? []
  ).filter((c) => !memberIds.has(c.profile_id));
  if (candidates.length === 0) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, first_name, last_name, is_admin")
    .in(
      "id",
      candidates.map((c) => c.profile_id),
    );
  const nameById = new Map(
    (
      (profiles as
        | Pick<Profile, "id" | "first_name" | "last_name" | "is_admin">[]
        | null) ?? []
    ).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]),
  );

  return candidates.map((c) => ({
    profile_id: c.profile_id,
    name: nameById.get(c.profile_id) || "—",
    ig_username: c.ig_username,
    connected_at: c.created_at,
  }));
}

/** Profile ids of everyone in the campaign (for list badges/filters). */
export async function getCampaignMemberIdSet(campaignId: string): Promise<Set<string>> {
  const members = await getCampaignMembers(campaignId);
  return new Set(members.map((m) => m.profile_id));
}

// --- Queries (influencer, RLS-scoped) ---

export interface MyCampaignStatus {
  campaign: Pick<Campaign, "id" | "name">;
  added_at: string;
  next_post: Pick<ScheduledPost, "id" | "media_type" | "scheduled_at"> | null;
}

/** The signed-in influencer's campaign membership + their next scheduled campaign post. */
export async function getMyCampaignStatus(
  profileId: string,
): Promise<MyCampaignStatus | null> {
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("campaign_members")
    .select("campaign_id, added_at")
    .eq("profile_id", profileId)
    .order("added_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!member) return null;
  const m = member as { campaign_id: string; added_at: string };

  const [{ data: campaign }, { data: nextPost }] = await Promise.all([
    supabase.from("campaigns").select("id, name").eq("id", m.campaign_id).maybeSingle(),
    supabase
      .from("scheduled_posts")
      .select("id, media_type, scheduled_at")
      .eq("profile_id", profileId)
      .eq("campaign_id", m.campaign_id)
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!campaign) return null;

  return {
    campaign: campaign as Pick<Campaign, "id" | "name">,
    added_at: m.added_at,
    next_post:
      (nextPost as Pick<ScheduledPost, "id" | "media_type" | "scheduled_at"> | null) ??
      null,
  };
}
