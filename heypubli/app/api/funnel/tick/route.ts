import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  NURTURE_PLAN,
  NURTURE_TEMPLATE_SIDS,
  mayContactNow,
  timezoneForPhone,
  whatsappMarketingAllowed,
} from "@/lib/data/lanes";
import {
  backfillMissingInvites,
  dispatchQueuedInvites,
} from "@/lib/data/skool-invite-dispatch";
import { pitchBlockedForPhone } from "@/lib/data/reply-brain";
import { LIVE_THREAD_WINDOW_MS } from "@/lib/data/lead-arming";
import {
  getContactState,
  getPartnerMessageStatus,
  sendPartnerWhatsApp,
  getSharedSenderLoad,
} from "@/lib/integrations/whatsapp";
import { sendEmail } from "@/lib/integrations/resend";
import { LEAD_STAGES } from "@/lib/data/signup-leads";
import { runBioVerification, runOnboardingNudges } from "@/lib/data/onboarding-nudges";
import type { FunnelSettings, SignupLead } from "@/types/database";

export const maxDuration = 300;

// The funnel's single heartbeat, every 5 minutes. Three independent phases so a failure
// in one cannot silence the others:
//   1. Skool invite dispatch: queued skool_invites -> Skool's own invite webhook.
//   2. Nurture: due PRE-signup leads -> WhatsApp template or email, under all the guards.
//   3. Onboarding nudges: signed-up creators stuck mid-funnel -> a step-specific
//      WhatsApp message (lib/data/onboarding-nudges.ts).
//
// Everything here is idempotent: invites claim rows via status transitions and carry an
// idempotency key end to end; nurture_sends has unique (lead_id, step) so a crashed run
// cannot double-send; onboarding nudges carry a unique external_id per attempt.

const INVITE_BATCH = 20;
const NURTURE_BATCH = 50;

// Meta template SIDs live in lib/data/lanes.ts (NURTURE_TEMPLATE_SIDS), shared
// with the monitor so "who is stuck behind an approval" is counted off the same map.
const TEMPLATE_SIDS = NURTURE_TEMPLATE_SIDS;

const EMAIL_BODIES: Record<string, (firstName: string) => { subject: string; html: string }> = {
  email_nudge_signup: (first) => ({
    subject: "Your spot is still open",
    html: `<p>Hi ${first || "there"},</p>
<p>You asked about putting your Instagram to work with HeyPubli. Your spot is still open, and it takes about two minutes to finish:</p>
<p><a href="https://heypubli.com/signup">Finish your signup</a></p>
<p>We post the content, you earn 40% commission on every sale. If you have questions, just reply to this email.</p>
<p>HeyPubli</p>`,
  }),
};

function stageIndex(stage: SignupLead["status"]): number {
  return LEAD_STAGES.indexOf(stage);
}

async function dispatchSkoolInvites(admin: ReturnType<typeof createAdminClient>) {
  // The real work lives in lib/data/skool-invite-dispatch so the button on step
  // 2 and this cron send an invite the same way. The cron is now the RETRY, not
  // the only path: a creator who presses the button gets their email at once.
  //
  // The backfill runs FIRST, so an account that was never invited at all is
  // queued and then sent in the same tick. Four creators had been sitting
  // behind that gap for days (08 Aug 2026); it is the whole reason step 2 is
  // the wall in this funnel.
  const backfill = await backfillMissingInvites(admin);
  const dispatch = await dispatchQueuedInvites(admin, INVITE_BATCH);
  return { ...dispatch, backfill };
}

