import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInstagramProfile } from "@/lib/integrations/instagram";
import { getPostingSettingsAdmin, getOutstandInstagramData } from "@/lib/data/outstand";
import { isCommunityMember } from "@/lib/data/community";
import { checkBio, bioVerified } from "@/lib/bio-check";
import { skoolLinkNeedle } from "@/lib/skool-link";
import { bioSentence } from "@/lib/bio-variants";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import type { Profile } from "@/types/database";

/**
 * Everything /brochure needs, resolved once on the server.
 *
 * Four steps, four truths. Three of them are read from real state and cannot be
 * faked or go stale; one is the creator pasting a link, which nothing but the
 * creator can supply. The states are deliberately more than done/not done,
 * because "we could not check" is a real answer and telling a creator "not
 * done" when we mean "our lookup failed" is how you lose them at step 4.
 */
export type StepState = "done" | "todo" | "waiting" | "unknown" | "blocked";

export interface BrochureData {
  firstName: string;
  email: string;
  /** Where "Connect Instagram" goes, provider-aware. */
  connectUrl: string;
  instagramEnabled: boolean;

  instagram: {
    state: StepState;
    username: string | null;
    /** False when the provider answered but could not give us profile text. */
    canReadBio: boolean;
  };

  community: {
    state: StepState;
    /** A synthetic Instagram address can never match a Skool account. */
    emailUsable: boolean;
    /** True when they told us, rather than Skool telling us. */
    selfDeclared: boolean;
  };

  affiliate: {
    state: StepState;
    url: string | null;
  };

  bio: {
    state: StepState;
    /** This creator's own sentence. Allocated once, then frozen. */
    sentence: string;
    /** What we searched their bio for, and how strong that evidence is. */
    needleKind: "referral" | "community" | null;
    /** Their claim that it is in. A claim we record, never a completion. */
    declaredAt: string | null;
    /** What the live read actually found. Null when we could not judge. */
    linkFound: boolean | null;
    sentenceFound: boolean | null;
  };

  doneCount: number;
}

const SYNTHETIC_EMAIL_DOMAIN = "@instagram.heypubli.com";

interface IgSnapshot {
  connected: boolean;
  username: string | null;
  biography: string | null;
  website: string | null;
  /** The provider answered with real profile text rather than a degraded stub. */
  textAvailable: boolean;
}

/**
 * The Instagram side, whichever provider is switched on.
 *
 * Outstand's metrics endpoint gives biography AND website (the clickable link
 * in bio), which is what makes step 4 checkable at all. The direct Meta path
 * gives biography only, so a creator on that path who puts the link in the
 * website field and not in the bio text reads back as "we cannot tell" rather
 * than "missing". Being vague is correct there; being wrong is not.
 */
async function readInstagram(profileId: string, provider: string): Promise<IgSnapshot> {
  if (provider === "outstand") {
    const ig = await getOutstandInstagramData(profileId);
    if (!ig) {
      return {
        connected: false,
        username: null,
        biography: null,
        website: null,
        textAvailable: false,
      };
    }
    return {
      connected: true,
      username: ig.username || null,
      biography: ig.biography,
      website: ig.website,
      textAvailable: ig.statsAvailable,
    };
  }

  const supabase = await createClient();
  const { data: connection } = (await supabase
    .from("instagram_connections")
    .select("access_token, ig_username")
    .eq("profile_id", profileId)
    .eq("is_connected", true)
    .maybeSingle()) as {
    data: { access_token: string; ig_username: string } | null;
  };

  if (!connection) {
    return {
      connected: false,
      username: null,
      biography: null,
      website: null,
      textAvailable: false,
    };
  }

  try {
    const igProfile = await getInstagramProfile(connection.access_token);
    return {
      connected: true,
      username: igProfile.username,
      biography: igProfile.biography ?? null,
      // Meta's own /me does not return the website field. Saying so beats
      // guessing, and it is why this path can only ever reach "unknown".
      website: null,
      textAvailable: true,
    };
  } catch (err) {
    console.error("[brochure] getInstagramProfile failed:", err);
    return {
      connected: true,
      username: connection.ig_username,
      biography: null,
      website: null,
      textAvailable: false,
    };
  }
}

