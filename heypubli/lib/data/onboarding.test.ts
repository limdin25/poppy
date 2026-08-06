import { describe, it, expect } from "vitest";
import { ONBOARDING_STEPS, resolveFunnel } from "./onboarding";
import type { StepState } from "@/lib/data/brochure";
import type { OnboardingStepId } from "@/types/database";

function states(
  overrides: Partial<Record<OnboardingStepId, StepState>>,
): Record<OnboardingStepId, StepState> {
  const base: Record<OnboardingStepId, StepState> = {
    instagram: "todo",
    community: "waiting",
    affiliate: "todo",
    photo: "todo",
    bio: "blocked",
  };
  return { ...base, ...overrides };
}

describe("resolveFunnel", () => {
  it("opens the first step for a brand new creator", () => {
    const r = resolveFunnel(states({}));
    expect(r.openStep).toBe("instagram");
    expect(r.doneSteps).toBe(0);
    expect(r.allDone).toBe(false);
  });

  it("moves the open step forward as steps finish, in order", () => {
    const r = resolveFunnel(states({ instagram: "done", community: "done" }));
    expect(r.openStep).toBe("affiliate");
    expect(r.doneSteps).toBe(2);
  });

  // Blocked means "ours to fix" or "an earlier step first". Either way the
  // creator must be handed the first step they can actually act on, not a
  // padlock.
  it("skips a blocked step instead of trapping the funnel on it", () => {
    const r = resolveFunnel(states({ instagram: "blocked" }));
    expect(r.openStep).toBe("community");
  });

  // Four ticks and a blocked Instagram is not an onboarded creator. Posting is
  // the product; completion is strict.
  it("never calls it done while any step is not done", () => {
    const r = resolveFunnel(
      states({
        instagram: "blocked",
        community: "done",
        affiliate: "done",
        photo: "done",
        bio: "done",
      }),
    );
    expect(r.allDone).toBe(false);
    expect(r.openStep).toBeNull();
  });

  it("is done exactly when all five are done", () => {
    const all: Partial<Record<OnboardingStepId, StepState>> = {};
    for (const s of ONBOARDING_STEPS) all[s] = "done";
    const r = resolveFunnel(states(all));
    expect(r.allDone).toBe(true);
    expect(r.openStep).toBeNull();
    expect(r.doneSteps).toBe(5);
    expect(r.totalSteps).toBe(5);
  });

  it("keeps bio last: it only opens once everything before it is done", () => {
    const r = resolveFunnel(
      states({
        instagram: "done",
        community: "done",
        affiliate: "done",
        photo: "done",
        bio: "waiting",
      }),
    );
    expect(r.openStep).toBe("bio");
  });
});
