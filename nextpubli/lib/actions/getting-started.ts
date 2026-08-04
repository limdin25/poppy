"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cleanSkoolAffiliateUrl } from "@/lib/skool-link";

/**
 * Step 3 of Getting started: the creator says their Instagram profile is
 * presentable and hands us their Skool affiliate link.
 *
 * Both halves are saved together on purpose. The stamp is what ticks the step,
 * and it is set even when the link is missing or refused, because the work we
 * are actually asking for (real name, photo, bio) happens in the Instagram app
 * where we cannot see it. Holding the tick hostage to a field they may not
 * have yet would leave the step permanently unfinished for anyone whose
 * community invite has not landed.
 */
export async function saveProfileReady(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const raw = formData.get("skool_affiliate_url");
  const cleaned = typeof raw === "string" ? cleanSkoolAffiliateUrl(raw) : null;

  const patch: { profile_ready_at: string; skool_affiliate_url?: string } = {
    profile_ready_at: new Date().toISOString(),
  };
  // Only write the link when it parsed. A blank or refused paste leaves the
  // one we already hold alone rather than wiping it.
  if (cleaned) patch.skool_affiliate_url = cleaned;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("profiles") as any).update(patch).eq("id", user.id);

  revalidatePath("/dashboard");
}
