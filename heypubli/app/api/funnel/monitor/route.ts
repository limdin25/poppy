import { NextResponse } from "next/server";
import {
  buildFunnelReport,
  shouldEmailNow,
  shouldPauseNurture,
  type MonitorData,
  type MonitorFailure,
  type MonitorNobodyChasing,
  type MonitorSend,
} from "@/lib/data/funnel-monitor";
import { NURTURE_PLAN, NURTURE_TEMPLATE_SIDS } from "@/lib/data/lanes";
import { ONB_TEMPLATES } from "@/lib/data/onboarding-nudges";
import { getInboxSummary, getTemplateStatuses } from "@/lib/integrations/whatsapp";
import { sendEmail } from "@/lib/integrations/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FunnelMonitorState, FunnelSettings, NurtureSend } from "@/types/database";

export const maxDuration = 120;

// Hugo's eyes on the funnel, every 5 minutes: new leads, what was sent, what failed,
// who is waiting on a reply, whether the lead sheet is still being read, which templates
// Meta is still sitting on. It ALWAYS emails, including "quiet", because a silent report
// and a broken reporter look identical.
//
// It is also the funnel's circuit breaker: 3 failed sends inside the last 15 minutes
// flips nurture_enabled off and says so loudly, in EVERY email until somebody turns it
// back on, not just the one that flipped it. The pause reason is persisted before the
// email is attempted, so a Resend outage cannot swallow the alarm.

const EMAIL_TO = process.env.MONITOR_EMAIL_TO ?? "hugodesouzax@gmail.com";

// The breaker judges a FIXED recent window, independent of the email watermark. Tying
// it to the watermark meant a stuck watermark re-counted the same old failures forever
// and re-paused the drip the moment anybody resumed it.
const BREAKER_WINDOW_MS = 15 * 60 * 1000;

// The watch-page welcome, still pending with Meta on 07 Aug 2026. Watched here so the
// email announces the moment it approves and the first touch can move to the video.
const WATCH_VIDEO_SID = "HXf42259871d5ed945734996d2c166298c";

