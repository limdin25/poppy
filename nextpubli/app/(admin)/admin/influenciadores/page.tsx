import { AdminInfluencers } from "@/features/admin-influencers";
import {
  getAllProfiles,
  getAllInstagramConnections,
  getAllBrands,
  getSalesByInfluencer,
  getClickCountsByInfluencer,
} from "@/lib/data";
import { getAllOutstandConnections, getBioLinkStatuses } from "@/lib/data/outstand";
import { getDefaultCampaign, getCampaignMemberIdSet } from "@/lib/data/campaigns";
import { buildReferralLink } from "@/lib/referral";

export const dynamic = "force-dynamic";

export default async function InfluenciadoresPage() {
  const [
    profiles,
    legacyConnections,
    outstandConnections,
    brands,
    salesByInfluencer,
    clicksByInfluencer,
    campaign,
  ] = await Promise.all([
    getAllProfiles(),
    getAllInstagramConnections(),
    getAllOutstandConnections(),
    getAllBrands(),
    getSalesByInfluencer(),
    getClickCountsByInfluencer(),
    getDefaultCampaign(),
  ]);

  const campaignMemberIds = campaign
    ? await getCampaignMemberIdSet(campaign.id)
    : new Set<string>();

  // Outstand is the official connection source; the legacy Meta table fills gaps.
  const handleByProfile = new Map<string, string | null>();
  for (const c of legacyConnections) handleByProfile.set(c.profile_id, c.ig_username);
  for (const c of outstandConnections) handleByProfile.set(c.profile_id, c.ig_username);

  // Does each connected account's bio carry their referral link?
  const tagByProfile = new Map(profiles.map((p) => [p.id, p.referral_tag]));
  const bioStatuses = await getBioLinkStatuses(
    outstandConnections.map((c) => ({
      profileId: c.profile_id,
      socialAccountId: c.outstand_social_account_id,
      tag: tagByProfile.get(c.profile_id) ?? null,
    })),
  );

  const shareBaseUrl =
    brands.find((b) => b.is_active)?.share_base_url ?? brands[0]?.share_base_url ?? null;

  const salesMap = new Map(salesByInfluencer.map((s) => [s.profileId, s]));

  const rows = profiles.map((profile) => ({
    profile,
    igUsername: handleByProfile.get(profile.id) ?? null,
    bioStatus: bioStatuses.get(profile.id) ?? null,
    shareLink:
      shareBaseUrl && profile.referral_tag
        ? buildReferralLink(shareBaseUrl, profile.referral_tag)
        : null,
    totalSales: salesMap.get(profile.id)?.totalSales ?? 0,
    commission: salesMap.get(profile.id)?.totalCommission ?? 0,
    clicks: clicksByInfluencer.get(profile.id) ?? 0,
  }));

  return (
    <AdminInfluencers
      influencers={rows}
      campaignId={campaign?.id ?? null}
      campaignMemberIds={[...campaignMemberIds]}
    />
  );
}
