import { getBrochureData, type BrochureData, type StepState } from "@/lib/data/brochure";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordSignupLead } from "@/lib/data/signup-leads";
import type { OnboardingStepId, Profile } from "@/types/database";

/**
 * The gated onboarding funnel: five steps, strictly in this order, one open at
 * a time. Hugo, 2026-08-06: "they can't advance until they get that thing done
 * ... make it so easy for them not to go wrong."
 *
 * The order is deliberate. Instagram first because it is the investment that
 * makes the rest worth finishing. Community and the affiliate link before the
 * bio, because the bio step pastes the link the affiliate step produced. The
 * photo sits right before the bio because both happen on the same Instagram
 * Edit profile screen.
 */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
  "instagram",
  "community",
  "affiliate",
  "photo",
  "bio",
] as const;

export interface FunnelResolution {
  /** The one step the page shows open. Null when nothing is actionable. */
  openStep: OnboardingStepId | null;
  doneSteps: number;
  totalSteps: number;
  allDone: boolean;
}

/**
 * Which step is open, how many are done, whether the whole thing is finished.
 *
 * A "blocked" step never traps the funnel: blocked means either "ours to fix"
 * (Instagram connecting switched off) or "an earlier step must come first"
 * (the bio needs the link), and in both cases the creator should be moved to
 * the first step they can actually act on. But completion is strict: all five
 * must be done. Four green ticks and a blocked Instagram is not an onboarded
 * creator, because posting is the product.
 */
export function resolveFunnel(states: Record<OnboardingStepId, StepState>): FunnelResolution {
  const doneSteps = ONBOARDING_STEPS.filter((s) => states[s] === "done").length;
  const openStep =
    ONBOARDING_STEPS.find((s) => states[s] !== "done" && states[s] !== "blocked") ?? null;
  return {
    openStep,
    doneSteps,
    totalSteps: ONBOARDING_STEPS.length,
    allDone: doneSteps === ONBOARDING_STEPS.length,
  };
}

export interface OnboardingData extends BrochureData {
  photo: {
    state: StepState;
    declaredAt: string | null;
  };
  stepStates: Record<OnboardingStepId, StepState>;
  openStep: OnboardingStepId | null;
  doneSteps: number;
  totalSteps: number;
  allDone: boolean;
}

/**
 * Everything /onboarding needs, resolved once on the server. Wraps the
 * brochure's four verified truths and adds the photo step, which is
 * self-declared because no API can judge whether a profile photo is any good.
 */
export async function getOnboardingData(profile: Profile): Promise<OnboardingData> {
  const brochure = await getBrochureData(profile);

  const photoState: StepState = profile.photo_declared_at ? "done" : "todo";

  const stepStates: Record<OnboardingStepId, StepState> = {
    instagram: brochure.instagram.state,
    community: brochure.community.state,
    affiliate: brochure.affiliate.state,
    photo: photoState,
    bio: brochure.bio.state,
  };

  const resolution = resolveFunnel(stepStates);

  return {
    ...brochure,
    photo: { state: photoState, declaredAt: profile.photo_declared_at ?? null },
    stepStates,
    ...resolution,
  };
}

interface ProgressRow {
  step: OnboardingStepId;
  first_seen_at: string | null;
  completed_at: string | null;
}

/**
 * The tracking Hugo asked for, in one place: every step gets a first_seen_at
 * the moment it opens in front of the creator and a completed_at the moment it
 * reads as done. The nudge brain reads these stamps to know who is stuck where
 * and for how long.
 *
 * Runs on every /onboarding render. Bookkeeping must never cost a page view,
 * so every failure is logged and swallowed.
 */
export async function stampOnboardingProgress(
  profile: Profile,
  data: OnboardingData,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    const { data: rows } = await admin
      .from("onboarding_progress")
      .select("step, first_seen_at, completed_at")
      .eq("profile_id", profile.id)
      .returns<ProgressRow[]>();
    const byStep = new Map((rows ?? []).map((r) => [r.step, r]));

    // First ever visit: the signup lead moves to "started", same stage the old
    // wizard stamped, so the admin funnel and the nurture skip rules keep
    // working unchanged.
    if (!rows?.length) {
      await recordSignupLead({
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        whatsapp: profile.whatsapp ?? "",
        stage: "started",
        profileId: profile.id,
      });
    }

    for (const step of ONBOARDING_STEPS) {
      const existing = byStep.get(step);
      const isDone = data.stepStates[step] === "done";
      const isOpen = data.openStep === step;

      if (!existing) {
        if (!isDone && !isOpen) continue; // locked and untouched: no row yet
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (admin.from("onboarding_progress") as any).insert({
          profile_id: profile.id,
          step,
          first_seen_at: nowIso,
          completed_at: isDone ? nowIso : null,
        });
        if (error && error.code !== "23505") {
          console.error("[onboarding] progress insert failed", step, error);
        }
        continue;
      }

      const patch: Record<string, unknown> = {};
      if (!existing.first_seen_at && (isOpen || isDone)) patch.first_seen_at = nowIso;
      // Forward-only: a completed_at is never cleared, even if a later check
      // reads the step as undone again (a bio edit, an API hiccup). The stamp
      // records that they got there; the page still shows the live state.
      if (!existing.completed_at && isDone) patch.completed_at = nowIso;
      if (Object.keys(patch).length) {
        patch.updated_at = nowIso;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (admin.from("onboarding_progress") as any)
          .update(patch)
          .eq("profile_id", profile.id)
          .eq("step", step);
        if (error) console.error("[onboarding] progress update failed", step, error);
      }
    }

    if (data.allDone && !profile.onboarding_complete) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin.from("profiles") as any)
        .update({ onboarding_complete: true })
        .eq("id", profile.id);
      if (error) console.error("[onboarding] complete stamp failed", error);
    }
  } catch (e) {
    console.error("[onboarding] stampOnboardingProgress threw", e);
  }
}
