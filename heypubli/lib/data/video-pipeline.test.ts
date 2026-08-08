import { describe, expect, it } from "vitest";
import {
  CAPTION_COMBOS,
  captionFor,
  composeCaption,
  COLOR_FAMILIES,
  FAMILY_ACCENT_HEX,
  FAMILY_CHIP_HEX,
  enrollmentOffsets,
  HASHTAGS,
  hashtagsFor,
  MAX_HASHTAGS,
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
    for (const f of COLOR_FAMILIES) {
      expect(FAMILY_CHIP_HEX[f]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(FAMILY_ACCENT_HEX[f]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // Fourteen distinct backgrounds, or the chip stops telling accounts apart.
    expect(new Set(COLOR_FAMILIES.map((f) => FAMILY_CHIP_HEX[f])).size).toBe(14);
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
    // Live accounts hold 0 and 14: the next enrollee takes a free minute, and
    // crucially not one of theirs.
    const o = enrollmentOffsets([0, 14], [0, 1, 2]);
    expect([0, 14]).not.toContain(o.staggerMin);
    expect(o.exhausted).toBe(false);
  });

  // Hugo, 08 Aug 2026: "it cannot be, you know, it posted the same minute, we
  // have to fix that." The old grid was 18 offsets of 7 minutes and there were
  // already 18 accounts, so account 19 shared a minute with a live account in
  // the same timezone. That is the clustering signal VARIANTS.md calls worse
  // than any pixel match.
  it("gives a hundred accounts a hundred different minutes", () => {
    const staggers: number[] = [];
    const variants: number[] = [];
    for (let i = 0; i < 100; i++) {
      const o = enrollmentOffsets(staggers, variants);
      expect(o.exhausted).toBe(false);
      staggers.push(o.staggerMin);
      variants.push(o.variantIdx);
    }
    expect(new Set(staggers).size).toBe(100);
  });

  it("the eighteen accounts that already exist keep the minutes they hold", () => {
    // Their offsets were assigned on the 7-minute grid and are persisted. The
    // finer grid must contain them, or every live account's posting time moves.
    const legacy = Array.from({ length: 18 }, (_, i) => i * 7);
    for (const off of legacy) expect(off % STAGGER_STEP_MIN).toBe(0);
    expect(Math.max(...legacy)).toBeLessThan(STAGGER_SLOTS * STAGGER_STEP_MIN);
    // And the next account must not be handed one of them.
    const next = enrollmentOffsets(legacy, Array.from({ length: 18 }, (_, i) => i));
    expect(legacy).not.toContain(next.staggerMin);
  });

  it("says so loudly when the offsets run out, instead of colliding in silence", () => {
    const full = Array.from({ length: STAGGER_SLOTS }, (_, i) => i * STAGGER_STEP_MIN);
    const o = enrollmentOffsets(full, full);
    expect(o.exhausted).toBe(true);
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

describe("captions", () => {
  it("hundreds of accounts on one master all get DIFFERENT captions", () => {
    expect(CAPTION_COMBOS.length).toBeGreaterThanOrEqual(400);
    for (const seq of [1, 2, 3, 7]) {
      const seen = new Set<string>();
      for (let idx = 0; idx < 300; idx++) seen.add(captionFor(seq, idx));
      expect(seen.size).toBe(300);
    }
  });

  it("one account never posts the same caption on consecutive videos", () => {
    for (let idx = 0; idx < 50; idx++) {
      for (let seq = 1; seq < 10; seq++) {
        expect(captionFor(seq, idx)).not.toBe(captionFor(seq + 1, idx));
      }
    }
  });

  it("no caption breaks the standing rules: no long dash, no curly quote, no AI spoiler", () => {
    const banned = /[–—‘’“”…]/;
    for (const c of CAPTION_COMBOS) {
      expect(banned.test(c)).toBe(false);
      // The reveal lives on the end card; a caption saying it first kills it.
      expect(/\bAI\b|artificial|generated|robot/i.test(c)).toBe(false);
      expect(c.length).toBeGreaterThan(0);
      expect(c.length).toBeLessThan(200);
    }
  });

  it("never puts two emoji in one line", () => {
    const emoji = /[\u{1F000}-\u{1FAFF}]/gu;
    for (const c of CAPTION_COMBOS) {
      const firstLine = c.split("\n")[0];
      expect((firstLine.match(emoji) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("hashtags", () => {
  it("Hugo's list, no duplicates, every tag well formed", () => {
    expect(new Set(HASHTAGS).size).toBe(HASHTAGS.length);
    for (const t of HASHTAGS) expect(t).toMatch(/^#[A-Za-z0-9]+$/);
  });

  it("always between one and four, never the same tag twice", () => {
    for (let seq = 1; seq <= 40; seq++) {
      for (let idx = 0; idx < 60; idx++) {
        const tags = hashtagsFor(seq, idx);
        expect(tags.length).toBeGreaterThanOrEqual(1);
        expect(tags.length).toBeLessThanOrEqual(MAX_HASHTAGS);
        expect(new Set(tags).size).toBe(tags.length);
        for (const t of tags) expect(HASHTAGS).toContain(t);
      }
    }
  });

  it("the count and the tags both move between accounts and between videos", () => {
    const perAccount = new Set(
      Array.from({ length: 30 }, (_, i) => hashtagsFor(3, i).join(" ")),
    );
    expect(perAccount.size).toBeGreaterThan(25);
    const counts = new Set(Array.from({ length: 60 }, (_, i) => hashtagsFor(5, i).length));
    expect(counts.size).toBeGreaterThan(1);
    // Same account, consecutive videos: a different tag block each time.
    for (let seq = 1; seq < 12; seq++) {
      expect(hashtagsFor(seq, 4).join(" ")).not.toBe(hashtagsFor(seq + 1, 4).join(" "));
    }
  });

  it("is stable: the same account and video always draw the same tags", () => {
    expect(hashtagsFor(7, 2)).toEqual(hashtagsFor(7, 2));
  });
});

describe("composeCaption", () => {
  it("machine caption plus its own tags, and no two accounts post the same text", () => {
    const seen = new Set<string>();
    for (let idx = 0; idx < 120; idx++) {
      const c = composeCaption(2, idx);
      expect(c).toContain("#");
      seen.add(c);
    }
    expect(seen.size).toBe(120);
  });

  it("Hugo's typed caption replaces the machine one but still gets tags", () => {
    const c = composeCaption(2, 0, "Look what this thing did.");
    expect(c.startsWith("Look what this thing did.")).toBe(true);
    expect(c).toContain("#");
  });

  it("a caption Hugo tagged himself is left exactly as he wrote it", () => {
    const mine = "My words #MyTag";
    expect(composeCaption(2, 0, mine)).toBe(mine);
  });

  it("never writes a long dash or a curly quote", () => {
    for (let seq = 1; seq <= 12; seq++) {
      for (let idx = 0; idx < 40; idx++) {
        expect(/[–—‘’“”…]/.test(composeCaption(seq, idx))).toBe(false);
      }
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
