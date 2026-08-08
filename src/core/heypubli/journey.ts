// Where a HeyPubli creator lead is on their journey, and what happens to them
// next. ONE module, read by the Elsie CRM inbox and by the API route that
// fetches from the HeyPubli database.
//
// Nothing here is re-derived. Every rule is copied from the HeyPubli repo,
// which owns it, and tests/heypubli-journey.test.ts reads those files and
// fails the build if the two ever disagree:
//
//   the five steps          heypubli/lib/data/onboarding.ts  ONBOARDING_STEPS
//   the 5/5 count Hugo sees heypubli/scripts/check-creators.mjs
//   the slow nudge ladder   heypubli/lib/data/onboarding-nudges.ts
//   the fast check-ins      heypubli/lib/data/reply-brain.ts  decideCheckIn
//
// Pure: no React, no network, no clock of its own. `now` is always passed in.

export const HEYPUBLI_STEPS = [
  'instagram',
  'community',
  'affiliate',
  'photo',
  'bio',
] as const;

export type HeypubliStepId = (typeof HEYPUBLI_STEPS)[number];

/** Plain words for each step, for a panel a non-technical person reads. */
export const STEP_LABEL: Record<HeypubliStepId, string> = {
  instagram: 'Instagram connected',
  community: 'Joined the community',
  affiliate: 'Affiliate link saved',
  photo: 'Profile photo set',
  bio: 'Link in the bio',
};

/** The step as the middle of a sentence: "a nudge about SHORT". STEP_LABEL is
 *  a heading and does not survive being lowercased into one ("a nudge about
 *  profile photo set" is not English). */
export const STEP_SHORT: Record<HeypubliStepId, string> = {
  instagram: 'connecting their Instagram',
  community: 'joining the community',
  affiliate: 'saving their affiliate link',
  photo: 'their profile photo',
  bio: 'the link in their bio',
};

/** One line of help per step, for the tooltip on a step that is not done. */
export const STEP_HINT: Record<HeypubliStepId, string> = {
  instagram: 'They log in with Instagram, which has to be a Professional account.',
  community: 'They open the Skool invite in their email and join.',
  affiliate: 'They copy their own referral link out of Skool and paste it to us.',
  photo: 'A clear profile photo on their Instagram.',
  bio: 'Their referral link goes live in their Instagram bio.',
};

// --- the ladder, copied from heypubli -------------------------------------

/** The fast rungs, in minutes of quiet. reply-brain.ts. Four rungs PER STEP
 *  since 08 Aug 2026 (Hugo: "two follow-ups in the same hour, then six hours,
 *  then twenty-three", and it applies to every step and every new account),
 *  so finishing a step gives the creator a fresh set of four on the next one. */
export const CHECK_IN_LADDER_MINUTES = [10, 30, 360, 1380] as const;
/** How long a creator sits still before the FIRST slow nudge. */
export const FIRST_NUDGE_AFTER_HOURS = 2;
/** Gap before the second nudge, then every one after that. */
export function nudgeGapHours(nudgeCount: number): number {
  return nudgeCount <= 1 ? 22 : 44;
}
/** Lifetime cap per creator, then it stops for good. */
export const MAX_NUDGES = 6;
/** An inbound reply parks the drip this long. A conversation beats a robot. */
export const REPLY_PAUSE_HOURS = 3;

// --- joining the two databases --------------------------------------------

/**
 * The join key between the two Supabase projects: HeyPubli
 * `profiles.whatsapp` against the Elsie CRM `wk_contacts.phone`. Digits only,
 * so "+91 8207 324841", "whatsapp:+918207324841" and "918207324841" are one
 * lead and not three.
 */
export function phoneKey(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

// --- the five steps -------------------------------------------------------

export interface ProgressRow {
  step: string;
  first_seen_at: string | null;
  completed_at: string | null;
}

export interface JourneyProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  whatsapp: string | null;
  igUsername: string | null;
  /** From outstand_connections. NEVER instagram_connections, which is empty. */
  igConnected: boolean;
  createdAt: string;
  onboardingComplete: boolean;
  suspendedAt: string | null;
  communityJoinedDeclaredAt: string | null;
  photoDeclaredAt: string | null;
  bioLinkDeclaredAt: string | null;
  skoolAffiliateUrl: string | null;
}

export interface JourneyStep {
  id: HeypubliStepId;
  label: string;
  hint: string;
  done: boolean;
  /** When it was completed, when we know. Null for a step still open. */
  at: string | null;
}

