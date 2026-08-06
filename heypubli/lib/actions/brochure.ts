"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cleanSkoolAffiliateUrl } from "@/lib/skool-link";

export interface SkoolLinkResult {
  ok: boolean;
  /** Shown under the field. Written for a creator, not a developer. */
  message: string;
  /** The cleaned link, echoed back so the field shows what we actually stored. */
  url: string | null;
}

export const EMPTY_SKOOL_LINK_RESULT: SkoolLinkResult = {
  ok: false,
  message: "",
  url: null,
};

/**
 * Step 3: the creator pastes their Skool affiliate link.
 *
 * Refused links are refused LOUDLY and on the spot, while they are still
 * looking at the form. This one field is what credits them for anyone who joins
 * through them, so a wrong link is a mistake worth catching now rather than a
 * surprise three months later when the money is wrong. cleanSkoolAffiliateUrl
 * compares the parsed hostname, which is what keeps "notskool.com" out.
 */
export async function saveSkoolLink(
  _prev: SkoolLinkResult,
  formData: FormData,
): Promise<SkoolLinkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = formData.get("skool_affiliate_url");
  const text = typeof raw === "string" ? raw.trim() : "";

  if (!text) {
    return { ok: false, message: "Paste your link first.", url: null };
  }

  const cleaned = cleanSkoolAffiliateUrl(text);
  if (!cleaned) {
    return {
      ok: false,
      message: "That is not a Skool link. It should start with skool.com.",
      url: null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("profiles") as any)
    .update({ skool_affiliate_url: cleaned })
    .eq("id", user.id);

  if (error) {
    console.error("[brochure] saveSkoolLink failed", error);
    return { ok: false, message: "We could not save that. Try once more.", url: null };
  }

  revalidatePath("/brochure");
  return { ok: true, message: "Saved.", url: cleaned };
}

/**
 * Step 4, escape hatch: the creator says the link is in their bio.
 *
 * Only ever offered when we could not read their bio ourselves, and the page
 * enforces that, not this action. It is not a way to skip step 4, it is a way
 * for a creator not to be trapped behind our lapsed API subscription. The stamp
 * is kept in its own column so nobody later mistakes a self-declared step for a
 * verified one.
 */
export async function declareBioDone(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("profiles") as any)
    .update({ bio_link_declared_at: new Date().toISOString() })
    .eq("id", user.id);

  revalidatePath("/brochure");
}