function watchedTemplateSids(): string[] {
  const sids = [
    process.env.WA_TEMPLATE_WELCOME_SID,
    process.env.WA_TEMPLATE_NUDGE_SIGNUP_SID,
    process.env.WA_TEMPLATE_NUDGE_CONNECT_SID,
    WATCH_VIDEO_SID,
    ...Object.values(ONB_TEMPLATES.keys),
  ].filter((s): s is string => Boolean(s));
  return [...new Set(sids)];
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const gatherErrors: string[] = [];

  const { data: state, error: stateErr } = await admin
    .from("funnel_monitor_state")
    .select("*")
    .eq("id", "default")
    .maybeSingle<FunnelMonitorState>();
  if (stateErr) gatherErrors.push("watermark read failed, window fell back to 10 min");
  const windowStart = state?.last_run_at
    ? new Date(state.last_run_at)
    : new Date(now.getTime() - 10 * 60 * 1000);
  const sinceIso = windowStart.toISOString();

  const { data: settings } = await admin
    .from("funnel_settings")
    .select("*")
    .eq("id", "default")
    .single<FunnelSettings>();
  if (!settings) {
    return NextResponse.json({ error: "no funnel_settings row" }, { status: 500 });
  }

  // New leads in the window.
  const { data: newLeadsRaw, error: leadsErr } = await admin
    .from("signup_leads")
    .select("first_name, source, lane, status")
    .gte("first_seen_at", sinceIso)
    .order("first_seen_at", { ascending: true })
    .returns<{ first_name: string; source: string; lane: string; status: string }[]>();
  if (leadsErr) gatherErrors.push("signup_leads");

  // Nurture activity. Sent rows window on sent_at (the status flips after created_at,
  // so windowing everything on created_at lost any send that resolved after the
  // watermark passed). Failures window on created_at, which is same-run. Stuck rows
  // are queued for over 15 min: a crashed run, reported so nobody resends by hand.
  const { data: sentRaw, error: sentErr } = await admin
    .from("nurture_sends")
    .select("lead_id, template_key, channel, status, error_code, created_at, sent_at")
    .gte("sent_at", sinceIso)
    .returns<NurtureSend[]>();
  if (sentErr) gatherErrors.push("nurture_sends sent");
  const { data: failedRaw, error: failedErr } = await admin
    .from("nurture_sends")
    .select("lead_id, template_key, channel, status, error_code, created_at, sent_at")
    .eq("status", "failed")
    .gte("created_at", sinceIso)
    .returns<NurtureSend[]>();
  if (failedErr) gatherErrors.push("nurture_sends failed");
  const { count: stuckQueued } = await admin
    .from("nurture_sends")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .lt("created_at", new Date(now.getTime() - 15 * 60 * 1000).toISOString());

  const sends = [...(sentRaw ?? []), ...(failedRaw ?? [])];
  const leadIds = [...new Set(sends.map((s) => s.lead_id))];
  const names = new Map<string, string>();
  if (leadIds.length) {
    const { data: leadRows } = await admin
      .from("signup_leads")
      .select("id, first_name")
      .in("id", leadIds)
      .returns<{ id: string; first_name: string }[]>();
    for (const l of leadRows ?? []) names.set(l.id, l.first_name);
  }
  const nurtureSent: MonitorSend[] = (sentRaw ?? [])
    .filter((s) => s.status === "sent")
    .map((s) => ({
      template_key: s.template_key,
      channel: s.channel,
      lead_name: names.get(s.lead_id) ?? s.lead_id.slice(0, 8),
    }));
  const nurtureFailed: MonitorFailure[] = (failedRaw ?? []).map((s) => ({
    template_key: s.template_key,
    channel: s.channel,
    lead_name: names.get(s.lead_id) ?? s.lead_id.slice(0, 8),
    error_code: s.error_code,
  }));

  // Skool invites in the window.
  const { count: invitesSent } = await admin
    .from("skool_invites")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", sinceIso);
  const { count: invitesFailed } = await admin
    .from("skool_invites")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("last_attempt_at", sinceIso);

  // The reply brain's activity in the window.
  const { data: replyRows, error: replyErr } = await admin
    .from("funnel_replies")
    .select("phone, kind, status, reason, created_at")
    .gte("created_at", sinceIso)
    .returns<{ phone: string; kind: string; status: string; reason: string | null }[]>();
  if (replyErr) gatherErrors.push("funnel_replies");
  const rr = replyRows ?? [];
  // A claim stuck at 'pending' past 15 minutes is a run that died between claim and
  // send: that inbound can never be auto-answered again (one action per message), so
  // it must surface as a failure, not vanish.
  const staleCutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const { count: stalePending } = await admin
    .from("funnel_replies")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", staleCutoff);
  const autoReply = {
    replied: rr.filter((r) => r.kind === "reply" && r.status === "sent").length,
    checkIns: rr.filter((r) => r.kind === "check_in" && r.status === "sent").length,
    refusals: rr.filter((r) => r.kind === "refusal").length,
    failed:
      rr.filter(
        (r) => (r.kind === "reply" || r.kind === "check_in") && !["sent", "pending", "done"].includes(r.status),
      ).length + (stalePending ?? 0),
    handovers: rr
      .filter((r) => r.kind === "handover")
      .map((r) => ({ phone: r.phone, reason: r.reason ?? "unplaceable" })),
  };

  // Who is waiting on us, straight from the CRM.
  const inbox = await getInboxSummary();
  if (!inbox.ok) gatherErrors.push("inbox_summary");

  // THE MISS DETECTOR. A miss is precise: a waiting thread whose NEWEST inbound
  // has no funnel_replies row at all and whose lead is not opted out. Deliberate
  // stops (handover, refusal, recorded silence) all leave rows, so anything
  // caught here was genuinely never looked at. Three minutes of grace covers the
  // settle pause and cron latency.
  const neverLooked: MonitorData["neverLooked"] = [];
  const candidates = (inbox.waiting ?? []).filter((w) => (w.waiting_minutes ?? 0) >= 3);
  if (candidates.length) {
    const phones = candidates.map((w) => w.phone);
    const { data: claims, error: claimsErr } = await admin
      .from("funnel_replies")
      .select("phone, created_at")
      .in("phone", phones)
      .order("created_at", { ascending: false })
      .limit(1000)
      .returns<{ phone: string; created_at: string }[]>();
    if (claimsErr) gatherErrors.push("funnel_replies miss check");
    const newestClaim = new Map<string, string>();
    for (const c of claims ?? []) {
      if (!newestClaim.has(c.phone)) newestClaim.set(c.phone, c.created_at);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: optRows } = (await (admin.from("signup_leads") as any)
      .select("whatsapp, whatsapp_e164, whatsapp_opted_out_at")
      .not("whatsapp_opted_out_at", "is", null)) as {
      data: { whatsapp: string | null; whatsapp_e164: string | null }[] | null;
    };
    const optedOut = new Set(
      (optRows ?? []).flatMap((r) => [r.whatsapp, r.whatsapp_e164]).filter(Boolean) as string[],
    );
    for (const w of candidates) {
      if (optedOut.has(w.phone)) continue;
      const claimAt = newestClaim.get(w.phone);
      if (!claimAt || (w.last_inbound_at && claimAt < w.last_inbound_at)) {
        neverLooked.push(w);
      }
    }
  }

  // Template approvals, straight from Twilio.
  const templates = await getTemplateStatuses(watchedTemplateSids());
  if (!templates.ok) gatherErrors.push("template_status");

  // Who is stuck behind an unapproved template right now.
  let templateDeferredLeads = 0;
  if (templates.ok && templates.templates) {
    const unapprovedSids = new Set(
      templates.templates.filter((t) => t.status !== "approved").map((t) => t.sid),
    );
    const stuckSteps = NURTURE_PLAN.filter((s) => {
      if (s.channel !== "whatsapp") return false;
      const sid = NURTURE_TEMPLATE_SIDS[s.templateKey];
      return !sid || unapprovedSids.has(sid);
    }).map((s) => s.step);
    if (stuckSteps.length) {
      const { count } = await admin
        .from("signup_leads")
        .select("id", { count: "exact", head: true })
        .eq("nurture_state", "active")
        .in("nurture_step", stuckSteps);
      templateDeferredLeads = count ?? 0;
    }
  }

  // Undelivered in the last 48h: found by the tick's delivery sweep.
  const twoDaysAgo = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
  const { count: undeliveredNurture } = await admin
    .from("nurture_sends")
    .select("id", { count: "exact", head: true })
    .eq("status", "undelivered")
    .gte("created_at", twoDaysAgo);
  const { count: undeliveredReplies } = await admin
    .from("funnel_replies")
    .select("id", { count: "exact", head: true })
    .eq("status", "undelivered")
    .gte("created_at", twoDaysAgo);
  const undelivered48h = (undeliveredNurture ?? 0) + (undeliveredReplies ?? 0);

  // Nobody is chasing these. Two ways a person falls out of every ladder:
  //  1. A lead whose drip finished or never armed while they were still
  //     pre-signup (post-signup people belong to the onboarding nudges).
  //  2. A creator mid-onboarding whose nudge ladder stopped for good.
  const nobodyChasing: MonitorNobodyChasing[] = [];
  const { data: strandedLeads } = await admin
    .from("signup_leads")
    .select("first_name, email, nurture_state, status")
    .in("nurture_state", ["idle", "exhausted"])
    .is("whatsapp_opted_out_at", null)
    .in("status", ["captured", "contacted", "engaged"])
    .returns<{ first_name: string; email: string; nurture_state: string; status: string }[]>();
  for (const l of strandedLeads ?? []) {
    if (l.email.toLowerCase().endsWith("@heypubli-qa.com")) continue;
    nobodyChasing.push({
      name: l.first_name || l.email,
      why:
        l.nurture_state === "exhausted"
          ? "the drip finished all its steps with no reply"
          : "no drip was ever armed for them",
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stoppedNudges } = (await (admin.from("onboarding_nudge_state") as any)
    .select("profile_id, stop_reason, stopped_at")
    .not("stopped_at", "is", null)) as {
    data: { profile_id: string; stop_reason: string | null }[] | null;
  };
  if (stoppedNudges?.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stoppedProfiles } = (await (admin.from("profiles") as any)
      .select("id, first_name, email, onboarding_complete")
      .in("id", stoppedNudges.map((s) => s.profile_id))
      .eq("onboarding_complete", false)) as {
      data: { id: string; first_name: string | null; email: string }[] | null;
    };
    const reasonBy = new Map(stoppedNudges.map((s) => [s.profile_id, s.stop_reason]));
    for (const p of stoppedProfiles ?? []) {
      if (p.email.toLowerCase().endsWith("@heypubli-qa.com")) continue;
      const reason = reasonBy.get(p.id) ?? "stopped";
      // A refusal or opt-out is not "fell through the cracks", it is a no.
      if (reason === "opted_out" || reason === "refused in chat" || reason === "do_not_text") continue;
      nobodyChasing.push({
        name: p.first_name || p.email,
        why: `mid-onboarding, nudges stopped (${reason})`,
      });
    }
  }

  // Circuit breaker on the FIXED recent window.
  let pausedReason: string | null = null;
  if (settings.nurture_enabled) {
    const { count: recentFailed } = await admin
      .from("nurture_sends")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", new Date(now.getTime() - BREAKER_WINDOW_MS).toISOString());
    if (shouldPauseNurture(recentFailed ?? 0)) {
      const reason = `${recentFailed} failed sends in 15 minutes`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: pauseErr } = await (admin.from("funnel_settings") as any)
        .update({ nurture_enabled: false, updated_at: now.toISOString() })
        .eq("id", "default");
      if (pauseErr) {
        // The one lie this email must never tell is "paused" while it still runs.
        gatherErrors.push("BREAKER TRIPPED BUT THE PAUSE WRITE FAILED, THE DRIP IS STILL RUNNING");
      } else {
        pausedReason = reason;
        settings.nurture_enabled = false;
        // Persist the alarm BEFORE attempting the email: a Resend outage in this
        // exact run must not swallow the only record of why the funnel stopped.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("funnel_monitor_state") as any).upsert({
          id: "default",
          paused_reason: reason,
          updated_at: now.toISOString(),
        });
      }
    }
  }

  // Sticky alarm: while nurture is off and a stored pause reason exists, every email
  // keeps shouting it. Cleared automatically once somebody re-enables the drip.
  if (!pausedReason && !settings.nurture_enabled && state?.paused_reason) {
    pausedReason = state.paused_reason;
  }
  if (settings.nurture_enabled && state?.paused_reason) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("funnel_monitor_state") as any).upsert({
      id: "default",
      paused_reason: null,
      updated_at: now.toISOString(),
    });
  }

  // Sheet-sync health, written by the sheet-sync cron on every run.
  const sheetSync = {
    lastOkAt: state?.sheet_sync_last_ok_at ?? null,
    error: state?.sheet_sync_last_error ?? null,
    staleMinutes: state?.sheet_sync_last_ok_at
      ? Math.round((now.getTime() - Date.parse(state.sheet_sync_last_ok_at)) / 60000)
      : null,
  };

  const staleMin = (iso: string | null | undefined): number | null =>
    iso ? Math.round((now.getTime() - Date.parse(iso)) / 60000) : null;

  const data: MonitorData = {
    now,
    windowStart,
    settings: {
      nurture_enabled: settings.nurture_enabled,
      whatsapp_enabled: settings.whatsapp_enabled,
      onboarding_nudges_enabled: settings.onboarding_nudges_enabled,
      skool_invites_enabled: settings.skool_invites_enabled,
      auto_reply_enabled: settings.auto_reply_enabled,
    },
    newLeads: newLeadsRaw ?? [],
    nurtureSent,
    nurtureFailed,
    stuckQueued: stuckQueued ?? 0,
    invitesSent: invitesSent ?? 0,
    invitesFailed: invitesFailed ?? 0,
    waiting: inbox.waiting ?? [],
    neverLooked,
    templates: templates.templates ?? [],
    sheetSync,
    heartbeats: {
      replyStaleMinutes: staleMin(state?.reply_last_ok_at),
      tickStaleMinutes: staleMin(state?.tick_last_ok_at),
    },
    refusedBlocked: state?.sheet_sync_last_refused_blocked ?? 0,
    nobodyChasing,
    undelivered48h,
    templateDeferredLeads,
    autoReply,
    pausedReason,
    gatherErrors,
  };

  const report = buildFunnelReport(data);

  // Hugo, 07 Aug 2026: "make it every hour". The cron stays at 5 minutes because
  // the circuit breaker above needs it, only the email is throttled. Anything
  // broken still goes out at once. See shouldEmailNow for why a waiting lead
  // does not count as urgent.
  const decision = shouldEmailNow(
    data,
    state?.last_email_at ? new Date(state.last_email_at) : null,
  );
  const emailed = decision.send
    ? await sendEmail({ to: EMAIL_TO, subject: report.subject, html: report.html })
    : false;

  // Advance the watermark ONLY when the email went out, so a Resend outage replays
  // the window instead of swallowing it. (A rare overlapping run can double-email;
  // a duplicate email is harmless, a lost window is not.)
  let watermarkError: string | null = null;
  if (emailed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: wmErr } = await (admin.from("funnel_monitor_state") as any).upsert({
      id: "default",
      last_run_at: now.toISOString(),
      last_email_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    if (wmErr) watermarkError = wmErr.message ?? "watermark write failed";
  }

  return NextResponse.json({
    ok: true,
    emailed,
    emailReason: decision.reason,
    subject: report.subject,
    newLeads: data.newLeads.length,
    sent: nurtureSent.length,
    failed: nurtureFailed.length,
    stuckQueued: data.stuckQueued,
    waiting: data.waiting.length,
    neverLooked: neverLooked.length,
    nobodyChasing: nobodyChasing.length,
    undelivered48h,
    templateDeferredLeads,
    heartbeats: data.heartbeats,
    paused: pausedReason,
    watermarkError,
    gatherErrors,
  });
}
