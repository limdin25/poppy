import { sendSkoolInvite } from "@/lib/integrations/skool";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { SkoolInvite } from "@/types/database";

/**
 * Sending a queued Skool invite, from either the button or the cron.
 *
 * This used to live only inside /api/funnel/tick, a five-minute cron. On 07 Aug
 * 2026 the first real creator pressed "Send me the invite" 21 seconds after
 * signing up and then watched an empty inbox: his row sat status=queued,
 * attempts=0 for over two minutes, and the email only left because a human ran
 * the cron by hand. Waiting up to five minutes at the exact moment somebody is
 * most likely to give up is not a queue, it is a leak.
 *
 * So the button now dispatches inline and the cron stays as the retry. Both
 * paths share this function, so there is one description of what "sending an
 * invite" means, not two that can drift.
 */

export const MAX_INVITE_ATTEMPTS = 5;

type Admin = ReturnType<typeof createAdminClient>;
type Dispatchable = Pick<SkoolInvite, "id" | "email" | "attempts" | "lead_id">;

/**
 * May this person be given a free place in the community?
 *
 * Pure, so the rule can be read and tested on its own. Two things decide it:
 * an address that can actually receive an email, and the lane. A free invite is
 * for a RECRUIT. Someone marked 'customer' should be paying, and handing them a
 * free place is the mistake the lane exists to prevent.
 */
export type InviteBlock = "no_email" | "synthetic_email" | "is_customer";

export function canInviteFreely(input: {
  email: string | null | undefined;
  lane: string | null | undefined;
}): { ok: true; email: string } | { ok: false; reason: InviteBlock } {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, reason: "no_email" };
  }
  // Our own invention for Instagram signups. It cannot receive anything, and
  // the skool_invites CHECK refuses it, so a creator on one of these silently
  // can never be invited and step 2 is impossible for them.
  if (email.endsWith("@instagram.heypubli.com")) {
    return { ok: false, reason: "synthetic_email" };
  }
  if (input.lane === "customer") return { ok: false, reason: "is_customer" };
  return { ok: true, email };
}

/**
 * Queue and send an invite for anybody we hold an email for, with no login.
 *
 * Hugo, 07 Aug 2026: "the invites should be sent first thing regardless. When
 * you send the link for them to watch, already send the invite, so they do not
 * have to wait and ask you for it."
 *
 * He is right, and it cost us a creator's afternoon: Edelyn reached step 2,
 * found no email, and spent an hour asking for one. The invite is free, it is
 * idempotent, and it does not expire, so there is no reason to make somebody
 * ask. Getting it into their inbox before they need it turns step 2 from a
 * blocker into a tick.
 *
 * Never throws. Safe to call twice: the idempotency key means the second call
 * re-sends the same invite rather than creating another.
 */