async function runNurture(
  admin: ReturnType<typeof createAdminClient>,
  settings: FunnelSettings,
) {
  const report = {
    due: 0,
    sent: 0,
    skippedConverted: 0,
    blocked: 0,
    deferred: 0,
    stoppedLiveThread: 0,
  };
  if (!settings.nurture_enabled) return { ...report, disabled: true };

  const { data: due } = await admin
    .from("signup_leads")
    .select("*")
    .eq("nurture_state", "active")
    .lte("nurture_next_at", new Date().toISOString())
    .order("nurture_next_at", { ascending: true })
    .limit(NURTURE_BATCH)
    .returns<SignupLead[]>();
  if (!due?.length) return report;

  // The shared 250/24h tier: count BOTH businesses' sends before spending.
  let sharedLoad: number | null = null;
  const loadRes = await getSharedSenderLoad();
  if (loadRes.ok && typeof loadRes.sent24h === "number") sharedLoad = loadRes.sent24h;

  for (const lead of due as SignupLead[]) {
    report.due++;
    const step = NURTURE_PLAN.find((s) => s.step === lead.nurture_step);
    const nowIso = new Date().toISOString();

    // Sequence exhausted.
    if (!step) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({ nurture_state: "exhausted", nurture_stop_reason: "sequence complete" })
        .eq("id", lead.id);
      continue;
    }

    // Converted past this step's goal: stop nurturing, they did the thing.
    if (stageIndex(lead.status) >= stageIndex(step.skipAtOrPast)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({ nurture_state: "stopped", nurture_stop_reason: "converted" })
        .eq("id", lead.id);
      report.skippedConverted++;
      continue;
    }

    // Opted out or undeliverable: blocked for good.
    if (lead.whatsapp_opted_out_at) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({ nurture_state: "blocked", nurture_stop_reason: "opted out" })
        .eq("id", lead.id);
      report.blocked++;
      continue;
    }

    const phone = lead.whatsapp_e164 ?? lead.whatsapp;

    // We do not RECRUIT somebody Skool cannot pay. Hugo, 07 Aug 2026: "stop
    // pitching them." Every step this loop sends is recruitment, so a blocked
    // lead is stopped here rather than filtered later.
    //
    // This guard exists separately from the one in the reply brain because the
    // two paths are genuinely separate: that one answers people who WRITE to
    // us, this one starts the conversation. Fixing only the reply side left the
    // welcome template still going out, which is exactly what happened for the
    // first hours after the ads went live.
    if (pitchBlockedForPhone(phone)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({ nurture_state: "stopped", nurture_stop_reason: "payouts blocked for this country" })
        .eq("id", lead.id);
      report.blocked++;
      continue;
    }

    // Business hours where the lead actually is, guessed from their dialling code,
    // EXCEPT when the lead's own action is fresh. Hugo, 07 Aug 2026: "If they come
    // in the middle of the night, we still reply them because they are awake." A
    // form submitted at 23:14 is a person holding their phone right now; the sweep
    // re-arming a three-day-old stray is not, and mayContactNow tells them apart.
    if (!mayContactNow(new Date(), timezoneForPhone(phone), lead.last_seen_at ?? lead.first_seen_at)) {
      report.deferred++;
      continue; // nurture_next_at stays put; the next in-hours tick picks it up.
    }

    const waAllowed =
      settings.whatsapp_enabled &&
      Boolean(phone) &&
      whatsappMarketingAllowed(phone) &&
      !lead.whatsapp_undeliverable_code;
    const channel = step.channel === "whatsapp" && waAllowed ? "whatsapp" : "email";

    // Last line of defence against templating a LIVE thread. A reply normally stops
    // the drip via the inbound relay, but the relay only matches contacts stamped
    // product=heypubli; a lead whose first message beat our first send used to slip
    // through and get the cold template on top of their own open conversation. This
    // check runs at the only moment it is too late to fix afterwards: right before
    // the send.
    if (channel === "whatsapp") {
      const thread = await getContactState(phone);
      if (
        thread.ok &&
        thread.last_inbound_at &&
        Date.now() - Date.parse(thread.last_inbound_at) < LIVE_THREAD_WINDOW_MS
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("signup_leads") as any)
          .update({
            engaged_at: lead.engaged_at ?? thread.last_inbound_at,
            nurture_state: "stopped",
            nurture_stop_reason: "live conversation",
          })
          .eq("id", lead.id);
        report.stoppedLiveThread++;
        continue;
      }
    }

    // Idempotency by construction: one row per (lead, step), ever.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dupErr } = await (admin.from("nurture_sends") as any).insert({
      lead_id: lead.id,
      step: step.step,
      template_key: step.templateKey,
      channel,
    });
    if (dupErr) {
      if (dupErr.code !== "23505") console.error("[tick] nurture insert", dupErr);
      // Row exists: some run already touched this step. Do NOT advance blindly. The
      // row could be another run's IN-FLIGHT claim, or could have been deleted by a
      // defer between our insert and now; advancing past a step that never sent is
      // how a lead loses their welcome. Only a resolved row (sent or failed) moves
      // the pointer, and the update is guarded on the pointer we read, so two racers
      // can never double-advance.
      const { data: dupRow } = await admin
        .from("nurture_sends")
        .select("status")
        .eq("lead_id", lead.id)
        .eq("step", step.step)
        .maybeSingle<{ status: string }>();
      if (!dupRow || !["sent", "failed"].includes(dupRow.status)) continue;
      const stepAfterDup = NURTURE_PLAN.find((s) => s.step === lead.nurture_step + 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({
          nurture_step: lead.nurture_step + 1,
          nurture_next_at: stepAfterDup
            ? new Date(Date.now() + stepAfterDup.afterHours * 3600 * 1000).toISOString()
            : null,
          nurture_state: stepAfterDup ? "active" : "exhausted",
          nurture_stop_reason: stepAfterDup ? null : "sequence complete",
        })
        .eq("id", lead.id)
        .eq("nurture_step", lead.nurture_step);
      continue;
    }

    let sent = false;
    let errorCode: string | null = null;

    if (channel === "whatsapp") {
      if (sharedLoad !== null && sharedLoad >= settings.daily_template_cap) {
        // Cap reached: mark skipped, retry the same step next day by pushing next_at.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("nurture_sends") as any)
          .delete()
          .eq("lead_id", lead.id)
          .eq("step", step.step);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("signup_leads") as any)
          .update({ nurture_next_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
          .eq("id", lead.id);
        report.deferred++;
        continue;
      }
      const sid = TEMPLATE_SIDS[step.templateKey];
      const deferStep = async () => {
        // Not the lead's fault (template still pending with Meta, or not configured).
        // Release the step and retry tomorrow instead of burning it: the welcome must
        // not be spent on a send that never happened.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("nurture_sends") as any)
          .delete()
          .eq("lead_id", lead.id)
          .eq("step", step.step);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("signup_leads") as any)
          .update({ nurture_next_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
          .eq("id", lead.id);
      };
      if (!sid) {
        await deferStep();
        report.deferred++;
        continue;
      } else {
        const res = await sendPartnerWhatsApp({
          to: phone,
          firstName: lead.first_name,
          contentSid: sid,
          externalId: `nurture:${lead.id}:${step.step}`,
        });
        if (res.ok) {
          sent = true;
          if (sharedLoad !== null) sharedLoad++;
        } else if (res.blocked === "template_unapproved") {
          await deferStep();
          report.deferred++;
          continue;
        } else {
          errorCode = res.blocked ?? res.error ?? "send_failed";
          if (res.blocked === "do_not_text") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin.from("signup_leads") as any)
              .update({
                nurture_state: "blocked",
                nurture_stop_reason: "do-not-text",
                whatsapp_opted_out_at: nowIso,
              })
              .eq("id", lead.id);
          }
        }
      }
    } else {
      const make = EMAIL_BODIES[step.templateKey] ?? EMAIL_BODIES.email_nudge_signup;
      const mail = make(lead.first_name);
      sent = await sendEmail({
        to: lead.email,
        subject: mail.subject,
        html: mail.html,
      });
      if (!sent) errorCode = "email_failed";
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("nurture_sends") as any)
      .update({
        status: sent ? "sent" : "failed",
        error_code: errorCode,
        sent_at: sent ? nowIso : null,
      })
      .eq("lead_id", lead.id)
      .eq("step", step.step);

    const next = NURTURE_PLAN.find((s) => s.step === lead.nurture_step + 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("signup_leads") as any)
      .update({
        nurture_step: lead.nurture_step + 1,
        nurture_last_sent_at: sent ? nowIso : lead.nurture_last_sent_at,
        nurture_next_at: next
          ? new Date(Date.now() + next.afterHours * 3600 * 1000).toISOString()
          : null,
        nurture_state: next ? "active" : "exhausted",
        nurture_stop_reason: next ? null : "sequence complete",
        status: lead.status === "captured" && sent ? "contacted" : lead.status,
        contacted_at:
          lead.status === "captured" && sent ? nowIso : lead.contacted_at,
      })
      .eq("id", lead.id)
      // Guarded on the pointer we read: a racer that already advanced makes this a
      // no-op instead of a double-advance that skips a step.
      .eq("nurture_step", lead.nurture_step);
    if (sent) report.sent++;
  }
  return report;
}

