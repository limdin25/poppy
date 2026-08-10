import { describe, it, expect } from "vitest";
import {
  pickNudge,
  shouldNudge,
  ONB_TEMPLATES,
  FREEFORM_GENERAL,
  FREEFORM_BY_STEP,
  MAX_NUDGES,
  nudgeGapHours,
  FIRST_NUDGE_AFTER_HOURS,
} from "./onboarding-nudges";
import { ONBOARDING_STEPS } from "./onboarding";

const NOW = new Date("2026-08-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const base = {
  now: NOW,
  lastActivityAt: hoursAgo(48),
  lastNudgedAt: null,
  nudgeCount: 0,
  engagedAt: null,
  stoppedAt: null,
};

describe("shouldNudge", () => {
  it("nudges a creator who has sat still past the threshold", () => {
    expect(shouldNudge(base)).toEqual({ ok: true });
  });

  it("leaves a creator alone while they are still moving", () => {
    const r = shouldNudge({ ...base, lastActivityAt: hoursAgo(FIRST_NUDGE_AFTER_HOURS - 1) });
    expect(r).toEqual({ ok: false, reason: "still_active" });
  });

  it("respects the gap between nudges", () => {
    const r = shouldNudge({
      ...base,
      nudgeCount: 1,
      lastNudgedAt: hoursAgo(nudgeGapHours(1) - 1),
    });
    expect(r).toEqual({ ok: false, reason: "too_soon" });
  });

  // Hugo's fast follow-back: the first nudge is HOURS after a stall, not a
  // day, because a fresh lead's 24h window is open and the message is free.
  it("fires the first nudge fast and spaces the later ones out", () => {
    expect(FIRST_NUDGE_AFTER_HOURS).toBeLessThanOrEqual(2);
    expect(nudgeGapHours(1)).toBeGreaterThanOrEqual(20);
    expect(nudgeGapHours(2)).toBeGreaterThan(nudgeGapHours(1));
  });

  // A live conversation beats a robot. The AI or a human is already talking
  // to them; a scripted nudge in the middle of that reads as broken.
  it("pauses while the creator is mid-conversation with us", () => {
    const r = shouldNudge({ ...base, engagedAt: hoursAgo(2) });
    expect(r).toEqual({ ok: false, reason: "in_conversation" });
  });

  it("stops for good at the lifetime cap", () => {
    const r = shouldNudge({ ...base, nudgeCount: MAX_NUDGES, lastNudgedAt: hoursAgo(100) });
    expect(r).toEqual({ ok: false, reason: "exhausted" });
  });

  it("never nudges a stopped creator", () => {
    const r = shouldNudge({ ...base, stoppedAt: hoursAgo(100) });
    expect(r).toEqual({ ok: false, reason: "stopped" });
  });
});

describe("pickNudge", () => {
  it("leads with the step-specific message, then alternates with the general one", () => {
    const first = pickNudge("community", 0);
    const second = pickNudge("community", 1);
    expect(first.templateKey).toBe("onb_step_community");
    expect(second.templateKey.startsWith("onb_nudge_general")).toBe(true);
  });

  it("never repeats the same general wording twice in a row", () => {
    const a = pickNudge("bio", 1);
    const b = pickNudge("bio", 3);
    expect(a.templateKey).not.toBe(b.templateKey);
    expect(a.freeformKey).not.toBe(b.freeformKey);
  });

  it("has a template SID for every step and every key it can pick", () => {
    for (const step of ONBOARDING_STEPS) {
      for (let count = 0; count < MAX_NUDGES; count++) {
        const pick = pickNudge(step, count);
        expect(pick.templateSid, `${step}#${count}`).toMatch(/^HX[0-9a-f]{32}$/i);
        expect(typeof pick.freeform("Sam")).toBe("string");
      }
    }
  });

  it("mentions the funnel page in every free-form message", () => {
    const all = [
      ...Object.values(FREEFORM_GENERAL),
      ...Object.values(FREEFORM_BY_STEP).flatMap((m) => Object.values(m)),
    ];
    for (const make of all) {
      expect(make("Sam")).toContain("heypubli.com/onboarding");
    }
  });

  it("uses no banned punctuation in any message a lead could receive", () => {
    const texts = [
      ...Object.values(FREEFORM_GENERAL),
      ...Object.values(FREEFORM_BY_STEP).flatMap((m) => Object.values(m)),
    ].map((make) => make("Sam"));
    for (const code of [0x2014, 0x2013, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026]) {
      const ch = String.fromCharCode(code);
      for (const text of texts) expect(text).not.toContain(ch);
    }
  });

  it("resolves template SIDs env-first so a re-submission is a config change", () => {
    // The keys map is the single lookup the runner uses; every advertised
    // template key must resolve to something HX-shaped.
    for (const [key, sidValue] of Object.entries(ONB_TEMPLATES.keys)) {
      expect(sidValue, key).toMatch(/^HX[0-9a-f]{32}$/i);
    }
  });
});

// STRUCTURAL GUARD, 10 Aug 2026. `bio_checked_at` is runBioVerification's queue
// position: the sweep takes the 15 oldest and orders by it. A profile that is
// looked at and skipped must still be stamped, or it holds a slot in every run
// forever and starves everyone behind it. Two `continue`s used to skip without
// stamping, so any creator not on the bio step wedged at the front; 22 of them
// took all 15 slots and the sweep did nothing at all for 16 minutes.
//
// Pinned in the source because the alternative is mocking Supabase, Outstand
// and WhatsApp to assert one UPDATE, and that test would break for reasons that
// have nothing to do with this rule.
describe("runBioVerification queue rotation", () => {
  it("stamps bio_checked_at before any step check can skip the profile", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "lib/data/onboarding-nudges.ts"),
      "utf8",
    );
    const body = src.slice(src.indexOf("export async function runBioVerification"));
    const stamp = body.indexOf("bio_checked_at: new Date().toISOString()");
    const bioDoneSkip = body.indexOf('if (states.bio === "done") continue');
    const openStepSkip = body.indexOf('if (openStep !== "bio") continue');

    expect(stamp).toBeGreaterThan(-1);
    expect(bioDoneSkip).toBeGreaterThan(-1);
    expect(openStepSkip).toBeGreaterThan(-1);
    // The stamp has to come first, or the skip wedges the profile at the head
    // of the queue.
    expect(stamp).toBeLessThan(bioDoneSkip);
    expect(stamp).toBeLessThan(openStepSkip);
  });
});
