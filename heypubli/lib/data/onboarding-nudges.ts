import { createAdminClient } from "@/lib/supabase/admin";
import { sendPartnerWhatsApp, getSharedSenderLoad } from "@/lib/integrations/whatsapp";
import { timezoneForPhone, withinSendingHours } from "@/lib/data/lanes";
import { resolveFunnel } from "@/lib/data/onboarding";
import { isCommunityMember } from "@/lib/data/community";
import { getPostingSettingsAdmin, getOutstandInstagramData } from "@/lib/data/outstand";
import { checkBio, bioVerified } from "@/lib/bio-check";
import { skoolUrlInProfile, wrongCodeInProfile } from "@/lib/data/creator-roster";
import { renderReply } from "@/lib/data/reply-brain";
import { bioSentence } from "@/lib/bio-variants";
import { cleanSkoolAffiliateUrl, skoolLinkNeedle } from "@/lib/skool-link";
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
// Hugo, 2026-08-06: "if they didn't do the action for one hour, two hours,
// ten minutes, whatever, we have to follow back on them." So the FIRST nudge
// comes fast, while the lead is still warm and the 24h window is still open
// (free-form, free). Later nudges space out, because by then it is templates
// on a shared sender and pestering buys blocks, not conversions.
// ------------------------------------------------------------------

/** How long a creator must sit still before the FIRST nudge. Fast on purpose. */
export const FIRST_NUDGE_AFTER_HOURS = 2;
/** Gap before the SECOND nudge (22h: next day, drifting across the day), then 44h. */
export function nudgeGapHours(nudgeCount: number): number {
  return nudgeCount <= 1 ? 22 : 44;
}
/** Lifetime cap per creator. After this we stop for good and mark why. */
export const MAX_NUDGES = 6;
/** An inbound reply pauses nudging this long: a live conversation beats a robot.
 *  Short, so a lead who chatted and then stalled still gets the fast follow-up. */
