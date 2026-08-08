// The audio half of "no two accounts look like one asset".
//
// The picture has been varied per account since day one, but every copy of a
// master carried byte-identical audio, which is a perfect fingerprint match.
// pitchFor gives each account its own shift. It is free, it runs on the render
// box, and it is deliberately gentle: measured on a real clip, every shift in
// this range transcribes back word perfect.

import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs helper shared with the render worker
import { PITCH_SPAN, PITCH_STEPS, pitchFor } from "../../scripts/lib/voice-swap.mjs";

const ids = Array.from({ length: 200 }, (_, i) => `profile-${i}-${(i * 7919) % 104729}`);

describe("per-account voice variation", () => {
  it("is stable for an account, so its videos always sound like the same person", () => {
    expect(pitchFor("acct-a")).toBe(pitchFor("acct-a"));
  });

  it("stays inside a range small enough that nobody hears processing", () => {
    for (const id of ids) {
      const p = pitchFor(id);
      expect(p).toBeGreaterThanOrEqual(1 - PITCH_SPAN - 0.001);
      expect(p).toBeLessThanOrEqual(1 + PITCH_SPAN + 0.001);
      // Roughly a semitone either way.
      expect(Math.abs(12 * Math.log2(p))).toBeLessThan(1.2);
    }
  });

  it("spreads accounts across the whole range rather than bunching", () => {
    const used = new Set(ids.map(pitchFor));
    // 200 accounts over 25 steps should touch nearly all of them.
    expect(used.size).toBeGreaterThanOrEqual(PITCH_STEPS - 2);
  });

  it("gives different accounts different pitches far more often than not", () => {
    // Two accounts sharing a pitch is not a failure the way a shared posting
    // MINUTE is: the visuals still differ entirely. It just should be rare.
    const first25 = ids.slice(0, 25).map(pitchFor);
    expect(new Set(first25).size).toBeGreaterThanOrEqual(15);
  });
});
