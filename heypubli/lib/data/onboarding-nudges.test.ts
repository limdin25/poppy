import { describe, it, expect } from "vitest";
import {
  pickNudge,
  shouldNudge,
  ONB_TEMPLATES,
  FREEFORM_GENERAL,
  FREEFORM_BY_STEP,
  MAX_NUDGES,
  NUDGE_GAP_HOURS,
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
      lastNudgedAt: hoursAgo(NUDGE_GAP_HOURS - 1),
    });
    expect(r).toEqual({ ok: false, reason: "too_soon" });
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
