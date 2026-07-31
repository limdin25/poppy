import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHome } from "@/features/dashboard-home";
import { getInstagramProfile } from "@/lib/integrations/instagram";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import { getPostingSettingsAdmin, getOutstandInstagramData } from "@/lib/data/outstand";
import { getClickCountByProfile, getSalesByProfile } from "@/lib/data";
import { getMyCampaignStatus } from "@/lib/data/campaigns";
import { buildReferralLink } from "@/lib/referral";
import { hasLinkInBio } from "@/lib/bio-check";
import type { InstagramData } from "@/features/dashboard-home";
import type { Profile, Brand } from "@/types/database";

export const dynamic = "force-dynamic";

interface IgConnection {
  access_token: string;
  ig_username: string;
  followers_count: number | null;
}

async function getInstagramData(
  profileId: string,
  provider: string,
): Promise<InstagramData | null> {
  // When posting goes through Outstand, the connection lives in outstand_connections.
  if (provider === "outstand") {
    const ig = await getOutstandInstagramData(profileId);
    if (!ig) return null;
    return {
      username: ig.username,
      name: ig.name ?? undefined,
      biography: ig.biography ?? undefined,
      website: ig.website ?? undefined,
      profilePictureUrl: ig.profilePictureUrl ?? undefined,
      followersCount: ig.followersCount,
      followsCount: ig.followingCount,
      mediaCount: ig.postsCount,
      accountType: ig.accountType,
      isConnected: true,
      statsAvailable: ig.statsAvailable,
    };
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: connection } = (await (supabase.from("instagram_connections") as any)
    .select("*")
    .eq("profile_id", profileId)
    .eq("is_connected", true)
    .single()) as { data: IgConnection | null };

  if (!connection) return null;

  try {
    const igProfile = await getInstagramProfile(connection.access_token);
    return {
      username: igProfile.username,
      name: igProfile.name,
      biography: igProfile.biography,
      profilePictureUrl: igProfile.profile_picture_url,
      followersCount: igProfile.followers_count ?? 0,
      followsCount: igProfile.follows_count ?? 0,
      mediaCount: igProfile.media_count,
      accountType: igProfile.account_type,
      isConnected: true,
    };
  } catch (err) {
    // Token expired / API down — show cached basics, but leave a trace for debugging.
    console.error("[dashboard] getInstagramProfile failed:", err);
    return {
      username: connection.ig_username,
      followersCount: connection.followers_count ?? 0,
      followsCount: 0,
      mediaCount: 0,
      accountType: "BUSINESS",
      isConnected: true,
    };
  }
}

export default async function DashboardPage() {
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

  const fallbackProfile: Profile =
    profile ??
    ({
      id: user.id,
      first_name: user.user_metadata?.first_name ?? "Influenciador",
      last_name: user.user_metadata?.last_name ?? "",
      email: user.email ?? "",
      is_admin: false,
      suspended_at: null,
      onboarding_complete: false,
      onboarding_step: 1,
      created_at: new Date().toISOString(),
      date_of_birth: null,
      gender: null,
      address_street: null,
      address_city: null,
      address_postal_code: null,
      address_country: "BR",
      phone: null,
      whatsapp: null,
      timezone: "America/Sao_Paulo",
      pix_key_type: null,
      pix_key: null,
      hotmart_url: null,
      hotmart_affiliate_code: null,
      referral_tag: null,
      registration_method: "instagram",
      commission_rate: null,
      last_accessed_at: null,
    } as Profile);

  const postingSettings = await getPostingSettingsAdmin();
  const instagram = await getInstagramData(
    user.id,
    postingSettings?.active_provider ?? "heypubli",
  );

  // If the influencer's name wasn't captured at sign-up, fall back to their
  // Instagram display name so the greeting isn't blank.
  if (!fallbackProfile.first_name && instagram?.name) {
    fallbackProfile.first_name = instagram.name.split(" ")[0];
  }

  const { data: brands } = await supabase
    .from("brands")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const activeBrands = (brands as Brand[]) ?? [];

  // The influencer's share link: the active brand's base URL + their referral tag.
  const baseUrl = activeBrands[0]?.share_base_url ?? null;
  const shareLink =
    baseUrl && fallbackProfile.referral_tag
      ? buildReferralLink(baseUrl, fallbackProfile.referral_tag)
      : null;

  const [clicks, sales, campaignStatus] = await Promise.all([
    getClickCountByProfile(user.id),
    getSalesByProfile(user.id),
    getMyCampaignStatus(user.id),
  ]);
  const confirmedSales = sales.filter((s) => s.status === "confirmed");
  const earnings = confirmedSales.reduce(
    (sum, s) => sum + Number(s.commission_amount),
    0,
  );

  const connectUrl =
    postingSettings?.active_provider === "outstand"
      ? "/api/outstand/connect"
      : "/api/instagram/connect";

  // Nudge until their referral link shows up in the IG bio (false only when we
  // could actually read the bio and the tag wasn't there).
  const bioLinkMissing =
    Boolean(instagram?.isConnected) &&
    Boolean(shareLink) &&
    hasLinkInBio({
      tag: fallbackProfile.referral_tag,
      biography: instagram?.biography ?? null,
      website: instagram?.website ?? null,
    }) === false;

  return (
    <DashboardHome
      profile={fallbackProfile}
      instagram={instagram}
      connectUrl={connectUrl}
      shareLink={shareLink}
      referralTag={fallbackProfile.referral_tag}
      clicks={clicks}
      sales={confirmedSales.length}
      earnings={earnings}
      campaignStatus={campaignStatus}
      bioLinkMissing={bioLinkMissing}
      instagramEnabled={INSTAGRAM_ENABLED}
    />
  );
}