/**
 * Hand this creator their bio sentence, once, and remember it.
 *
 * The allocation is a write on a GET, which is unusual and deliberate: the
 * sentence has to exist the first time the creator lays eyes on the page, and
 * it must never change afterwards, because they will have copied it into a
 * public profile. The SQL function is atomic, so two tabs open at once still
 * get one number. If the call fails we fall back to a sentence derived from
 * nothing but the index we do not have, so we hand out index 0 rather than
 * rendering a blank step. A shared sentence is a small problem; an empty step 4
 * is the end of the page.
 */
async function allocateBioVariant(profileId: string, existing: number | null) {
  if (existing !== null && existing !== undefined) return existing;

  const admin = createAdminClient();
  // The generated Database type does not carry our SQL functions, so rpc() is
  // typed as taking nothing. Same escape hatch the rest of lib/data uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.rpc as any)("allocate_bio_variant", {
    p_profile: profileId,
  });

  if (error || typeof data !== "number") {
    console.error("[brochure] allocate_bio_variant failed", error);
    return 0;
  }
  return data;
}

export async function getBrochureData(profile: Profile): Promise<BrochureData> {
  const settings = await getPostingSettingsAdmin();
  const provider = settings?.active_provider ?? "heypubli";

  const emailUsable = Boolean(
    profile.email && !profile.email.toLowerCase().endsWith(SYNTHETIC_EMAIL_DOMAIN),
  );

  const [ig, communityJoined, variantIndex] = await Promise.all([
    readInstagram(profile.id, provider),
    isCommunityMember(profile.email),
    allocateBioVariant(profile.id, profile.bio_variant_index ?? null),
  ]);

  const affiliateUrl = profile.skool_affiliate_url ?? null;
  const needle = skoolLinkNeedle(affiliateUrl);

  // Step 5 in full. Two rules, in this order:
  //
  //   1. Every "we cannot check" branch is taken BEFORE the one that would say
  //      "missing", so the only way to be told the link is not there is for us
  //      to have genuinely read a bio without it.
  //   2. A declaration NEVER completes the step while we can read the profile.
  //      08 Aug 2026: a creator ticked "It is there" over a completely empty
  //      Instagram and the machine told him his link was live. Their word only
  //      stands in when our eyes genuinely fail (provider down, no tag to
  //      search for), because punishing them for our outage is worse.
  const sentence = bioSentence(variantIndex);
  let bioState: StepState;
  let linkFound: boolean | null = null;
  let sentenceFound: boolean | null = null;
  if (!ig.connected || !affiliateUrl) {
    bioState = "blocked";
  } else if (!ig.textAvailable) {
    bioState = profile.bio_link_declared_at ? "done" : "unknown";
  } else {
    const evidence = checkBio({
      tag: needle?.value ?? null,
      sentence,
      biography: ig.biography,
      website: ig.website,
    });
    linkFound = evidence.link;
    sentenceFound = evidence.sentence;
    if (evidence.link === null) {
      // No needle derivable from their link: nothing to search for.
      bioState = profile.bio_link_declared_at ? "done" : "unknown";
    } else {
      bioState = bioVerified(evidence) ? "done" : "waiting";
    }
  }

  const instagramState: StepState = ig.connected
    ? "done"
    : INSTAGRAM_ENABLED
      ? "todo"
      : "blocked";
  // A paid membership is the only join Skool can ever tell us about, so for a
  // free invited creator their own word is not a fallback, it is the mechanism.
  const communityDeclared = Boolean(profile.community_joined_declared_at);
  const communityState: StepState =
    communityJoined || communityDeclared ? "done" : emailUsable ? "waiting" : "blocked";
  const affiliateState: StepState = affiliateUrl ? "done" : "todo";

  const doneCount = [instagramState, communityState, affiliateState, bioState].filter(
    (s) => s === "done",
  ).length;

  return {
    firstName: (profile.first_name || "").trim().split(" ")[0] || "there",
    email: profile.email,
    connectUrl: provider === "outstand" ? "/api/outstand/connect" : "/api/instagram/connect",
    instagramEnabled: INSTAGRAM_ENABLED,
    instagram: {
      state: instagramState,
      username: ig.username,
      canReadBio: ig.textAvailable,
    },
    community: {
      state: communityState,
      emailUsable,
      selfDeclared: communityDeclared && !communityJoined,
    },
    affiliate: { state: affiliateState, url: affiliateUrl },
    bio: {
      state: bioState,
      sentence,
      needleKind: needle?.kind ?? null,
      declaredAt: profile.bio_link_declared_at ?? null,
      linkFound,
      sentenceFound,
    },
    doneCount,
  };
}
