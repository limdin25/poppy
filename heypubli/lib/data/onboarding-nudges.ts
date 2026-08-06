import { createAdminClient } from "@/lib/supabase/admin";
import { sendPartnerWhatsApp, getSharedSenderLoad } from "@/lib/integrations/whatsapp";
import { timezoneForPhone, withinSendingHours } from "@/lib/data/lanes";
import { resolveFunnel } from "@/lib/data/onboarding";
import { isCommunityMember } from "@/lib/data/community";
import { getPostingSettingsAdmin, getOutstandInstagramData } from "@/lib/data/outstand";
import { hasLinkInBio } from "@/lib/bio-check";
import { skoolLinkNeedle } from "@/lib/skool-link";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import type { StepState } from "@/lib/data/brochure";
import type { FunnelSettings, OnboardingStepId, Profile } from "@/types/database";

/**
 * The onboarding nudge brain. Hugo, 2026-08-06: "we have to have a brain that
 * can always keep track of them on onboarding and keep bugging them until they
 * finish everything and ask them if they need help."
 *
 * Runs as phase 3 of /api/funnel/tick, every 5 minutes. For every creator with
 * an account and an unfinished funnel it works out the step they are stuck on
 * and sends ONE WhatsApp message about exactly that step:
 *
 *   - Free-form first. If the creator wrote to us in the last 24 hours the
 *     window is open, the message costs nothing and can say anything, and we
 *     rotate through variations so it never repeats. wk-partner-api refuses
 *     synchronously with blocked:'window_closed' when the window is shut, so
 *     trying is free and safe.
 *   - Meta-approved template second. Outside the window only an approved
 *     template can be sent. Unapproved templates defer silently (the tick
 *     retries another day); they never burn a nudge.
 *
 * Every send passes: the kill switches, quiet hours in the lead's own
 * timezone, the reply pause (a live conversation beats a robot), the shared
 * 250/24h sender cap, the do-not-text list at the wk-partner-api door, and a
 * hard per-creator lifetime cap.
 */

// ------------------------------------------------------------------
// Tunables. Hours, not cron ticks, so the cadence survives cron changes.
// ------------------------------------------------------------------

/** How long a creator must sit still before the first nudge. */
export const FIRST_NUDGE_AFTER_HOURS = 20;
/** Minimum gap between nudges. 44h, not 48, so sends drift across the day. */
export const NUDGE_GAP_HOURS = 44;
/** Lifetime cap per creator. After this we stop for good and mark why. */
export const MAX_NUDGES = 6;
/** An inbound reply pauses nudging this long: a conversation is running. */
export const REPLY_PAUSE_HOURS = 24;
/** Sends per tick, so one run can never flood the shared sender. */
const SENDS_PER_RUN = 25;
const CANDIDATE_BATCH = 40;

// ------------------------------------------------------------------
// Messages. Template SIDs resolve env-first so a re-submitted template is a
// config change; the fallbacks are the real SIDs created 2026-08-06.
// onb_step_instagram reuses instagram_not_connected, approved by Meta already.
// ------------------------------------------------------------------

function sidFor(envKey: string, fallback: string): string {
  return process.env[envKey] || fallback;
}

export const ONB_TEMPLATES: Record<"general", string[]> &
  Record<OnboardingStepId, string[]> & { keys: Record<string, string> } = {
  keys: {
    onb_nudge_general_a: sidFor("WA_TEMPLATE_ONB_GENERAL_A_SID", "HX0edc566bc1c186f573b13384912c63e9"),
    onb_nudge_general_b: sidFor("WA_TEMPLATE_ONB_GENERAL_B_SID", "HX6db63aaff86b2792213241ffc9f4f0c4"),
    onb_step_instagram: sidFor("WA_TEMPLATE_ONB_INSTAGRAM_SID", "HXfc4e32efdeb79649dc37fbe3d52cd593"),
    onb_step_community: sidFor("WA_TEMPLATE_ONB_COMMUNITY_SID", "HX132df69c2a647cf3fb3e50f70b3f8639"),
    onb_step_affiliate: sidFor("WA_TEMPLATE_ONB_AFFILIATE_SID", "HXf2669717f7d737902b74eeb6d4e1087c"),
    onb_step_photo: sidFor("WA_TEMPLATE_ONB_PHOTO_SID", "HX5ac27b27d1191061192891fd1315ae06"),
    onb_step_bio: sidFor("WA_TEMPLATE_ONB_BIO_SID", "HXa7baea84462a213124defa94229585e5"),
  },
  general: ["onb_nudge_general_a", "onb_nudge_general_b"],
  instagram: ["onb_step_instagram"],
  community: ["onb_step_community"],
  affiliate: ["onb_step_affiliate"],
  photo: ["onb_step_photo"],
  bio: ["onb_step_bio"],
};

