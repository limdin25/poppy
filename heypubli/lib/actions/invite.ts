"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/types/database";

/**
 * "Send me the invite", step 2 of the onboarding funnel.
 *
 * THE DEAD END THIS FIXES. A Skool invite was only ever queued in two places:
 * the Facebook lead-ads webhook and an admin pressing Approve. Nothing on the
 * signup path queued one. So a creator who signed themselves up read "look for
 * an invitation from Lim Din, search your email for skool, check spam" about
 * an email that had never been sent, then hit step 3 asking for a link that
 * only exists INSIDE the community. The funnel stopped there, permanently, for
 * every self-serve signup. That is why nobody has ever finished it.
 *
 * The lane rule still holds: a free invite is for a RECRUIT, never for someone
 * who should be paying. A creator who reached this page is by definition
 * someone we let sign up and asked to post for us, so the lead is promoted to
 * partner here, deliberately and in one place, rather than the gate being
 * quietly deleted. A lead already marked 'customer' is refused, because that
 * is exactly the case the rule exists for.
 */

export type InviteResult =
  | { ok: true; email: string }
  | { ok: false; reason: "no_email" | "is_customer" | "failed" };

export async function requestSkoolInvite(): Promise<InviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  const email = (profile?.email ?? "").trim();
  // A synthetic Instagram address cannot receive anything, and the database
  // CHECK on skool_invites refuses it anyway.
  if (!email || email.toLowerCase().endsWith("@instagram.heypubli.com")) {
    return { ok: false, reason: "no_email" };
  }

  const admin = createAdminClient();
  const emailNorm = email.toLowerCase();

  const { data: lead } = await admin
    .from("signup_leads")
    .select("id, lane")
    .eq("email_normalized", emailNorm)
    .maybeSingle<{ id: string; lane: string }>();

  if (lead?.lane === "customer") return { ok: false, reason: "is_customer" };

  let leadId = lead?.id ?? null;

  if (!leadId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error } = await (admin.from("signup_leads") as any)
      .insert({
        first_name: profile?.first_name ?? "",
        last_name: profile?.last_name ?? "",
        email,
        whatsapp: profile?.whatsapp ?? "",
        whatsapp_e164: profile?.whatsapp ?? null,
        lane: "partner",
        source: "web_signup",
        lane_locked_by: "system:onboarding_invite",
        status: "started",
        profile_id: user.id,
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      console.error("[invite] lead insert failed", error);
      return { ok: false, reason: "failed" };
    }
    leadId = created.id;
  } else if (lead?.lane !== "partner") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("signup_leads") as any)
      .update({
        lane: "partner",
        lane_locked_at: new Date().toISOString(),
        lane_locked_by: "system:onboarding_invite",
        profile_id: user.id,
      })
      .eq("id", leadId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: invErr } = await (admin.from("skool_invites") as any).insert({
    lead_id: leadId,
    profile_id: user.id,
    email,
    first_name: profile?.first_name ?? "",
    lane: "partner",
    idempotency_key: `invite:${leadId}`,
  });
  // 23505 means it is already queued or already sent. From the creator's side
  // that is a success: an invite is on its way to them.
  if (invErr && invErr.code !== "23505") {
    console.error("[invite] queue failed", invErr);
    return { ok: false, reason: "failed" };
  }

  revalidatePath("/onboarding");
  return { ok: true, email };
}