/**
 * Delivery truth for the newest WhatsApp sends. Twilio accepts a message (201)
 * and can fail it minutes later; the status callback writes that onto the
 * Elsie message row, and this sweep copies it back here, where the drip and
 * the monitor actually decide things. Rows flipped off 'sent' leave the poll
 * set, so nothing is polled forever.
 */
async function sweepDeliveryStatus(admin: ReturnType<typeof createAdminClient>) {
  const report = { checked: 0, undelivered: 0 };
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const DEAD = new Set(["undelivered", "failed"]);

  const { data: sends } = await admin
    .from("nurture_sends")
    .select("lead_id, step")
    .eq("status", "sent")
    .eq("channel", "whatsapp")
    .gte("sent_at", dayAgo)
    .limit(20)
    .returns<{ lead_id: string; step: number }[]>();
  for (const s of sends ?? []) {
    const res = await getPartnerMessageStatus(`nurture:${s.lead_id}:${s.step}`);
    report.checked++;
    if (res.ok && res.status && DEAD.has(res.status)) {
      report.undelivered++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("nurture_sends") as any)
        .update({ status: "undelivered", error_code: res.status })
        .eq("lead_id", s.lead_id)
        .eq("step", s.step);
      // The column the drip's channel pick reads before every send. It had
      // readers and no writers until 07 Aug 2026.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({ whatsapp_undeliverable_code: res.status })
        .eq("id", s.lead_id);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: replies } = (await (admin.from("funnel_replies") as any)
    .select("id, in_reply_to")
    .eq("kind", "reply")
    .eq("status", "sent")
    .not("in_reply_to", "is", null)
    .gte("created_at", dayAgo)
    .order("created_at", { ascending: false })
    .limit(20)) as { data: { id: string; in_reply_to: string }[] | null };
  for (const r of replies ?? []) {
    const res = await getPartnerMessageStatus(`reply:${r.in_reply_to}`);
    report.checked++;
    if (res.ok && res.status && DEAD.has(res.status)) {
      report.undelivered++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("funnel_replies") as any)
        .update({ status: "undelivered" })
        .eq("id", r.id);
    }
  }
  return report;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // ONE tick at a time. Sheet-sync pokes this route the moment it arms a lead, so
  // overlap with the scheduled run is routine now, and the nurture engine's dedupe
  // was written for the rare case (its 23505 catch-up can race a concurrent defer).
  // The claim is a single conditional UPDATE, so exactly one caller wins; a crashed
  // run self-expires after 4 minutes.
  const lockCutoff = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lock } = await (admin.from("funnel_monitor_state") as any)
    .update({ tick_lock_at: new Date().toISOString() })
    .eq("id", "default")
    .or(`tick_lock_at.is.null,tick_lock_at.lt.${lockCutoff}`)
    .select("id");
  if (!lock?.length) {
    return NextResponse.json({ ok: true, skipped: "another tick is running" });
  }

  try {
    const { data: settings } = await admin
      .from("funnel_settings")
      .select("*")
      .eq("id", "default")
      .single<FunnelSettings>();
    if (!settings) {
      return NextResponse.json({ error: "no funnel_settings row" }, { status: 500 });
    }

    const [invites, nurture, onboarding, bioVerify] = await Promise.allSettled([
      settings.skool_invites_enabled
        ? dispatchSkoolInvites(admin)
        : Promise.resolve({ disabled: true }),
      runNurture(admin, settings),
      runOnboardingNudges(admin, settings),
      // The verify sweep: reads the quiet creators' real Instagram, stamps the
      // bio step when the sentence AND link are genuinely there, and tells
      // them. The reply-runner does the same check when a creator writes;
      // this catches the ones who do the work and never come back.
      runBioVerification(admin),
    ]);

    // Phase 4: delivery is not sending. A nudge Twilio accepted then failed to
    // deliver read as "chased" forever, because nothing ever wrote
    // whatsapp_undeliverable_code (it had readers and no writers). Poll the
    // newest sends and record the truth; the monitor counts what this finds.
    const delivery = await sweepDeliveryStatus(admin);

    // Heartbeat: read by the monitor and Elsie's dead man's switch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("funnel_monitor_state") as any)
      .update({ tick_last_ok_at: new Date().toISOString() })
      .eq("id", "default");

    return NextResponse.json({
      delivery,
      ok: true,
      invites: invites.status === "fulfilled" ? invites.value : { error: String(invites.reason) },
      nurture: nurture.status === "fulfilled" ? nurture.value : { error: String(nurture.reason) },
      onboarding:
        onboarding.status === "fulfilled"
          ? onboarding.value
          : { error: String(onboarding.reason) },
      bioVerify:
        bioVerify.status === "fulfilled"
          ? bioVerify.value
          : { error: String(bioVerify.reason) },
    });
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("funnel_monitor_state") as any)
      .update({ tick_lock_at: null })
      .eq("id", "default");
  }
}