type Freeform = (first: string) => string;

const FREEFORM_GENERAL: Record<string, Freeform> = {
  free_general_a: (f) =>
    `Quick nudge from me, ${f}. Your HeyPubli setup is still open at heypubli.com/onboarding and it carries on exactly where you stopped. Anything I can help with?`,
  free_general_b: (f) =>
    `Me again, ${f}. A few minutes on heypubli.com/onboarding and your setup is done, then the posting can start. Where did you get stuck?`,
};

const FREEFORM_BY_STEP: Record<OnboardingStepId, Record<string, Freeform>> = {
  instagram: {
    free_ig_a: (f) =>
      `${f}, your Instagram is not connected yet, so nothing can be posted for you. It is one tap at heypubli.com/onboarding and you never share your password. Shall I walk you through it?`,
    free_ig_b: (f) =>
      `Still missing your Instagram connection, ${f}. Tap Connect Instagram at heypubli.com/onboarding and say Allow when Instagram asks. Tell me if it gives you any trouble.`,
  },
  community: {
    free_comm_a: (f) =>
      `${f}, your community invite is in your email. The sender is Lim Din, that is us. Tap JOIN NOW inside, then press I have joined at heypubli.com/onboarding. Can you find it?`,
    free_comm_b: (f) =>
      `Did the invite email reach you, ${f}? Search your inbox for skool. Join with the same email you gave us, then tick the step at heypubli.com/onboarding.`,
  },
  affiliate: {
    free_aff_a: (f) =>
      `${f}, next step is your personal link. In Skool: the three dots at the top right, Invite people, COPY. Paste it at heypubli.com/onboarding. That link is how you get paid.`,
    free_aff_b: (f) =>
      `Your link is still missing, ${f}. The page at heypubli.com/onboarding shows exactly where it lives in Skool. Two minutes, and it is the step that makes you money.`,
  },
  photo: {
    free_photo_a: (f) =>
      `${f}, your profile still needs a photo. Add one in Instagram under Edit profile, then tick the step at heypubli.com/onboarding. Profiles with a photo get followed, blank ones do not.`,
    free_photo_b: (f) =>
      `Almost there, ${f}. Just the photo and the bio left. Add your photo in the Instagram app, tick it off at heypubli.com/onboarding, and the last step opens.`,
  },
  bio: {
    free_bio_a: (f) =>
      `${f}, last step. Your sentence and your link are ready to copy at heypubli.com/onboarding, they go in your Instagram bio. The moment they are in, posting starts.`,
    free_bio_b: (f) =>
      `One paste away, ${f}. Copy the sentence and the link from heypubli.com/onboarding into your Instagram bio and you are done. Want help with it?`,
  },
};

export interface NudgePick {
  /** What goes out if the 24h window is open. */
  freeformKey: string;
  freeform: Freeform;
  /** What goes out otherwise. */
  templateKey: string;
  templateSid: string;
}

/**
 * Which wording this particular nudge uses. Step-specific and general
 * alternate (step first, because "do this one thing" beats "you are not
 * done"), and within each pool the variants rotate, so two consecutive nudges
 * never read the same.
 */
export function pickNudge(step: OnboardingStepId, nudgeCount: number): NudgePick {
  const useStep = nudgeCount % 2 === 0;
  const round = Math.floor(nudgeCount / 2);

  const templatePool = useStep ? ONB_TEMPLATES[step] : ONB_TEMPLATES.general;
  const templateKey = templatePool[round % templatePool.length];

  const freeformPool = useStep ? FREEFORM_BY_STEP[step] : FREEFORM_GENERAL;
  const freeformKeys = Object.keys(freeformPool);
  const freeformKey = freeformKeys[round % freeformKeys.length];

  return {
    freeformKey,
    freeform: freeformPool[freeformKey],
    templateKey,
    templateSid: ONB_TEMPLATES.keys[templateKey],
  };
}