export async function inviteLeadByEmail(
  admin: Admin,
  input: { email: string; firstName?: string | null; whatsapp?: string | null },
): Promise<{ ok: true; email: string; resent: boolean } | { ok: false; reason: InviteBlock | "failed" }> {
  const firstName = (input.firstName ?? "").trim();

  const preflight = canInviteFreely({ email: input.email, lane: null });
  if (!preflight.ok) return preflight;
  const email = preflight.email;

  try {
    const { data: lead } = await admin
      .from("signup_leads")
      .select("id, lane")
      .eq("email_normalized", email)
      .maybeSingle<{ id: string; lane: string }>();

    const gate = canInviteFreely({ email, lane: lead?.lane ?? null });
    if (!gate.ok) return gate;

    let leadId = lead?.id ?? null;
    if (!leadId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: created, error } = await (admin.from("signup_leads") as any)
        .insert({
          first_name: firstName,
          // signup_leads.last_name is NOT NULL. Omitting it made this insert fail
          // for EVERY lead who did not already exist, so "send the invite before
          // they ask" silently did nothing for exactly the new people it was
          // built for, and returned a generic "failed" that named no column.
          last_name: "",
          email,
          whatsapp: input.whatsapp ?? "",
          whatsapp_e164: input.whatsapp ?? null,
          lane: "partner",
          // MUST be one of the values in the signup_leads_source_check constraint
          // (021_funnel_lanes.sql): fb_lead_form, web_signup, admin_manual,
          // affiliate_link, import. This said "outreach_invite", which is not one
          // of them, so every insert was rejected. Together with the missing
          // last_name above that made this function incapable of ever creating a
          // lead, while returning a generic "failed" that named neither problem.
          source: "admin_manual",
          lane_locked_by: "system:early_invite",
          status: "started",
          last_seen_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) {
        console.error("[invite] lead insert failed", error);
        return { ok: false, reason: "failed" };
      }
      leadId = created.id;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: invErr } = await (admin.from("skool_invites") as any)
      .insert({
        lead_id: leadId,
        email,
        first_name: firstName,
        lane: "partner",
        idempotency_key: `invite:${leadId}`,
      })
      .select("id, email, attempts, lead_id")
      .single();

    let row = inserted ?? null;
    const resent = Boolean(invErr && invErr.code === "23505");
    if (invErr && !resent) {
      console.error("[invite] queue failed", invErr);
      return { ok: false, reason: "failed" };
    }
    if (!row) {
      const { data: existing } = await admin
        .from("skool_invites")
        .select("id, email, attempts, lead_id")
        .eq("idempotency_key", `invite:${leadId}`)
        .maybeSingle<Dispatchable>();
      row = existing ?? null;
    }
    if (!row) return { ok: false, reason: "failed" };

    await dispatchInvite(admin, row);
    return { ok: true, email, resent };
  } catch (err) {
    console.error("[invite] inviteLeadByEmail threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Claim, send, and record one invite. Returns whether it went out.
 *
 * NEVER throws. It is awaited inside a server action behind a button, and a
 * network wobble at Skool must not take the creator's page down with it. Any
 * failure leaves the row retryable and lets the cron have another go.
 */
export async function dispatchInvite(
  admin: Admin,
  invite: Dispatchable,
): Promise<boolean> {
  const attempts = invite.attempts + 1;

  // Count the attempt BEFORE sending. If this process dies mid-send the row is
  // already marked, so the retry budget is spent and nothing can loop for ever.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("skool_invites") as any)
    .update({
      status: "sending",
      attempts,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("id", invite.id);

  let result: { ok: boolean; error?: string };
  try {
    result = await sendSkoolInvite(invite.email);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : "send threw" };
  }

  if (result.ok) {
    const nowIso = new Date().toISOString();
    // Skool tells us nothing after the 200, so the send IS the confirmation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("skool_invites") as any)
      .update({ status: "confirmed", sent_at: nowIso, confirmed_at: nowIso })
      .eq("id", invite.id);
    if (invite.lead_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({ status: "invited", invited_at: nowIso, last_seen_at: nowIso })
        .eq("id", invite.lead_id)
        .neq("status", "invited");
    }
    // Deliberately NOT writing skool_members. That table means "this person is
    // in the community", and sending an invite is not joining one. Skool has no
    // trigger for a free member joining, so the only honest signal is the
    // creator telling us.
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("skool_invites") as any)
    .update({
      status: attempts >= MAX_INVITE_ATTEMPTS ? "failed" : "queued",
      last_error: result.error ?? "send failed",
    })
    .eq("id", invite.id);
  return false;
}

/**
 * The cron's sweep: anything still queued, plus 'sending' rows a crashed run
 * abandoned. Kept here so the batch rules and the single-send rules cannot
 * drift apart.
 */
/**
 * EVERY ACCOUNT GETS AN INVITE. No exceptions, no button to press.
 *
 * 08 Aug 2026: only 8 of 28 creators had their Skool link live on Instagram,
 * and the wall was step 2. Four of the ten stuck before the link, ROY, Danish,
 * Tapan and MADHU, had NEVER BEEN SENT AN INVITE AT ALL: invites are queued
 * when a LEAD arrives (the ad webhook, the sheet), and when a creator presses
 * the button on /onboarding, but signing up for an account queues nothing. A
 * creator who came in any other way was told to search their email for an
 * invite that had never been sent, then chased about it, for days.
 *
 * You cannot join a community you were not invited to, you cannot get a
 * referral link without joining, and you cannot put a link in your bio that
 * you do not have. One missing email at step 2 costs the whole funnel.
 *
 * So this sweep runs on the tick and gives an invite to any account that has
 * no invite row. It is idempotent, it is free, and it is deliberately a sweep
 * rather than a line in the signup action: any future signup path that forgets
 * is caught here within five minutes instead of silently stranding people.
 */
export async function backfillMissingInvites(
  admin: Admin,
  limit = 20,
): Promise<{ missing: number; queued: number; blocked: Record<string, number> }> {
  const report = { missing: 0, queued: 0, blocked: {} as Record<string, number> };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles } = (await (admin.from("profiles") as any)
    .select("id, first_name, email, whatsapp")
    .eq("is_admin", false)
    .is("suspended_at", null)
    .is("community_joined_declared_at", null)
    .order("created_at", { ascending: false })
    .limit(200)) as {
    data: { id: string; first_name: string | null; email: string; whatsapp: string | null }[] | null;
  };
  if (!profiles?.length) return report;

  const emails = profiles.map((p) => (p.email ?? "").toLowerCase()).filter(Boolean);
  const { data: invites } = await admin
    .from("skool_invites")
    .select("email")
    .in("email", emails)
    .returns<{ email: string }[]>();
  const invited = new Set((invites ?? []).map((i) => (i.email ?? "").toLowerCase()));

  for (const p of profiles) {
    const email = (p.email ?? "").toLowerCase();
    if (!email || invited.has(email)) continue;
    report.missing++;
    if (report.queued >= limit) continue;
    const res = await inviteLeadByEmail(admin, {
      email,
      firstName: p.first_name,
      whatsapp: p.whatsapp,
    });
    if (res.ok) report.queued++;
    else report.blocked[res.reason] = (report.blocked[res.reason] ?? 0) + 1;
  }
  return report;
}

export async function dispatchQueuedInvites(
  admin: Admin,
  batchSize: number,
): Promise<{ claimed: number; sent: number; failed: number; skipped: string }> {
  const report = { claimed: 0, sent: 0, failed: 0, skipped: "" };
  if (!process.env.SKOOL_INVITE_WEBHOOK_URL) {
    report.skipped = "skool invite webhook not configured";
    return report;
  }

  const { data: rows } = await admin
    .from("skool_invites")
    .select("*")
    .in("status", ["queued"])
    .lt("attempts", MAX_INVITE_ATTEMPTS)
    .order("requested_at", { ascending: true })
    .limit(batchSize)
    .returns<SkoolInvite[]>();

  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: stale } = await admin
    .from("skool_invites")
    .select("*")
    .eq("status", "sending")
    .lt("last_attempt_at", staleCutoff)
    .lt("attempts", MAX_INVITE_ATTEMPTS)
    .limit(batchSize)
    .returns<SkoolInvite[]>();

  for (const invite of [...(rows ?? []), ...(stale ?? [])]) {
    report.claimed++;
    if (await dispatchInvite(admin, invite)) report.sent++;
    else report.failed++;
  }
  return report;
}
