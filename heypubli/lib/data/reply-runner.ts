import {
  decideCheckIn,
  decideReply,
  pitchBlockedForPhone,
  type ReplyContext,
} from "@/lib/data/reply-brain";
import { llmReply } from "@/lib/data/llm-reply";
import { resolveFunnel, ONBOARDING_STEPS } from "@/lib/data/onboarding";
import { resolveStatesForCron } from "@/lib/data/onboarding-nudges";
import { timezoneForPhone, withinSendingHours } from "@/lib/data/lanes";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import {
  getInboxSummary,
  getThreadMessages,
  sendPartnerWhatsApp,
  type ThreadMessage,
} from "@/lib/integrations/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FunnelSettings, OnboardingStepId, Profile, SignupLead } from "@/types/database";

// The reply brain, wired. Every minute:
//   1. REPLIES: threads whose last message is inbound get decideReply, the tested
//      deterministic layer. Refusals opt the lead out, money-amount questions and
//      anything unplaceable go to a human via the monitor email, everything else is
//      answered with the exact sentence the tests pin.
//   2. CHECK-INS: creators mid-onboarding who went quiet after OUR last message get the
//      two-rung ladder (15 then 90 minutes), free-form, only while their 24h window is
//      open and only in their own daytime. Then the slow template ladder in
//      onboarding-nudges.ts owns them.
//
// Idempotency is claim-first in funnel_replies: ONE action per inbound message and one
// check-in per (profile, step, rung), enforced by unique indexes, so overlapping runs
// cannot double-send. The claim is inserted BEFORE the send; a send that then fails is
// marked on the row and shows in the monitor email rather than being retried blind.

const MAX_REPLIES_PER_RUN = 15;
const MAX_CHECKINS_PER_RUN = 5;
const WINDOW_MS = 24 * 3600 * 1000;

export interface ThreadSplit {
  /** Inbound bodies after our last REAL outbound (drafts are not ours), oldest first. */
  said: string[];
  /** They sent a picture/clip after our last message. Often the screenshot WE asked for. */
  saidHasMedia: boolean;
  /** Every real outbound body, for the never-send-a-link-twice rule. */
  alreadySent: string[];
  /** Newest inbound message id: the idempotency anchor for this reply. */
  lastInboundId: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  repliedSinceWeWrote: boolean;
  windowOpen: boolean;
}

/** Pure: split a thread (oldest first) into what the brain needs. */
export function splitThread(messages: ThreadMessage[], now: Date): ThreadSplit {
  const real = messages.filter((m) => m.direction === "inbound" || m.status !== "draft");
  const alreadySent = real
    .filter((m) => m.direction === "outbound")
    .map((m) => m.body ?? "")
    .filter(Boolean);
  const lastOut = [...real].reverse().find((m) => m.direction === "outbound") ?? null;
  const lastIn = [...real].reverse().find((m) => m.direction === "inbound") ?? null;
  const saidMsgs = real.filter(
    (m) =>
      m.direction === "inbound" &&
      (!lastOut || m.created_at > lastOut.created_at),
  );
  return {
    said: saidMsgs.map((m) => (m.body ?? "").trim()).filter(Boolean),
    saidHasMedia: saidMsgs.some((m) => (m.media_count ?? 0) > 0),
    alreadySent,
    lastInboundId: lastIn?.id ?? null,
    lastInboundAt: lastIn?.created_at ?? null,
    lastOutboundAt: lastOut?.created_at ?? null,
    repliedSinceWeWrote: Boolean(
      lastIn && (!lastOut || lastIn.created_at > lastOut.created_at),
    ),
    windowOpen: Boolean(
      lastIn && now.getTime() - Date.parse(lastIn.created_at) < WINDOW_MS,
    ),
  };
}

// ------------------------------------------------------------------
// Adopting a lead who messages from a different number than their form.
//
// Angelica, 07 Aug 2026: form said +639381849356, she messaged from
// +639924711588. The thread phone matched no lead, so the brain had no watch
// code, and her drip kept pointing at the number in the form. The form message
// itself carries her email and typed phone, so the lead she already is can be
// found and healed: whatsapp_e164 becomes the number she actually writes from.
// ------------------------------------------------------------------