export interface ShouldNudgeInput {
  now: Date;
  /** The freshest sign of life: a step opening or completing, or the account's birth. */
  lastActivityAt: string | null;
  lastNudgedAt: string | null;
  nudgeCount: number;
  /** Their last inbound WhatsApp reply, from signup_leads.engaged_at. */
  engagedAt: string | null;
  stoppedAt: string | null;
}

export type NudgeVerdict =
  | { ok: true }
  | { ok: false; reason: "stopped" | "exhausted" | "too_soon" | "still_active" | "in_conversation" };

const hoursSince = (iso: string | null, now: Date): number =>
  iso === null ? Number.POSITIVE_INFINITY : (now.getTime() - new Date(iso).getTime()) / 3600_000;

/** The decision, pure and tested: is this creator due a nudge right now? */
export function shouldNudge(input: ShouldNudgeInput): NudgeVerdict {
  if (input.stoppedAt) return { ok: false, reason: "stopped" };
  if (input.nudgeCount >= MAX_NUDGES) return { ok: false, reason: "exhausted" };
  if (hoursSince(input.lastNudgedAt, input.now) < NUDGE_GAP_HOURS) {
    return { ok: false, reason: "too_soon" };
  }
  if (hoursSince(input.lastActivityAt, input.now) < FIRST_NUDGE_AFTER_HOURS) {
    return { ok: false, reason: "still_active" };
  }
  if (hoursSince(input.engagedAt, input.now) < REPLY_PAUSE_HOURS) {
    return { ok: false, reason: "in_conversation" };
  }
  return { ok: true };
}

// ------------------------------------------------------------------
// IO
// ------------------------------------------------------------------

interface NudgeStateRow {
  profile_id: string;
  nudge_count: number;
  last_nudged_at: string | null;
  stopped_at: string | null;
}

interface ProgressRow {
  profile_id: string;
  step: OnboardingStepId;
  first_seen_at: string | null;
  completed_at: string | null;
}

interface LeadSlice {
  email_normalized: string;
  engaged_at: string | null;
  whatsapp_opted_out_at: string | null;
}

export interface OnboardingNudgeReport {
  disabled?: string;
  candidates: number;
  sent: number;
  freeform: number;
  template: number;
  skipped: Record<string, number>;
  stopped: number;
}

/**
 * The step this creator is stuck on, computed from cheap admin reads only. No
 * user-session client (this runs in a cron, there are no cookies) and no
 * Outstand API call except the one bio double-check right before a bio nudge.
 */
async function resolveStatesForCron(
  admin: ReturnType<typeof createAdminClient>,
  profile: Profile,
  provider: string,
  progress: ProgressRow[],
): Promise<Record<OnboardingStepId, StepState>> {
  let igConnected = false;
  if (provider === "outstand") {
    const { data } = await admin
      .from("outstand_connections")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("is_connected", true)
      .maybeSingle();
    igConnected = Boolean(data);
  } else {
    const { data } = await admin
      .from("instagram_connections")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("is_connected", true)
      .maybeSingle();
    igConnected = Boolean(data);
  }

  const communityDone =
    Boolean(profile.community_joined_declared_at) ||
    (await isCommunityMember(profile.email));

  const bioStamped = progress.some((r) => r.step === "bio" && r.completed_at);

  return {
    instagram: igConnected ? "done" : INSTAGRAM_ENABLED ? "todo" : "blocked",
    community: communityDone ? "done" : "todo",
    affiliate: profile.skool_affiliate_url ? "done" : "todo",
    photo: profile.photo_declared_at ? "done" : "todo",
    bio: profile.bio_link_declared_at || bioStamped ? "done" : "todo",
  };
}