/**
 * The five steps with a done flag and a timestamp each.
 *
 * TWO sources, deliberately, and done in either is done. `onboarding_progress`
 * carries the completed_at stamps (what check-creators.mjs counts), and the
 * profile carries the declared_at columns the funnel writes. Reading only one
 * under-reports the creators who finished before the other existed. Both are
 * forward-only: a completed step is never un-completed by a later live check.
 *
 * EXCEPT the bio. 08 Aug 2026: a creator ticked "It is there" over a
 * completely empty Instagram, this panel showed Hugo "Link in the bio" done,
 * and the reply brain told the creator his link was live. The declaration is
 * a claim; only the progress stamp (written by a live read of the real
 * profile) counts as done for the bio, matching heypubli's
 * resolveStatesForCron.
 */
export function resolveJourneySteps(
  profile: JourneyProfile,
  progress: ProgressRow[],
): JourneyStep[] {
  const stamp = new Map<string, string | null>();
  for (const r of progress) {
    if (r.completed_at) stamp.set(r.step, r.completed_at);
  }

  const declared: Record<HeypubliStepId, string | null> = {
    instagram: null,
    community: profile.communityJoinedDeclaredAt,
    affiliate: null,
    photo: profile.photoDeclaredAt,
    bio: null,
  };

  // Two steps carry no timestamp of their own, only a live fact.
  const live: Record<HeypubliStepId, boolean> = {
    instagram: profile.igConnected,
    community: false,
    affiliate: Boolean(profile.skoolAffiliateUrl),
    photo: false,
    bio: false,
  };

  return HEYPUBLI_STEPS.map((id) => {
    const at = stamp.get(id) ?? declared[id] ?? null;
    return {
      id,
      label: STEP_LABEL[id],
      hint: STEP_HINT[id],
      done: Boolean(at) || live[id],
      at,
    };
  });
}

/** The first step still open, or null when every one is done. */
export function openStepOf(steps: JourneyStep[]): HeypubliStepId | null {
  return steps.find((s) => !s.done)?.id ?? null;
}

// --- what happens next ----------------------------------------------------

export type NextTouchKind =
  | 'none'
  | 'done'
  | 'stopped'
  | 'reply'
  | 'check_in'
  | 'nudge';

export interface NextTouch {
  kind: NextTouchKind;
  /** The headline, four or five words. */
  label: string;
  /** The sentence under it, saying why. */
  detail: string;
  /** When it is due, or null when nothing is scheduled. */
  dueAt: string | null;
  /** Already due and not yet sent. */
  overdue: boolean;
  /** Which nudge this would be, counting from 1. */
  nudgeNumber: number | null;
  /** Which fast rung this would be, counting from 1. */
  rung: number | null;
}

/**
 * "in 21h", "in 9 min", "due now". Plain words for a due time, for somebody
 * who should not have to subtract two timestamps in their head.
 */