const FORM_EMAIL_RE = /email\s*:\s*([^\s,]+@[^\s,]+)/i;
const FORM_PHONE_RE = /phone\s*number\s*:\s*(\+?[0-9][0-9 ()-]{6,20})/i;

export function formDetails(said: string[]): { email: string | null; phone: string | null } {
  const text = said.join("\n");
  const email = (text.match(FORM_EMAIL_RE)?.[1] ?? "").trim().toLowerCase() || null;
  const raw = text.match(FORM_PHONE_RE)?.[1] ?? "";
  const digits = raw.replace(/[^\d+]/g, "");
  return {
    email,
    phone: digits.replace(/\D/g, "").length >= 8 ? digits : null,
  };
}

interface CreatorState {
  lead: Pick<
    SignupLead,
    "id" | "first_name" | "whatsapp_opted_out_at" | "profile_id"
  > | null;
  profile: Profile | null;
  stepsDone: OnboardingStepId[];
  openStep: OnboardingStepId | null;
}

async function loadCreatorState(
  admin: ReturnType<typeof createAdminClient>,
  phone: string,
  provider: string,
): Promise<CreatorState> {
  // Every read THROWS on error rather than degrading. A swallowed error here turned
  // an onboarded creator into a cold lead (null profile reads as "no account") and
  // dropped the opt-out guard; the outer loop catches the throw, logs the thread and
  // moves on, which answers nobody wrongly.
  const { data: leads, error: leadErr } = await admin
    .from("signup_leads")
    .select("id, first_name, whatsapp_opted_out_at, profile_id")
    .or(`whatsapp_e164.eq.${phone},whatsapp.eq.${phone}`)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .returns<
      Pick<SignupLead, "id" | "first_name" | "whatsapp_opted_out_at" | "profile_id">[]
    >();
  if (leadErr) throw new Error(`lead read failed: ${leadErr.message}`);
  const lead = leads?.[0] ?? null;

  let profile: Profile | null = null;
  if (lead?.profile_id) {
    const { data, error } = await admin
      .from("profiles")
      .select("*")
      .eq("id", lead.profile_id)
      .maybeSingle<Profile>();
    if (error) throw new Error(`profile read failed: ${error.message}`);
    profile = data ?? null;
  }
  if (!profile) {
    const { data, error } = await admin
      .from("profiles")
      .select("*")
      .eq("whatsapp", phone)
      .maybeSingle<Profile>();
    if (error) throw new Error(`profile read failed: ${error.message}`);
    profile = data ?? null;
  }

  if (!profile) return { lead, profile: null, stepsDone: [], openStep: null };

  const { data: progress, error: progressErr } = await admin
    .from("onboarding_progress")
    .select("profile_id, step, first_seen_at, completed_at")
    .eq("profile_id", profile.id)
    .returns<
      { profile_id: string; step: OnboardingStepId; first_seen_at: string | null; completed_at: string | null }[]
    >();
  if (progressErr) throw new Error(`progress read failed: ${progressErr.message}`);
  const states = await resolveStatesForCron(admin, profile, provider, progress ?? []);
  const resolution = resolveFunnel(states);
  const stepsDone = ONBOARDING_STEPS.filter((s) => states[s] === "done");
  return { lead, profile, stepsDone, openStep: resolution.openStep };
}

const SITE = "https://heypubli.com";

async function adoptLeadByFormDetails(
  admin: ReturnType<typeof createAdminClient>,
  phone: string,
  said: string[],
): Promise<CreatorState["lead"]> {
  const details = formDetails(said);
  if (!details.email && !details.phone) return null;
  const ors: string[] = [];
  if (details.email) ors.push(`email_normalized.eq.${details.email}`);
  if (details.phone) {
    const p = details.phone.startsWith("+") ? details.phone : `+${details.phone}`;
    ors.push(`whatsapp_e164.eq.${p}`, `whatsapp.eq.${p}`);
  }
  const { data: leads } = await admin
    .from("signup_leads")
    .select("id, first_name, whatsapp_opted_out_at, profile_id")
    .or(ors.join(","))
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .returns<
      Pick<SignupLead, "id" | "first_name" | "whatsapp_opted_out_at" | "profile_id">[]
    >();
  const lead = leads?.[0] ?? null;
  if (!lead) return null;
  // Heal the lead onto the number they actually message from: sends, the
  // inbound relay and the watch code all key off whatsapp_e164 from here on.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("signup_leads") as any)
    .update({ whatsapp_e164: phone, last_seen_at: new Date().toISOString() })
    .eq("id", lead.id);
  return lead;
}

