import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  NURTURE_PLAN,
  timezoneForPhone,
  whatsappMarketingAllowed,
  withinSendingHours,
} from "@/lib/data/lanes";
import { signFunnelBody } from "@/lib/funnel/hmac";
import { sendPartnerWhatsApp, getSharedSenderLoad } from "@/lib/integrations/whatsapp";
import { sendEmail } from "@/lib/integrations/resend";
import { LEAD_STAGES } from "@/lib/data/signup-leads";
import type { FunnelSettings, SignupLead, SkoolInvite } from "@/types/database";

export const maxDuration = 300;

// The funnel's single heartbeat, every 5 minutes. Two independent phases so a failure in
// one cannot silence the other:
//   1. Skool invite dispatch: queued skool_invites -> the Zapier catch hook.
//   2. Nurture: due leads -> WhatsApp template or email, under all the guards.
//
// Everything here is idempotent: invites claim rows via status transitions and carry an
// idempotency key end to end; nurture_sends has unique (lead_id, step) so a crashed run
// cannot double-send.

const MAX_INVITE_ATTEMPTS = 5;
const INVITE_BATCH = 20;
const NURTURE_BATCH = 50;

// Meta template SIDs are resolved by template KEY through env so a re-submitted template
// is a config change, not a deploy.
const TEMPLATE_SIDS: Record<string, string | undefined> = {
  heypubli_welcome: process.env.WA_TEMPLATE_WELCOME_SID,
  heypubli_nudge_signup: process.env.WA_TEMPLATE_NUDGE_SIGNUP_SID,
  heypubli_nudge_connect: process.env.WA_TEMPLATE_NUDGE_CONNECT_SID,
};

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
  const hookUrl = process.env.ZAPIER_SKOOL_HOOK_URL;
  const hookSecret = process.env.ZAPIER_HOOK_SECRET;
  const report = { claimed: 0, sent: 0, failed: 0, skipped: "" };
  if (!hookUrl || !hookSecret) {
    report.skipped = "zapier hook not configured";
    return report;
  }

  // Claim queued rows by flipping status; stale 'sending' rows (a crashed run) fall back
  // after 30 minutes via the retry below.
  const { data: rows } = await admin
    .from("skool_invites")
    .select("*")
    .in("status", ["queued"])
    .lt("attempts", MAX_INVITE_ATTEMPTS)
    .order("requested_at", { ascending: true })
    .limit(INVITE_BATCH)
    .returns<SkoolInvite[]>();
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: stale } = await admin
    .from("skool_invites")
    .select("*")
    .eq("status", "sending")
    .lt("last_attempt_at", staleCutoff)
    .lt("attempts", MAX_INVITE_ATTEMPTS)
    .limit(INVITE_BATCH)
    .returns<SkoolInvite[]>();

  const batch = [...(rows ?? []), ...(stale ?? [])];
  for (const invite of batch) {
    report.claimed++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("skool_invites") as any)
      .update({
        status: "sending",
        attempts: invite.attempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    const payload = JSON.stringify({
      idempotency_key: invite.idempotency_key,
      email: invite.email,
      first_name: invite.first_name,
      lane: invite.lane,
    });
    try {
      const res = await fetch(hookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Funnel-Signature": signFunnelBody(payload, hookSecret),
        },
        body: payload,
      });
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("skool_invites") as any)
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", invite.id);
        report.sent++;
      } else {
        throw new Error(`zapier ${res.status}`);
      }
    } catch (e) {
      const attempts = invite.attempts + 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("skool_invites") as any)
        .update({
          status: attempts >= MAX_INVITE_ATTEMPTS ? "failed" : "queued",
          last_error: e instanceof Error ? e.message : "send failed",
        })
        .eq("id", invite.id);
      report.failed++;
    }
  }
  return report;
}

async function runNurture(
  admin: ReturnType<typeof createAdminClient>,
  settings: FunnelSettings,
) {
  const report = { due: 0, sent: 0, skippedConverted: 0, blocked: 0, deferred: 0 };
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

    // Business hours where the lead actually is, guessed from their dialling code. This
    // was hardcoded to Sao Paulo for every lead, which on a worldwide list means 23:00 in
    // the UK and 04:00 on the US west coast.
    if (!withinSendingHours(new Date(), timezoneForPhone(phone))) {
      report.deferred++;
      continue; // nurture_next_at stays put; the next in-hours tick picks it up.
    }

    const waAllowed =
      settings.whatsapp_enabled &&
      Boolean(phone) &&
      whatsappMarketingAllowed(phone) &&
      !lead.whatsapp_undeliverable_code;
    const channel = step.channel === "whatsapp" && waAllowed ? "whatsapp" : "email";

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
      // Row exists: a previous run already handled this step. Advance the pointer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({ nurture_step: lead.nurture_step + 1 })
        .eq("id", lead.id);
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
      .eq("id", lead.id);
    if (sent) report.sent++;
  }
  return report;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("funnel_settings")
    .select("*")
    .eq("id", "default")
    .single<FunnelSettings>();
  if (!settings) {
    return NextResponse.json({ error: "no funnel_settings row" }, { status: 500 });
  }

  const [invites, nurture] = await Promise.allSettled([
    settings.skool_invites_enabled
      ? dispatchSkoolInvites(admin)
      : Promise.resolve({ disabled: true }),
    runNurture(admin, settings),
  ]);

  return NextResponse.json({
    ok: true,
    invites: invites.status === "fulfilled" ? invites.value : { error: String(invites.reason) },
    nurture: nurture.status === "fulfilled" ? nurture.value : { error: String(nurture.reason) },
  });
}