export function dueLabel(dueAt: string | null, now: Date): string {
  if (!dueAt) return '';
  const t = new Date(dueAt).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.round((t - now.getTime()) / 60_000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  // Floored, not rounded: "in 1 day" for a 45 hour wait understates it, and
  // understating when the next message goes out is the safe direction. Nobody
  // is annoyed that a nudge arrived later than the panel implied.
  const days = Math.floor(hours / 24);
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}

export interface NextTouchInput {
  now: Date;
  /** Do they have a HeyPubli account at all? */
  hasAccount: boolean;
  allDone: boolean;
  openStep: HeypubliStepId | null;
  suspendedAt: string | null;
  /** onboarding_nudge_state.stopped_at */
  stoppedAt: string | null;
  nudgeCount: number;
  lastNudgedAt: string | null;
  /** The freshest sign of life: a step opening or completing, or the signup. */
  lastActivityAt: string | null;
  /** Their newest inbound WhatsApp message. */
  lastInboundAt: string | null;
  /** The newest message we sent them. */
  lastOutboundAt: string | null;
  /** Fast check-ins already spent on the step they are on. */
  checkInsThisStep: number;
  /**
   * Is anything actually SENDING the fast check-ins?
   *
   * Since 07 Aug 2026 the answer is yes: runReplyBrain in
   * heypubli/lib/data/reply-runner.ts (phase 2, the every-minute /api/funnel/
   * reply cron) calls decideCheckIn() and sends. Callers pass true. If that
   * wiring is ever removed, flip the callers back to false so the inbox stops
   * promising a message nothing sends.
   */
  checkInsLive: boolean;
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

const plain = (
  kind: NextTouchKind,
  label: string,
  detail: string,
): NextTouch => ({ kind, label, detail, dueAt: null, overdue: false, nudgeNumber: null, rung: null });

/**
 * The one next thing that will happen to this lead, and when.
 *
 * Read the order of the guards, it is the whole logic. Every "nothing is
 * scheduled" answer is reached BEFORE any answer that would put a time on the
 * screen, so the panel can only ever show a due time for a message that is
 * genuinely queued behind that rule.
 */
export function nextTouch(input: NextTouchInput): NextTouch {
  const now = input.now.getTime();

  if (!input.hasAccount) {
    return plain(
      'none',
      'No account yet',
      'They have not signed up, so the onboarding follow-ups have nothing to chase. This thread is yours.',
    );
  }
  if (input.allDone) {
    return plain(
      'done',
      'All five done',
      'Nothing left to chase. They are onboarded and the nudges have stopped.',
    );
  }
  if (input.suspendedAt) {
    return plain('stopped', 'Suspended', 'This account is suspended, so nothing is sent to them.');
  }
  if (input.stoppedAt) {
    return plain(
      'stopped',
      'Follow-ups stopped',
      'They opted out or the nudges were stopped for them. Only a human writes now.',
    );
  }
  if (input.nudgeCount >= MAX_NUDGES) {
    return plain(
      'stopped',
      'Follow-ups spent',
      `All ${MAX_NUDGES} automatic follow-ups have been used. Nothing else goes out on its own.`,
    );
  }

  const inbound = ms(input.lastInboundAt);
  const outbound = ms(input.lastOutboundAt);

  // They wrote last, so this thread belongs to a human right now.
  //
  // IT DOES NOT SAY THE ROBOT IS PAUSED, and it used to. shouldNudge() in
  // heypubli/lib/data/onboarding-nudges.ts holds the drip for REPLY_PAUSE_HOURS
  // measured from signup_leads.engaged_at, and engaged_at is stamped on their
  // FIRST reply and never refreshed. So a lead who replied ten times today can
  // still be past that window, and an automatic nudge can go out to somebody
  // this panel had called paused. Claiming nothing beats claiming it wrong.
  if (inbound !== null && (outbound === null || inbound > outbound)) {
    return plain('reply', 'Waiting on us', 'They wrote last. Answer them here.');
  }

  const stepLabel = input.openStep ? STEP_SHORT[input.openStep] : 'the next step';

  // The fast rungs, if anything is sending them.
  if (
    input.checkInsLive &&
    outbound !== null &&
    input.checkInsThisStep < CHECK_IN_LADDER_MINUTES.length
  ) {
    const rung = input.checkInsThisStep;
    const dueMs = outbound + CHECK_IN_LADDER_MINUTES[rung] * 60_000;
    return {
      kind: 'check_in',
      label: `Check-in ${rung + 1} of ${CHECK_IN_LADDER_MINUTES.length}`,
      detail: `A short "everything ok?" about ${stepLabel}. It is cancelled the moment they reply.`,
      dueAt: new Date(dueMs).toISOString(),
      overdue: dueMs <= now,
      nudgeNumber: null,
      rung: rung + 1,
    };
  }

  // The slow ladder, which is the one that is live. Due when the LAST of the
  // three waits has passed, exactly as shouldNudge() decides it.
  const waits: number[] = [];
  const activity = ms(input.lastActivityAt);
  if (activity !== null) waits.push(activity + FIRST_NUDGE_AFTER_HOURS * 3600_000);
  const nudged = ms(input.lastNudgedAt);
  if (nudged !== null) waits.push(nudged + nudgeGapHours(input.nudgeCount) * 3600_000);
  if (inbound !== null) waits.push(inbound + REPLY_PAUSE_HOURS * 3600_000);
  const dueMs = waits.length ? Math.max(...waits) : now;
  const nudgeNumber = input.nudgeCount + 1;

  return {
    kind: 'nudge',
    label: `Follow-up ${nudgeNumber} of ${MAX_NUDGES}`,
    detail: `A WhatsApp nudge about ${stepLabel}. It is cancelled if they reply first.`,
    dueAt: new Date(dueMs).toISOString(),
    overdue: dueMs <= now,
    nudgeNumber,
    rung: null,
  };
}
