"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readSkoolAffiliateUrl, SKOOL_LINK_FAULT_MESSAGE } from "@/lib/skool-link";
import type { SkoolLinkResult } from "@/lib/actions/onboarding-shared";

/**
 * The /onboarding funnel's server actions. Same columns the brochure actions
 * wrote, revalidating the funnel's own path. All of them run under the
 * creator's own session (RLS-scoped), never the service role: a creator can
 * only ever tick their own boxes.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * The three self-declared steps. Each RETURNS whether the write landed.
 *
 * They used to return void and only console.error, so a failed update left the
 * button flicking from "Checking" back to its label with the page identical
 * and the step still not ticked. The creator has no way to tell a saved tick
 * from a lost one, taps again, and eventually decides the site is broken.
 */
export type DeclareResult = { ok: boolean };

async function stampOnce(column: string): Promise<DeclareResult> {
  const { supabase, user } = await requireUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("profiles") as any)
    .update({ [column]: new Date().toISOString() })
    .eq("id", user.id)
    .is(column, null);
  if (error) {
    console.error(`[onboarding] ${column} failed`, error);
    return { ok: false };
  }
  revalidatePath("/onboarding");
  return { ok: true };
}

/** Step 2: "I have joined". Their word is the mechanism, Skool never tells us. */
export async function declareCommunityJoined(): Promise<DeclareResult> {
  return stampOnce("community_joined_declared_at");
}

/** Step 4: the photo is in place. Self-declared, no API can judge a photo. */
export async function declarePhotoDone(): Promise<DeclareResult> {
  return stampOnce("photo_declared_at");
}

/**
 * Step 5's escape hatch. Offered when we could not read the bio, AND when we
 * read it but did not find the link: Instagram's Links row can hold several
 * links and the API hands back only the first, so a creator who did exactly
 * what the page asked can be told "it is not there" forever with nothing but
 * a Recheck button. Their word is worth more than our one-link read.
 */
export async function declareBioDone(): Promise<DeclareResult> {
  return stampOnce("bio_link_declared_at");
}

/**
 * Step 3: the pasted affiliate link, validated hard. skool.com is only half of
 * it. The link has to carry their referral code, because that is the part that
 * credits them, and four creators saved a code-less Skool page and were told
 * they had finished (09 Aug 2026).
 */
export async function saveSkoolLink(
  _prev: SkoolLinkResult,
  formData: FormData,
): Promise<SkoolLinkResult> {
  const raw = String(formData.get("skool_affiliate_url") ?? "");
  const read = readSkoolAffiliateUrl(raw);
  if (!read.ok) {
    return { ok: false, message: SKOOL_LINK_FAULT_MESSAGE[read.fault], url: null };
  }
  const cleaned = read.url;

  const { supabase, user } = await requireUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("profiles") as any)
    .update({ skool_affiliate_url: cleaned })
    .eq("id", user.id);
  if (error) {
    console.error("[onboarding] saveSkoolLink failed", error);
    return { ok: false, message: "Could not save the link. Try again.", url: null };
  }

  revalidatePath("/onboarding");
  return { ok: true, message: "Saved.", url: cleaned };
}