/**
 * A skipped thread still leaves a row. Skips used to be silent (`continue`),
 * so the inbox could not tell "we deliberately stopped" from "nobody looked",
 * which is exactly how Hugo came to believe leads were being ignored.
 */
async function claimSkip(
  admin: ReturnType<typeof createAdminClient>,
  phone: string,
  inReplyTo: string,
  reason: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("funnel_replies") as any).insert({
    phone,
    in_reply_to: inReplyTo,
    kind: "silence",
    reason,
    status: "done",
  });
}

/** How long a form-fill thread with NO lead row yet may wait for the sheet
 *  import before we answer without a code. Deliberately under the monitor's
 *  3-minute neverLooked alarm: deferral writes no claim, so past this we
 *  answer with the bare link rather than trip IGNORED or, worse, stay quiet. */
export const LEAD_IMPORT_GRACE_MS = 120_000;

/**
 * Jessica, 07 Aug 2026, 20:01 UTC: her WhatsApp opener beat the sheet import
 * by seconds (lead row landed 20:01:16, reply left 20:01:0x), so she got the
 * bare /watch link and her video views tracked to nobody. Hugo: "why did you
 * reply without the code that helps you track". A form message carrying
 * contact details names a lead that IS coming; give the import one cron beat
 * and answer with the coded link instead. Pure so the tests pin all the ways
 * out: no details (answer now), fresh (wait), stale (answer codeless).
 */
export function shouldAwaitLeadImport(
  details: { email: string | null; phone: string | null },
  lastInboundAt: string | null,
  now: Date,
): boolean {
  if (!details.email && !details.phone) return false;
  if (!lastInboundAt) return false;
  return now.getTime() - Date.parse(lastInboundAt) < LEAD_IMPORT_GRACE_MS;
}

/**
 * One waiting thread, decided and acted on. Shared verbatim by the every-minute
 * cron and the webhook trigger; the claim-first unique index on in_reply_to is
 * what lets both fire on the same message without a double send.
 */