export const REPLY_PAUSE_HOURS = 3;
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
  // The onb2_* set: same wording signed Lim, not Maria (Hugo, 2026-08-06:
  // "the name is Lim", matching the sender photo and the Skool account). The
  // Maria-signed onb_* set is abandoned; these defer safely until Meta
  // approves them.
  keys: {
    onb_nudge_general_a: sidFor("WA_TEMPLATE_ONB_GENERAL_A_SID", "HX0eaab2da699f69c0bef331c34a0810e2"),
    onb_nudge_general_b: sidFor("WA_TEMPLATE_ONB_GENERAL_B_SID", "HXe844a68294df2eff26cefa6d8109532a"),
    onb_step_instagram: sidFor("WA_TEMPLATE_ONB_INSTAGRAM_SID", "HX918ca089b4cd0d9d40812cf12fe21b84"),
    onb_step_community: sidFor("WA_TEMPLATE_ONB_COMMUNITY_SID", "HXfe9ef90986e322a0edede1688030b1a5"),
    onb_step_affiliate: sidFor("WA_TEMPLATE_ONB_AFFILIATE_SID", "HXbfa6b82dac4f96dad6273984f0dc1a2d"),
    onb_step_photo: sidFor("WA_TEMPLATE_ONB_PHOTO_SID", "HXa52032caee2ff0e6a712cbc7ba2946a9"),
    onb_step_bio: sidFor("WA_TEMPLATE_ONB_BIO_SID", "HX0b30cae97dc9e3ba199be8afd7c6a942"),
    // Hugo, 08 Aug 2026, second draft after correcting the first: the reason
    // the link goes in the bio is TRACKING (sales credited to them), never a
    // "before you can get paid" threat. Say the two actions plainly, end
    // with "let me know if you get stuck"; the stuck reply then brings the
    // screenshots. Submitted to Meta the same day; defers until approved.
    onb4_bio_track_link: sidFor(
      "WA_TEMPLATE_ONB_BIO_TRACK_SID",
      "HX20e85847724ef17097b49cf1a2b3ec44",
    ),
  },
  general: ["onb_nudge_general_a", "onb_nudge_general_b"],
  instagram: ["onb_step_instagram"],
  community: ["onb_step_community"],
  affiliate: ["onb_step_affiliate"],
  photo: ["onb_step_photo"],
  bio: ["onb4_bio_track_link", "onb_step_bio"],
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
  if (hoursSince(input.lastNudgedAt, input.now) < nudgeGapHours(input.nudgeCount)) {
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
export async function resolveStatesForCron(
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
    // The progress stamp only: it is written by a live read of their real
    // Instagram (page render, tick verify, reply-runner check). A declaration
    // is a claim, and 08 Aug 2026 a claim with an empty profile reached 5/5
    // and got told "your link is live". Never again off somebody's word.
    bio: bioStamped ? "done" : "todo",
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

  // Creators already stopped for good are excluded IN THE QUERY, not in the
  // loop. Checking in the loop meant they still consumed one of the 40 slots
  // every run, so with a full stop-list creator 41 was never reached and the
  // same 40 rows were re-examined every 5 minutes forever.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stoppedRows } = (await (admin.from("onboarding_nudge_state") as any)
    .select("profile_id")
    .not("stopped_at", "is", null)) as { data: { profile_id: string }[] | null };
  const stoppedIds = (stoppedRows ?? []).map((r) => r.profile_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin.from("profiles") as any)
    .select("*")
    .eq("onboarding_complete", false)
    .eq("is_admin", false)
    .is("suspended_at", null)
    .not("whatsapp", "is", null);
  if (stoppedIds.length) query = query.not("id", "in", `(${stoppedIds.join(",")})`);
  const { data: profiles } = (await query
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

  // THE OTHER LADDER'S FOOTPRINTS. The same-day check-ins (reply-runner, 15 and
  // 90 minutes) and this slow ladder both message quiet creators; each one
  // dedupes itself, but nothing stopped a check-in at minute 90 being followed
  // by a slow nudge at hour 2. A recent check-in now counts as OUR last nudge,
  // so the gap rule spaces the two ladders as one voice.
  const { data: checkinRows } = await admin
    .from("funnel_replies")
    .select("profile_id, created_at")
    .eq("kind", "check_in")
    .in("profile_id", ids)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<{ profile_id: string | null; created_at: string }[]>();
  const lastCheckinBy = new Map<string, string>();
  for (const r of checkinRows ?? []) {
    if (r.profile_id && !lastCheckinBy.has(r.profile_id)) {
      lastCheckinBy.set(r.profile_id, r.created_at);
    }
  }
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

    const lastCheckin = lastCheckinBy.get(profile.id) ?? null;
    const lastTouch =
      [nudgeState.last_nudged_at, lastCheckin]
        .filter((x): x is string => Boolean(x))
        .sort()
        .at(-1) ?? null;

    const verdict = shouldNudge({
      now,
      lastActivityAt,
      lastNudgedAt: lastTouch,
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
        const found = bioVerified(
          checkBio({
            tag: needle?.value ?? null,
            sentence: bioSentence(profile.bio_variant_index ?? 0),
            biography: ig.biography,
            website: ig.website,
          }),
        );
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

// ------------------------------------------------------------------
// The bio verify sweep. "Of course you need to check their IG to make sure"
// (Hugo, 08 Aug 2026). The reply-runner checks when a creator WRITES; this
// checks the quiet ones on a timer, so a creator who pastes the sentence and
// link and never comes back to the page (or the chat) still goes green and
// still gets told. It is the ONLY thing besides a live page read that may
// stamp the bio step done.
// ------------------------------------------------------------------

/** Re-read an unfinished bio at most this often. */
const BIO_CHECK_EVERY_MS = 10 * 60 * 1000;
const BIO_CHECKS_PER_RUN = 15;

export interface BioVerifyReport {
  checked: number;
  verified: number;
  congratulated: number;
  /** Links read off a creator's own Instagram bio because we held none. */
  linksCaptured: number;
  /** Creators told their link is in the Bio box and needs moving to Links. */
  movedToLinksBox: number;
  /** Creators told the Skool link on their page credits somebody else. */
  wrongCodeTold: number;
  errors: string[];
}

export async function runBioVerification(
  admin: ReturnType<typeof createAdminClient>,
): Promise<BioVerifyReport> {
  const report: BioVerifyReport = {
    checked: 0,
    verified: 0,
    congratulated: 0,
    linksCaptured: 0,
    movedToLinksBox: 0,
    wrongCodeTold: 0,
    errors: [],
  };
  const provider = (await getPostingSettingsAdmin())?.active_provider ?? "heypubli";
  if (provider !== "outstand") return report; // the only provider whose read includes the website field

  const now = new Date();
  const cutoff = new Date(now.getTime() - BIO_CHECK_EVERY_MS).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profiles } = (await (admin.from("profiles") as any)
    .select("*")
    .eq("onboarding_complete", false)
    .eq("is_admin", false)
    .is("suspended_at", null)
    .or(`bio_checked_at.is.null,bio_checked_at.lt.${cutoff}`)
    .order("bio_checked_at", { ascending: true, nullsFirst: true })
    .limit(BIO_CHECKS_PER_RUN)) as { data: Profile[] | null };

  for (const profile of profiles ?? []) {
    try {
      const { data: progress } = await admin
        .from("onboarding_progress")
        .select("profile_id, step, first_seen_at, completed_at")
        .eq("profile_id", profile.id)
        .returns<ProgressRow[]>();
      const states = await resolveStatesForCron(admin, profile, provider, progress ?? []);
      if (states.bio === "done") continue; // bio not the problem; not ours
      const { openStep } = resolveFunnel(states);
      if (openStep !== "bio") continue; // an earlier step is open, nudges own it

      const ig = await getOutstandInstagramData(profile.id);
      const nowIso = new Date().toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("profiles") as any)
        .update({ bio_checked_at: nowIso })
        .eq("id", profile.id);
      if (!ig?.statsAvailable) continue;
      report.checked++;

      // THEIR LINK, TAKEN OFF THEIR OWN PROFILE. Ma. Edelyn, 08 Aug 2026, had
      // pasted her Skool referral link into her Instagram bio and never told
      // us, so we held no link for her, could not check anything, and every
      // automatic read called her unfinished. If a Skool link is sitting on
      // their profile and we hold none, that link is theirs: save it. Never
      // overwrites one we already have, because replacing the link that
      // credits their sales is a decision, not a guess.
      if (!profile.skool_affiliate_url) {
        const found = skoolUrlInProfile(ig.biography, ig.website);
        const cleaned = found ? cleanSkoolAffiliateUrl(found) : null;
        if (cleaned) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin.from("profiles") as any)
            .update({ skool_affiliate_url: cleaned })
            .eq("id", profile.id)
            .is("skool_affiliate_url", null);
          profile.skool_affiliate_url = cleaned;
          report.linksCaptured++;
        }
      }
      if (!profile.skool_affiliate_url) continue;

      const evidence = checkBio({
        tag: skoolLinkNeedle(profile.skool_affiliate_url)?.value ?? null,
        sentence: bioSentence(profile.bio_variant_index ?? 0),
        biography: ig.biography,
        website: ig.website,
      });
      // Two states worth an unprompted message, because in both of them the
      // creator believes they have finished and every other check just reads
      // "not done" and chases them for it. Once each, keyed on the profile.
      //
      // THE WRONG CODE first, because it is money leaving: a Skool link on
      // their page carrying a stranger's referral (Nzama, 08 Aug 2026). Their
      // own traffic pays somebody else and nothing about the page looks wrong.
      const wrongCode = wrongCodeInProfile(
        profile.skool_affiliate_url,
        ig.biography,
        ig.website,
      );
      if (wrongCode) {
        if (profile.whatsapp && withinSendingHours(now, timezoneForPhone(profile.whatsapp))) {
          const first = (profile.first_name || "").trim().split(" ")[0];
          const res = await sendPartnerWhatsApp({
            to: profile.whatsapp,
            firstName: first,
            body: renderReply("bio_wrong_code", {
              firstName: first,
              affiliateUrl: profile.skool_affiliate_url,
              bioSentence: bioSentence(profile.bio_variant_index ?? 0),
            }),
            externalId: `biowrongcode:${profile.id}`,
          });
          if (res.ok) report.wrongCodeTold++;
        }
        continue;
      }
      // THE WRONG BOX. They did the work and put the link where Instagram
      // never makes it tappable. A two-tap fix, and the person is trying.
      if (!evidence.link && evidence.linkInText) {
        if (profile.whatsapp && withinSendingHours(now, timezoneForPhone(profile.whatsapp))) {
          const first = (profile.first_name || "").trim().split(" ")[0];
          const res = await sendPartnerWhatsApp({
            to: profile.whatsapp,
            firstName: first,
            body: renderReply("bio_link_not_clickable", {
              firstName: first,
              affiliateUrl: profile.skool_affiliate_url,
              bioSentence: bioSentence(profile.bio_variant_index ?? 0),
            }),
            externalId: `bionotclickable:${profile.id}`,
          });
          if (res.ok) report.movedToLinksBox++;
        }
        continue;
      }
      if (!bioVerified(evidence)) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("onboarding_progress") as any).upsert({
        profile_id: profile.id,
        step: "bio",
        first_seen_at: nowIso,
        completed_at: nowIso,
        updated_at: nowIso,
      });
      report.verified++;

      const after = await resolveStatesForCron(admin, profile, provider, [
        ...(progress ?? []).filter((r) => r.step !== "bio"),
        { profile_id: profile.id, step: "bio", first_seen_at: nowIso, completed_at: nowIso },
      ]);
      if (resolveFunnel(after).allDone) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("profiles") as any)
          .update({ onboarding_complete: true })
          .eq("id", profile.id);
      }

      // Tell them, once, in their daytime. The external id makes a crashed
      // and re-run tick send it once; outside their hours the stamp stands
      // and the page is already green, the message is a courtesy not a duty.
      if (profile.whatsapp && withinSendingHours(now, timezoneForPhone(profile.whatsapp))) {
        const first = (profile.first_name || "").trim().split(" ")[0];
        const res = await sendPartnerWhatsApp({
          to: profile.whatsapp,
          firstName: first,
          body:
            `${first ? `${first}, ` : ""}I just checked your Instagram and everything is in: your sentence, your link, all five steps done.\n\n` +
            `Your videos start going out from here. I will let you know when the first one lands.`,
          externalId: `bioverified:${profile.id}`,
        });
        if (res.ok) report.congratulated++;
      }
    } catch (e) {
      report.errors.push(`${profile.id}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }
  return report;
}
