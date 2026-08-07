import { describe, expect, it } from "vitest";
import {
  COLOR_FAMILIES,
  FAMILY_CHIP_HEX,
  enrollmentOffsets,
  nextSlots,
  pickColorFamily,
  postsInLocalDay,
  todaySlots,
  STAGGER_STEP_MIN,
  STAGGER_SLOTS,
} from "./video-pipeline";

describe("colors", () => {
  it("mirrors the factory's 14 families, each with a UI chip", () => {
    expect(COLOR_FAMILIES.length).toBe(14);
    expect(new Set(COLOR_FAMILIES).size).toBe(14);
    for (const f of COLOR_FAMILIES) expect(FAMILY_CHIP_HEX[f]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("the first 14 accounts all get different colors", () => {
    const taken: string[] = [];
    for (let i = 0; i < 14; i++) taken.push(pickColorFamily(taken));
    expect(new Set(taken).size).toBe(14);
  });

  it("account 15 reuses the least-held family, deterministically", () => {
    const taken = [...COLOR_FAMILIES];
    expect(pickColorFamily(taken)).toBe(pickColorFamily(taken));
    expect(COLOR_FAMILIES).toContain(pickColorFamily(taken));
  });
});

describe("stagger", () => {
  it("no two of the first eighteen accounts share a minute offset", () => {
    const staggers: number[] = [];
    const variants: number[] = [];
    for (let i = 0; i < STAGGER_SLOTS; i++) {
      const o = enrollmentOffsets(staggers, variants);
      staggers.push(o.staggerMin);
      variants.push(o.variantIdx);
    }
    expect(new Set(staggers).size).toBe(STAGGER_SLOTS);
    expect(Math.max(...staggers)).toBe((STAGGER_SLOTS - 1) * STAGGER_STEP_MIN);
  });

  it("a slot freed by a DELETED account may be reused, but never one held live", () => {
    // Live accounts hold 0 and 14 (7 was deleted): the next enrollee gets 7.
    const o = enrollmentOffsets([0, 14], [0, 1, 2]);
    expect(o.staggerMin).toBe(7);
  });

  it("the look number is never reused, even after a deletion", () => {
    // Account with variant 1 was deleted; live variants are 0 and 2. The next
    // account must take 3, or two accounts share a visual identity.
    expect(enrollmentOffsets([0, 14], [0, 2]).variantIdx).toBe(3);
    expect(enrollmentOffsets([], []).variantIdx).toBe(0);
  });
});

describe("todaySlots", () => {
  it("returns only slots landing on the account's current local day", () => {
    // 06:00 UTC = 11:30 IST: the 11:00 slot is gone, only 19:00 remains today.
    const slots = todaySlots(new Date("2026-08-08T06:00:00Z"), "Asia/Kolkata", 0);
    expect(slots.map((s) => s.slot)).toEqual(["evening"]);
  });

  it("after the last slot has passed it returns NOTHING, never tomorrow", () => {
    // 15:00 UTC = 20:30 IST: both of today's slots are gone. The review bug:
    // returning tomorrow's here made every 15-minute run schedule two more.
    const slots = todaySlots(new Date("2026-08-08T15:00:00Z"), "Asia/Kolkata", 0);
    expect(slots).toEqual([]);
  });

  it("early morning returns both of today's slots", () => {
    const slots = todaySlots(new Date("2026-08-08T00:30:00Z"), "Asia/Kolkata", 21);
    expect(slots.map((s) => s.slot)).toEqual(["morning", "evening"]);
  });
});

describe("nextSlots", () => {
  // 06:00 UTC = 11:30 in India (UTC+5:30): the morning slot is 11:00 IST,
  // already past, so the first slot must be this evening.
  it("skips a slot already past in the creator's own day", () => {
    const after = new Date("2026-08-08T06:00:00Z");
    const slots = nextSlots(after, "Asia/Kolkata", 0, 2);
    expect(slots[0].slot).toBe("evening");
    // 19:00 IST = 13:30 UTC
    expect(slots[0].at.toISOString()).toBe("2026-08-08T13:30:00.000Z");
    expect(slots[1].slot).toBe("morning");
    expect(slots[1].at.toISOString()).toBe("2026-08-09T05:30:00.000Z");
  });

  it("applies the stagger to every slot", () => {
    const after = new Date("2026-08-08T00:00:00Z");
    const plain = nextSlots(after, "Asia/Dhaka", 0, 2);
    const shifted = nextSlots(after, "Asia/Dhaka", 21, 2);
    expect(shifted[0].at.getTime() - plain[0].at.getTime()).toBe(21 * 60_000);
    expect(shifted[1].at.getTime() - plain[1].at.getTime()).toBe(21 * 60_000);
  });

  it("two accounts in one timezone never share an instant", () => {
    const after = new Date("2026-08-08T00:00:00Z");
    const first = enrollmentOffsets([], []);
    const second = enrollmentOffsets([first.staggerMin], [first.variantIdx]);
    const a = nextSlots(after, "Asia/Manila", first.staggerMin, 4);
    const b = nextSlots(after, "Asia/Manila", second.staggerMin, 4);
    const at = new Set(a.map((s) => s.at.getTime()));
    for (const s of b) expect(at.has(s.at.getTime())).toBe(false);
  });

  it("never returns an instant at or before `after`", () => {
    const after = new Date("2026-08-08T13:30:00Z");
    for (const s of nextSlots(after, "Asia/Kolkata", 0, 6)) {
      expect(s.at.getTime()).toBeGreaterThan(after.getTime());
    }
  });
});

describe("postsInLocalDay", () => {
  it("counts by the creator's calendar, not UTC's", () => {
    // 20:00 UTC on the 8th is already the 9th in Dhaka (UTC+6).
    const now = new Date("2026-08-08T20:00:00Z");
    const posts = [
      new Date("2026-08-08T05:21:00Z"), // 11:21 Dhaka, the 8th
      new Date("2026-08-08T19:30:00Z"), // 01:30 Dhaka, the 9th
    ];
    expect(postsInLocalDay(now, "Asia/Dhaka", posts)).toBe(1);
  });
});