export async function runOnboardingNudges(
  admin: ReturnType<typeof createAdminClient>,
  settings: FunnelSettings,
): Promise<OnboardingNudgeReport> {
  const report: OnboardingNudgeReport = {
    candidates: 0,
    sent: 0,
    freeform: 0,
    template: 0,
    skipped: {},
    stopped: 0,
  };
  const skip = (reason: string) => {
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
  };
  if (!settings.onboarding_nudges_enabled) return { ...report, disabled: "switch off" };
  if (!settings.whatsapp_enabled) return { ...report, disabled: "whatsapp off" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles } = (await (admin.from("profiles") as any)
    .select("*")
    .eq("onboarding_complete", false)
    .eq("is_admin", false)
    .is("suspended_at", null)
    .not("whatsapp", "is", null)
    .order("created_at", { ascending: true })
    .limit(CANDIDATE_BATCH)) as { data: Profile[] | null };
  if (!profiles?.length) return report;

  const ids = profiles.map((p) => p.id);
  const emails = profiles.map((p) => p.email.trim().toLowerCase());

  const [{ data: states }, { data: progressRows }, { data: leads }, providerSettings, loadRes] =
    await Promise.all([
      admin
        .from("onboarding_nudge_state")
        .select("profile_id, nudge_count, last_nudged_at, stopped_at")
        .in("profile_id", ids)
        .returns<NudgeStateRow[]>(),
      admin
        .from("onboarding_progress")
        .select("profile_id, step, first_seen_at, completed_at")
        .in("profile_id", ids)
        .returns<ProgressRow[]>(),
      admin
        .from("signup_leads")
        .select("email_normalized, engaged_at, whatsapp_opted_out_at")
        .in("email_normalized", emails)
        .returns<LeadSlice[]>(),
      getPostingSettingsAdmin(),
      getSharedSenderLoad(),
    ]);

  const stateBy = new Map((states ?? []).map((s) => [s.profile_id, s]));
  const leadBy = new Map((leads ?? []).map((l) => [l.email_normalized, l]));
  const progressBy = new Map<string, ProgressRow[]>();
  for (const r of progressRows ?? []) {
    const list = progressBy.get(r.profile_id) ?? [];
    list.push(r);
    progressBy.set(r.profile_id, list);
  }
  const provider = providerSettings?.active_provider ?? "heypubli";
  let sharedLoad =
    loadRes.ok && typeof loadRes.sent24h === "number" ? loadRes.sent24h : null;

  const now = new Date();
  const nowIso = now.toISOString();

  const stopFor = async (profileId: string, reason: string) => {
    report.stopped++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("onboarding_nudge_state") as any).upsert({
      profile_id: profileId,
      stopped_at: nowIso,
      stop_reason: reason,
      updated_at: nowIso,
    });
  };

  for (const profile of profiles) {
    if (report.sent >= SENDS_PER_RUN) break;
    report.candidates++;

    const nudgeState = stateBy.get(profile.id) ?? {
      profile_id: profile.id,
      nudge_count: 0,
      last_nudged_at: null,
      stopped_at: null,
    };
    const lead = leadBy.get(profile.email.trim().toLowerCase()) ?? null;

    if (lead?.whatsapp_opted_out_at) {
      if (!nudgeState.stopped_at) await stopFor(profile.id, "opted_out");
      continue;
    }

    const progress = progressBy.get(profile.id) ?? [];
    const lastActivityAt = [profile.created_at, ...progress.flatMap((r) => [r.first_seen_at, r.completed_at])]
      .filter((x): x is string => Boolean(x))
      .sort()
      .at(-1) as string;

    const verdict = shouldNudge({
      now,
      lastActivityAt,
      lastNudgedAt: nudgeState.last_nudged_at,
      nudgeCount: nudgeState.nudge_count,
      engagedAt: lead?.engaged_at ?? null,
      stoppedAt: nudgeState.stopped_at,
    });
    if (!verdict.ok) {
      if (verdict.reason === "exhausted" && !nudgeState.stopped_at) {
        await stopFor(profile.id, "exhausted");
      } else {
        skip(verdict.reason);
      }
      continue;
    }

    // Quiet hours where the lead actually is, guessed from the dialling code.
    if (!withinSendingHours(now, timezoneForPhone(profile.whatsapp))) {
      skip("quiet_hours");
      continue;
    }

    const stepStates = await resolveStatesForCron(admin, profile, provider, progress);
    const { openStep, allDone } = resolveFunnel(stepStates);

    if (allDone) {
      // They finished without ever coming back to the page. Stamp it and stop.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("profiles") as any)
        .update({ onboarding_complete: true })
        .eq("id", profile.id);
      skip("already_done");
      continue;
    }
    if (!openStep) {
      // Everything left is blocked on our side. Not theirs to fix, no nudge.
      skip("blocked_on_us");
      continue;
    }

    // The one expensive check, only when it can cancel a wrong nudge: they may
    // have pasted the bio link without ever revisiting the page.
    if (openStep === "bio" && provider === "outstand" && profile.skool_affiliate_url) {
      const ig = await getOutstandInstagramData(profile.id);
      if (ig?.statsAvailable) {
        const needle = skoolLinkNeedle(profile.skool_affiliate_url);
        const found = hasLinkInBio({
          tag: needle?.value ?? null,
          biography: ig.biography,
          website: ig.website,
        });
        if (found) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin.from("onboarding_progress") as any).upsert({
            profile_id: profile.id,
            step: "bio",
            first_seen_at: nowIso,
            completed_at: nowIso,
            updated_at: nowIso,
          });
          skip("bio_found_live");
          continue;
        }
      }
    }

    const pick = pickNudge(openStep, nudgeState.nudge_count);
    const firstName = (profile.first_name || "there").trim().split(" ")[0];
    const externalId = `onb:${profile.id}:${nudgeState.nudge_count}`;

    // Free-form first: costs nothing inside the window, refused synchronously
    // outside it, and the refusal writes no message row, so falling back to a
    // template under the SAME external id cannot double-send.
    let kind: "freeform" | "template" | null = null;
    let variant = "";
    const freeRes = await sendPartnerWhatsApp({
      to: profile.whatsapp as string,
      firstName,
      body: pick.freeform(firstName),
      externalId,
    });

    if (freeRes.ok) {
      kind = "freeform";
      variant = pick.freeformKey;
    } else if (freeRes.blocked === "window_closed") {
      if (sharedLoad !== null && sharedLoad >= settings.daily_template_cap) {
        skip("capped");
        continue;
      }
      const tplRes = await sendPartnerWhatsApp({
        to: profile.whatsapp as string,
        firstName,
        contentSid: pick.templateSid,
        externalId,
      });
      if (tplRes.ok) {
        kind = "template";
        variant = pick.templateKey;
        if (sharedLoad !== null) sharedLoad++;
      } else if (tplRes.blocked === "template_unapproved") {
        // Meta has not approved it yet. Defer without burning the nudge.
        skip("template_pending");
        continue;
      } else if (tplRes.blocked === "do_not_text") {
        await stopFor(profile.id, "do_not_text");
        continue;
      } else if (tplRes.blocked === "daily_cap" || tplRes.blocked === "kill_switch") {
        skip(tplRes.blocked);
        break; // workspace-wide: nobody else in this run will fare better
      } else {
        console.error("[onb-nudge] template send failed", profile.id, tplRes);
        skip("send_failed");
        continue;
      }
    } else if (freeRes.blocked === "do_not_text") {
      await stopFor(profile.id, "do_not_text");
      continue;
    } else if (freeRes.blocked === "daily_cap" || freeRes.blocked === "kill_switch") {
      skip(freeRes.blocked);
      break;
    } else {
      console.error("[onb-nudge] freeform send failed", profile.id, freeRes);
      skip("send_failed");
      continue;
    }

    // Bookkeeping. The unique external_id makes a crashed-and-rerun tick log
    // the send once, and wk-partner-api's own idempotency makes it SEND once.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: logErr } = await (admin.from("onboarding_nudges") as any).insert({
      profile_id: profile.id,
      step: openStep,
      kind,
      variant,
      external_id: externalId,
    });
    if (logErr && logErr.code !== "23505") {
      console.error("[onb-nudge] log insert failed", logErr);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("onboarding_nudge_state") as any).upsert({
      profile_id: profile.id,
      nudge_count: nudgeState.nudge_count + 1,
      last_nudged_at: nowIso,
      last_step: openStep,
      updated_at: nowIso,
    });

    report.sent++;
    report[kind]++;
  }

  return report;
}

export { FREEFORM_GENERAL, FREEFORM_BY_STEP };