export async function processWaitingThread(
  admin: ReturnType<typeof createAdminClient>,
  provider: string,
  phone: string,
  now: Date,
  report: ReplyRunReport,
  opts: { dry?: boolean } = {},
): Promise<void> {
  report.threads++;
  const conv = await getThreadMessages(phone);
  if (!conv.ok || !conv.messages) return;
  const split = splitThread(conv.messages, now);
  if (!split.lastInboundId) return;
  if (conv.do_not_text) {
    if (!opts.dry) await claimSkip(admin, phone, split.lastInboundId, "on the do-not-text list");
    return;
  }

  let creator = await loadCreatorState(admin, phone, provider);
  if (!creator.lead && split.said.length > 0) {
    // No lead on this number, but the form message may name the lead they are.
    const adopted = await adoptLeadByFormDetails(admin, phone, split.said);
    if (adopted) creator = { ...creator, lead: adopted };
    else if (
      !creator.profile &&
      !pitchBlockedForPhone(phone) &&
      shouldAwaitLeadImport(formDetails(split.said), split.lastInboundAt, now)
    ) {
      // The named lead has not been imported yet. Return WITHOUT claiming so
      // the next pass (the cron, every minute) re-enters once the sheet-sync
      // lands the row and replies with the coded link. Blocked countries never
      // wait: their import is refused at the door, the row is not coming.
      return;
    }
  }
  if (creator.lead?.whatsapp_opted_out_at) {
    if (!opts.dry) await claimSkip(admin, phone, split.lastInboundId, "opted out earlier, automations stay away");
    return;
  }

  // A closed-country lead with NO account and NO lead row: blocked on purpose,
  // nothing is ever sent. Hugo, 07 Aug 2026, twice in one evening, the second
  // time right after fixing the ad location that was still buying these leads:
  // "just block and delete the indians." The claim is what keeps the thread
  // wearing "quiet on purpose" in the inbox instead of looking ignored. The
  // kept creators (a profile or a lead row exists) never reach this branch;
  // the pitchBlocked guard further down still answers their questions without
  // recruiting them.
  if (pitchBlockedForPhone(phone) && !creator.profile && !creator.lead) {
    if (opts.dry) {
      report.dry!.push({ phone, action: "silence", reason: "closed country, blocked on purpose" });
      return;
    }
    await claimSkip(admin, phone, split.lastInboundId, "closed country, blocked on purpose");
    return;
  }

  // Keep the lead's freshness stamp current. The slow nudge ladder pauses around
  // engaged_at; when it only ever held the FIRST reply, a template could land
  // minutes after a live back-and-forth.
  if (creator.lead && split.lastInboundAt) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("signup_leads") as any)
      .update({ engaged_at: split.lastInboundAt, last_seen_at: now.toISOString() })
      .eq("id", creator.lead.id)
      .or(`engaged_at.is.null,engaged_at.lt.${split.lastInboundAt}`);
  }

  const ctx: ReplyContext = {
    said: split.said,
    alreadySent: split.alreadySent,
    stepsDone: creator.stepsDone,
    hasAccount: Boolean(creator.profile),
    firstName: creator.profile?.first_name || creator.lead?.first_name || null,
    // SHORT on purpose. Hugo, 07 Aug 2026: "we dont need a url this big,
    // heypubli.com/watch?u=c062d would be enough to track." The token is
    // opaque to every consumer (watch_events.meta.u), so the first 6 hex
    // characters of the lead id identify the lead with room to spare, and
    // the long links already sent keep working unchanged.
    watchCode: creator.lead ? creator.lead.id.slice(0, 6) : null,
    // Hugo, 07 Aug 2026: "stop pitching them", about leads Skool cannot pay.
    // Without this line the guard in reply-brain is dead code and the machine
    // recruits people into work they cannot be paid for. Their questions are
    // still answered, they are simply never walked down the funnel.
    pitchBlocked: pitchBlockedForPhone(phone),
  };
  let decision = decideReply(ctx);
  const isRefusal = decision.action === "human" && decision.reason.startsWith("refusal");

  // A picture with no caption is not silence, it is usually the screenshot WE
  // asked for. Until the brain has eyes it goes to a human, loudly.
  if (decision.action === "silence" && split.saidHasMedia) {
    decision = { action: "human", reason: "sent a picture, needs human eyes" };
  }

  // Anti-ping-pong: a lead-side auto-responder answering every reply would
  // otherwise trade messages with us once a minute forever.
  if (decision.action === "send" && !opts.dry) {
    const { count: recentReplies } = await admin
      .from("funnel_replies")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .eq("kind", "reply")
      .gte("created_at", new Date(now.getTime() - 3600 * 1000).toISOString());
    if ((recentReplies ?? 0) >= 6) {
      decision = { action: "human", reason: "6 automated replies inside an hour, possible loop" };
    }
  }

  // Free-form only lands inside the 24h window. Outside it the send is refused
  // synchronously, so claiming a "reply" would burn this inbound's one action on
  // a message that can never leave. Hand it over instead.
  if (decision.action === "send" && !split.windowOpen) {
    decision = { action: "human", reason: "24h window closed, needs a template or your own reply" };
  }

  // The unplaceable-but-text cases get one shot at the fallback brain before a
  // human. Hugo, 07 Aug 2026: "brain understand the business and must handle all."
  let llmText: string | null = null;
  if (
    decision.action === "human" &&
    !isRefusal &&
    split.said.length > 0 &&
    !split.saidHasMedia &&
    split.windowOpen
  ) {
    const fallback = await llmReply({
      said: split.said,
      lastWeSaid: split.alreadySent.at(-1) ?? null,
      firstName: ctx.firstName ?? null,
      hasAccount: ctx.hasAccount,
      stepsDone: ctx.stepsDone as string[],
      openStep: creator.openStep,
      pitchBlocked: ctx.pitchBlocked,
      // Their coded link, so the fallback stops sending the anonymous one.
      watchLink: ctx.watchCode ? `heypubli.com/watch?u=${ctx.watchCode}` : null,
    });
    if (fallback.ok && fallback.text) llmText = fallback.text;
  }

  if (opts.dry) {
    report.dry!.push({
      phone,
      action: isRefusal ? "refusal" : llmText ? "send (llm)" : decision.action,
      key: decision.action === "send" ? decision.key : llmText ? "llm" : undefined,
      reason: decision.reason,
      text: decision.action === "send" ? decision.text : (llmText ?? undefined),
    });
    return;
  }

  // Claim BEFORE acting: one action per inbound message, ever.
  const sendText =
    decision.action === "send" ? decision.text : llmText;
  const sendImages =
    decision.action === "send" ? (decision.images ?? []) : [];
  const kind = sendText
    ? "reply"
    : isRefusal
      ? "refusal"
      : decision.action === "human"
        ? "handover"
        : "silence";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: claimErr } = await (admin.from("funnel_replies") as any).insert({
    phone,
    lead_id: creator.lead?.id ?? null,
    profile_id: creator.profile?.id ?? null,
    in_reply_to: split.lastInboundId,
    kind,
    key: decision.action === "send" ? decision.key : llmText ? "llm" : null,
    step: creator.openStep,
    body: sendText,
    images: sendImages,
    reason: decision.reason,
    status: sendText ? "pending" : "done",
  });
  if (claimErr) {
    if (claimErr.code !== "23505") report.errors.push(`${phone}: claim ${claimErr.code}`);
    else report.claimed++;
    return;
  }

  if (isRefusal) {
    if (creator.lead) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({
          nurture_state: "blocked",
          nurture_stop_reason: "said not interested",
          whatsapp_opted_out_at: now.toISOString(),
          last_seen_at: now.toISOString(),
        })
        .eq("id", creator.lead.id);
    }
    // The nudge ladder joins leads by EMAIL, not phone, so the lead write alone
    // can be invisible to it (FB form email vs signup email). stopped_at on the
    // nudge state is the flag its query actually excludes on.
    if (creator.profile) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("onboarding_nudge_state") as any).upsert({
        profile_id: creator.profile.id,
        stopped_at: now.toISOString(),
        stop_reason: "refused in chat",
        updated_at: now.toISOString(),
      });
    }
    report.refusals++;
    return;
  }
  if (kind === "handover") {
    report.handedOver++;
    return;
  }
  if (kind === "silence") {
    report.silences++;
    return;
  }

  const res = await sendPartnerWhatsApp({
    to: phone,
    firstName: ctx.firstName ?? "",
    body: sendText!,
    mediaUrls: sendImages.length ? sendImages.map((p) => `${SITE}${p}`) : undefined,
    externalId: `reply:${split.lastInboundId}`,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("funnel_replies") as any)
    .update({ status: res.ok ? "sent" : (res.blocked ?? "failed") })
    .eq("in_reply_to", split.lastInboundId)
    .eq("kind", "reply");
  if (res.ok) report.replied++;
  else report.errors.push(`${phone}: send ${res.blocked ?? res.error}`);
}

