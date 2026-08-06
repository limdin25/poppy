"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cleanSkoolAffiliateUrl } from "@/lib/skool-link";
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

/** Step 2: "I have joined". Their word is the mechanism, Skool never tells us. */
export async function declareCommunityJoined(): Promise<void> {
  const { supabase, user } = await requireUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("profiles") as any)
    .update({ community_joined_declared_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("community_joined_declared_at", null);
  if (error) console.error("[onboarding] declareCommunityJoined failed", error);
  revalidatePath("/onboarding");
}

/** Step 4: the photo is in place. Self-declared, no API can judge a photo. */
export async function declarePhotoDone(): Promise<void> {
  const { supabase, user } = await requireUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("profiles") as any)
    .update({ photo_declared_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("photo_declared_at", null);
  if (error) console.error("[onboarding] declarePhotoDone failed", error);
  revalidatePath("/onboarding");
}

/** Step 5 escape hatch: offered only when we could not read the bio ourselves. */
export async function declareBioDone(): Promise<void> {
  const { supabase, user } = await requireUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("profiles") as any)
    .update({ bio_link_declared_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("bio_link_declared_at", null);
  if (error) console.error("[onboarding] declareBioDone failed", error);
  revalidatePath("/onboarding");
}

/** Step 3: the pasted affiliate link, validated hard (skool.com only). */
export async function saveSkoolLink(
  _prev: SkoolLinkResult,
  formData: FormData,
): Promise<SkoolLinkResult> {
  const raw = String(formData.get("skool_affiliate_url") ?? "");
  const cleaned = cleanSkoolAffiliateUrl(raw);
  if (!cleaned) {
    return {
      ok: false,
      message: "That is not a skool.com link. Copy the whole address from Skool.",
      url: null,
    };
  }

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
