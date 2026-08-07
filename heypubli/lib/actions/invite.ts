"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchInvite } from "@/lib/data/skool-invite-dispatch";
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
  const { data: inserted, error: invErr } = await (admin.from("skool_invites") as any)
    .insert({
      lead_id: leadId,
      profile_id: user.id,
      email,
      first_name: profile?.first_name ?? "",
      lane: "partner",
      idempotency_key: `invite:${leadId}`,
    })
    .select("id, email, attempts, lead_id")
    .single();
  // 23505 means it is already queued or already sent. From the creator's side
  // that is a success: an invite is on its way to them.
  if (invErr && invErr.code !== "23505") {
    console.error("[invite] queue failed", invErr);
    return { ok: false, reason: "failed" };
  }

  // SEND IT NOW, do not wait for the five-minute cron.
  //
  // 07 Aug 2026: the first real creator pressed this button 21 seconds after
  // signing up and then stared at an empty inbox. His row was still queued with
  // zero attempts two minutes later and only went out because a human ran the
  // cron by hand. The page tells him "it arrives in a few minutes", which is
  // exactly when somebody wanders off.
  //
  // dispatchInvite never throws, and a failure leaves the row queued for the
  // cron to retry, so the worst case here is the old behaviour.
  //
  // On 23505 the row already exists, which is the "Send it again" button. That
  // path used to insert, collide, and return ok, so the page said "on its way
  // to you" while nothing was sent. A creator who never got the first email
  // could press that button all day and never receive anything.
  let row = inserted ?? null;
  if (!row) {
    const { data: existing } = await admin
      .from("skool_invites")
      .select("id, email, attempts, lead_id")
      .eq("idempotency_key", `invite:${leadId}`)
      .maybeSingle<{
        id: string;
        email: string;
        attempts: number;
        lead_id: string | null;
      }>();
    row = existing ?? null;
  }
  if (row) {
    await dispatchInvite(admin, row);
  }

  revalidatePath("/onboarding");
  return { ok: true, email };
}