export interface ReplyRunReport {
  disabled?: string;
  threads: number;
  replied: number;
  handedOver: number;
  refusals: number;
  silences: number;
  checkIns: number;
  claimed: number;
  errors: string[];
  /** Dry mode: what WOULD have happened, nothing written, nothing sent. */
  dry?: Array<{ phone: string; action: string; key?: string; reason: string; text?: string }>;
}

export async function runReplyBrain(
  admin: ReturnType<typeof createAdminClient>,
  settings: FunnelSettings,
  opts: { dry?: boolean } = {},
): Promise<ReplyRunReport> {
  const report: ReplyRunReport = {
    threads: 0,
    replied: 0,
    handedOver: 0,
    refusals: 0,
    silences: 0,
    checkIns: 0,
    claimed: 0,
    errors: [],
    ...(opts.dry ? { dry: [] } : {}),
  };
  if (!settings.auto_reply_enabled && !opts.dry) return { ...report, disabled: "switch off" };
  if (!settings.whatsapp_enabled) return { ...report, disabled: "whatsapp off" };

  const now = new Date();
  const providerSettings = await getPostingSettingsAdmin();
  if (!providerSettings) {
    // Guessing the provider mis-reads every creator's Instagram step (production
    // truth is outstand; the fallback checked the empty instagram_connections
    // table). Better no replies this minute than confidently wrong ones.
    report.errors.push("posting settings unreadable, run skipped");
    return report;
  }
  const provider = providerSettings.active_provider ?? "heypubli";

  // ---- 1. Replies: threads waiting on us. ----
  const inbox = await getInboxSummary();
  if (!inbox.ok) {
    report.errors.push("inbox_summary unreachable");
    return report;
  }

  // A thread already actioned (its newest inbound has a claim) must not occupy one of
  // the reply slots: handovers and silences send nothing, so they stay "waiting" in
  // the CRM for up to 72h, and once 15 of them piled up no fresh lead was ever
  // reached again.
  const allWaiting = inbox.waiting ?? [];
  let actionedAfter = new Map<string, string>();
  if (allWaiting.length) {
    const { data: prior } = await admin
      .from("funnel_replies")
      .select("phone, created_at")
      .in("phone", allWaiting.map((w) => w.phone))
      .gte("created_at", new Date(now.getTime() - 72 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1000)
      .returns<{ phone: string; created_at: string }[]>();
    actionedAfter = new Map();
    for (const r of prior ?? []) {
      if (!actionedAfter.has(r.phone)) actionedAfter.set(r.phone, r.created_at);
    }
  }
  const waiting = allWaiting
    .filter((w) => {
      const acted = actionedAfter.get(w.phone);
      return !(acted && w.last_inbound_at && acted >= w.last_inbound_at);
    })
    // A message younger than the settle window belongs to the webhook trigger,
    // which is mid-pause on it right now. The cron answering at second 17 is
    // exactly the instant-robot feel the 20 to 45 second pause exists to avoid
    // (measured live, 07 Aug 2026). Anything older than the window is fair
    // game: if the trigger died, the next minute's cron still answers.
    .filter(
      (w) =>
        !w.last_inbound_at ||
        now.getTime() - Date.parse(w.last_inbound_at) > SETTLE_MIN_MS + SETTLE_SPREAD_MS + 5000,
    )
    .slice(0, MAX_REPLIES_PER_RUN);

  for (const thread of waiting) {
    try {
      await processWaitingThread(admin, provider, thread.phone, now, report, opts);
    } catch (e) {
      report.errors.push(`${thread.phone}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // ---- 2. Check-ins: creators mid-onboarding who went quiet after OUR message. ----
  // NEWEST first: this is a same-day ladder (15 and 90 minutes), so the freshest
  // signups are exactly the ones it exists for. Oldest-first pinned the scan to the
  // same 40 stale profiles forever and creator 41 never got a check-in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles } = (await (admin.from("profiles") as any)
    .select("*")
    .eq("onboarding_complete", false)
    .eq("is_admin", false)
    .is("suspended_at", null)
    .not("whatsapp", "is", null)
    .order("created_at", { ascending: false })
    .limit(40)) as { data: Profile[] | null };

  for (const profile of profiles ?? []) {
    if (report.checkIns >= MAX_CHECKINS_PER_RUN) break;
    const phone = profile.whatsapp;
    if (!phone) continue;
    try {
      // Their own daytime only: a 3am "is everything ok?" is a block generator.
      if (!withinSendingHours(now, timezoneForPhone(phone))) continue;

      const conv = await getThreadMessages(phone);
      if (!conv.ok || !conv.messages || conv.do_not_text) continue;
      const split = splitThread(conv.messages, now);
      if (!split.lastOutboundAt) continue;

      const creator = await loadCreatorState(admin, phone, provider);
      if (creator.lead?.whatsapp_opted_out_at) continue;
      if (!creator.openStep) continue;

      const { count: spent } = await admin
        .from("funnel_replies")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .eq("kind", "check_in")
        .eq("step", creator.openStep);

      const decision = decideCheckIn({
        minutesSinceWeWrote: (now.getTime() - Date.parse(split.lastOutboundAt)) / 60000,
        repliedSinceWeWrote: split.repliedSinceWeWrote,
        checkInsThisStep: spent ?? 0,
        openStep: creator.openStep,
        windowOpen: split.windowOpen,
        firstName: profile.first_name || creator.lead?.first_name || null,
      });
      if (decision.action !== "send") continue;

      if (opts.dry) {
        report.dry!.push({
          phone,
          action: "check_in",
          key: decision.key,
          reason: decision.reason,
          text: decision.text,
        });
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: claimErr } = await (admin.from("funnel_replies") as any).insert({
        phone,
        lead_id: creator.lead?.id ?? null,
        profile_id: profile.id,
        kind: "check_in",
        key: decision.key,
        step: creator.openStep,
        body: decision.text,
        reason: decision.reason,
        status: "pending",
      });
      if (claimErr) {
        if (claimErr.code !== "23505") report.errors.push(`${phone}: checkin claim ${claimErr.code}`);
        continue;
      }
      const res = await sendPartnerWhatsApp({
        to: phone,
        firstName: profile.first_name || "",
        body: decision.text,
        externalId: `checkin:${profile.id}:${creator.openStep}:${decision.key}`,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("funnel_replies") as any)
        .update({ status: res.ok ? "sent" : (res.blocked ?? "failed") })
        .eq("profile_id", profile.id)
        .eq("kind", "check_in")
        .eq("step", creator.openStep)
        .eq("key", decision.key);
      if (res.ok) report.checkIns++;
      else report.errors.push(`${phone}: checkin send ${res.blocked ?? res.error}`);
    } catch (e) {
      report.errors.push(`${phone}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return report;
}

// ------------------------------------------------------------------
// The webhook trigger. Hugo, 07 Aug 2026: "every time a new message comes the
// AI has to be triggered and reply within like 30 seconds. Not one second, but
// 30 seconds, to sound natural." The cron stays as the safety net; the unique
// claim on in_reply_to means both can fire on one message with no double send.
// ------------------------------------------------------------------

export const SETTLE_MIN_MS = 20_000;
export const SETTLE_SPREAD_MS = 25_000;

/** 20 to 45 seconds, varied every time. Never fixed, never instant. */
export function settleDelayMs(rand: number = Math.random()): number {
  const r = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 1) : 0.5;
  return SETTLE_MIN_MS + Math.round(r * SETTLE_SPREAD_MS);
}

/**
 * The debounce. Leads write "hi", "i saw your ad", "how does it work" as three
 * messages. Each inbound starts its own settled invocation; when the pause ends,
 * only the invocation triggered by the NEWEST message acts, and splitThread has
 * already gathered everything since our last outbound, so the lead gets ONE
 * answer to all of it. The 2 second allowance absorbs webhook clock skew.
 */
export function stillOwnsThread(newestInboundAt: string | null, triggerAtMs: number): boolean {
  if (!newestInboundAt) return false;
  return Date.parse(newestInboundAt) <= triggerAtMs + 2000;
}

export interface TriggeredReplyResult {
  acted: boolean;
  why: string;
}

/** One thread, kicked by the inbound webhook after the settle pause. */
export async function runTriggeredReply(
  phone: string,
  triggerAtMs: number,
): Promise<TriggeredReplyResult> {
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("funnel_settings")
    .select("*")
    .eq("id", "default")
    .single<FunnelSettings>();
  if (!settings?.auto_reply_enabled || !settings.whatsapp_enabled) {
    return { acted: false, why: "switch off" };
  }
  const providerSettings = await getPostingSettingsAdmin();
  if (!providerSettings) return { acted: false, why: "posting settings unreadable" };
  const provider = providerSettings.active_provider ?? "heypubli";

  const now = new Date();
  const conv = await getThreadMessages(phone);
  if (!conv.ok || !conv.messages) return { acted: false, why: "thread unreadable" };
  const split = splitThread(conv.messages, now);
  if (!split.repliedSinceWeWrote) return { acted: false, why: "already answered" };
  if (!stillOwnsThread(split.lastInboundAt, triggerAtMs)) {
    // A newer message landed during the pause. Its own invocation is mid-pause
    // and will answer everything in one message; this one stands down.
    return { acted: false, why: "newer message owns the settle" };
  }

  const report: ReplyRunReport = {
    threads: 0,
    replied: 0,
    handedOver: 0,
    refusals: 0,
    silences: 0,
    checkIns: 0,
    claimed: 0,
    errors: [],
  };
  try {
    await processWaitingThread(admin, provider, phone, now, report);
  } catch (e) {
    return { acted: false, why: e instanceof Error ? e.message : "unknown" };
  }
  return { acted: true, why: report.errors[0] ?? "processed" };
}
