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
  POSTS_PER_DAY,
  DEFAULT_POSTS_PER_DAY,
  MAX_POSTS_PER_DAY,
  DAY_WINDOW_START_MIN,
  DAY_WINDOW_END_MIN,
  dailySlotMinutes,
  postsPerDayFromEnv,
  staggerSecondsFor,
  GEO_PACKS,
  geoPackFor,
  tagsFor,
  masterIndexForCursor,
  libraryLapsCompleted,
  rotationSlots,
  todaySlots,
  todaySlotsWithKickoff,
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

describe("the ramp dial", () => {
  // Hugo, 26 Aug 2026: "ten videos today, second day twenty, then forty, and
  // then we go for fifty." The slots are derived from that number, so the ramp
  // never needs a code change.
  it("holds at three until something says otherwise", () => {
    expect(POSTS_PER_DAY).toBe(3);
    expect(DEFAULT_POSTS_PER_DAY).toBe(3);
    expect(dailySlotMinutes(DEFAULT_POSTS_PER_DAY).length).toBe(3);
  });

  it("gives every step of the ramp exactly that many slots", () => {
    for (const n of [10, 20, 40, 50]) {
      expect(dailySlotMinutes(n).length).toBe(n);
    }
  });

  it("never schedules while the audience is asleep", () => {
    for (const n of [1, 3, 10, 50]) {
      for (const m of dailySlotMinutes(n)) {
        expect(m).toBeGreaterThanOrEqual(DAY_WINDOW_START_MIN);
        expect(m).toBeLessThan(DAY_WINDOW_END_MIN);
      }
    }
  });

  it("spreads them evenly and never puts two on the same minute", () => {
    const m = dailySlotMinutes(50);
    expect(new Set(m).size).toBe(50);
    const gaps = m.slice(1).map((x, i) => x - m[i]);
    // fifty posts across a fifteen hour window is eighteen minutes apart
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(17);
  });

  it("refuses to go past Instagram's own ceiling, whatever it is asked for", () => {
    // Meta allows 100 published posts per account per 24 hours. Fifty is half.
    expect(MAX_POSTS_PER_DAY).toBe(50);
    expect(dailySlotMinutes(500).length).toBe(MAX_POSTS_PER_DAY);
    expect(postsPerDayFromEnv("999")).toBe(MAX_POSTS_PER_DAY);
  });

  it("a bad dial setting slows the machine down, it never stops it", () => {
    expect(postsPerDayFromEnv(undefined)).toBe(DEFAULT_POSTS_PER_DAY);
    expect(postsPerDayFromEnv("")).toBe(DEFAULT_POSTS_PER_DAY);
    expect(postsPerDayFromEnv("banana")).toBe(DEFAULT_POSTS_PER_DAY);
    expect(postsPerDayFromEnv("0")).toBe(1);
    expect(postsPerDayFromEnv("-5")).toBe(1);
    expect(postsPerDayFromEnv("10")).toBe(10);
    expect(postsPerDayFromEnv("20.7")).toBe(20);
  });
});

describe("two accounts never post at the same instant", () => {
  // At fifty a day across 74 accounts the machine emits about two and a half
  // posts a minute, so the old minute-only grid collided constantly.
  it("gives 60 consecutive accounts 60 different seconds", () => {
    const secs = Array.from({ length: 60 }, (_, i) => staggerSecondsFor(i));
    expect(new Set(secs).size).toBe(60);
    for (const s of secs) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(60);
    }
  });

  it("puts the seconds on the wire, not just in the offset table", () => {
    const at = new Date("2026-08-08T00:30:00Z");
    const a = todaySlots(at, "Asia/Kolkata", 5, 10, staggerSecondsFor(0));
    const b = todaySlots(at, "Asia/Kolkata", 5, 10, staggerSecondsFor(1));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].at.getTime()).not.toBe(b[i].at.getTime());
    }
  });
});

describe("todaySlots", () => {
  it("returns only slots landing on the account's current local day", () => {
    // 06:00 UTC = 11:30 IST. At three a day the slots are 08:00, 13:00, 18:00,
    // so the first is gone and two remain.
    const slots = todaySlots(new Date("2026-08-08T06:00:00Z"), "Asia/Kolkata", 0);
    expect(slots.map((s) => s.slot)).toEqual(["s02", "s03"]);
  });

  it("after the last slot has passed it returns NOTHING, never tomorrow", () => {
    // 18:00 UTC = 23:30 IST: past the end of the window.
    const slots = todaySlots(new Date("2026-08-08T18:00:00Z"), "Asia/Kolkata", 0);
    expect(slots).toEqual([]);
  });

  it("early morning returns all of today's slots, at any ramp step", () => {
    const dawn = new Date("2026-08-08T00:30:00Z"); // 06:00 IST
    expect(todaySlots(dawn, "Asia/Kolkata", 21).length).toBe(3);
    expect(todaySlots(dawn, "Asia/Kolkata", 21, 10).length).toBe(10);
    expect(todaySlots(dawn, "Asia/Kolkata", 21, 50).length).toBe(50);
  });

  it("a day at fifty never puts two of one account's posts together", () => {
    const dawn = new Date("2026-08-08T00:30:00Z");
    const slots = todaySlots(dawn, "Asia/Kolkata", 7, 50, staggerSecondsFor(3));
    const times = slots.map((s) => s.at.getTime());
    expect(new Set(times).size).toBe(times.length);
  });
});

describe("rotation fill", () => {
  // Hugo, 26 Aug 2026: "it doesn't matter when we post, it just keep posting."
  // The fixed grid threw away the part of the day that had already gone, so an
  // account whose early clock slots were past could never reach the number on
  // the dial.
  const morning = new Date("2026-08-26T03:00:00Z"); // 08:30 IST, day ahead
  const afternoon = new Date("2026-08-26T11:00:00Z"); // 16:30 IST, half gone

  it("gives the FULL quota even when most of the day is gone", () => {
    expect(rotationSlots(afternoon, "Asia/Kolkata", 10).length).toBe(10);
    expect(rotationSlots(afternoon, "Asia/Kolkata", 50).length).toBe(50);
  });

  it("never schedules anything in the past", () => {
    for (const at of [morning, afternoon]) {
      for (const s of rotationSlots(at, "Asia/Kolkata", 20)) {
        expect(s.at.getTime()).toBeGreaterThan(at.getTime());
      }
    }
  });

  it("spreads them out instead of firing them all at once", () => {
    const slots = rotationSlots(morning, "Asia/Kolkata", 10);
    const gaps = slots.slice(1).map((s, i) => s.at.getTime() - slots[i].at.getTime());
    for (const g of gaps) expect(g).toBeGreaterThan(60_000);
    expect(new Set(slots.map((s) => s.at.getTime())).size).toBe(slots.length);
  });

  it("still posts when the window has already closed, rather than nothing", () => {
    // 23:10 IST: past the end of the posting window entirely.
    const late = new Date("2026-08-26T17:40:00Z");
    const slots = rotationSlots(late, "Asia/Kolkata", 5);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.at.getTime()).toBeGreaterThan(late.getTime());
  });

  it("keeps two accounts off the same instant", () => {
    const a = rotationSlots(afternoon, "Asia/Kolkata", 10, staggerSecondsFor(0));
    const b = rotationSlots(afternoon, "Asia/Kolkata", 10, staggerSecondsFor(1));
    for (let i = 0; i < a.length; i++) {
      expect(a[i].at.getTime()).not.toBe(b[i].at.getTime());
    }
  });

  it("asks for nothing when there is nothing left to give", () => {
    expect(rotationSlots(afternoon, "Asia/Kolkata", 0)).toEqual([]);
    expect(rotationSlots(afternoon, "Asia/Kolkata", -3)).toEqual([]);
  });
});

describe("the library is a ring, not a line", () => {
  // THE 15 AUGUST FAILURE. The sequence ran 1..9 and then off the end. 94 of
  // 108 accounts sat at seq 10 with no master 10 to play, the conductor found
  // nothing, and the machine went silent for eleven days with no error
  // anywhere. Not broken. Out of material, and nothing said so.
  it("wraps instead of running off the end", () => {
    expect(masterIndexForCursor(1, 9)).toBe(0);
    expect(masterIndexForCursor(9, 9)).toBe(8);
    // this is the one that used to return nothing at all
    expect(masterIndexForCursor(10, 9)).toBe(0);
    expect(masterIndexForCursor(11, 9)).toBe(1);
    expect(masterIndexForCursor(19, 9)).toBe(0);
  });

  it("never returns nothing while a single master is approved", () => {
    for (let seq = 1; seq <= 500; seq++) {
      expect(masterIndexForCursor(seq, 1)).toBe(0);
      const i = masterIndexForCursor(seq, 9);
      expect(i).not.toBeNull();
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(9);
    }
  });

  it("plays every master once before it plays any master twice", () => {
    const seen = new Set<number>();
    for (let seq = 1; seq <= 9; seq++) seen.add(masterIndexForCursor(seq, 9)!);
    expect(seen.size).toBe(9);
  });

  it("says so when there is nothing approved, rather than guessing", () => {
    expect(masterIndexForCursor(1, 0)).toBeNull();
    expect(masterIndexForCursor(50, 0)).toBeNull();
  });

  it("counts the laps, which is the only figure showing how hard footage repeats", () => {
    expect(libraryLapsCompleted(1, 9)).toBe(0);
    expect(libraryLapsCompleted(9, 9)).toBe(0);
    expect(libraryLapsCompleted(10, 9)).toBe(1);
    expect(libraryLapsCompleted(28, 9)).toBe(3);
    // at ten a day on nine masters an account laps the library every day
    expect(libraryLapsCompleted(1 + 10 * 7, 9)).toBe(7);
    expect(libraryLapsCompleted(5, 0)).toBe(0);
  });
});

describe("geo packs", () => {
  // Hugo, 26 Aug 2026: one account always Manchester, another always North
  // Carolina, so 74 accounts stop looking like one network.
  it("every pack names a place and carries usable tags", () => {
    expect(GEO_PACKS.length).toBeGreaterThanOrEqual(40);
    for (const p of GEO_PACKS) {
      expect(p.place.length).toBeGreaterThan(2);
      expect(p.tags.length).toBe(2);
      for (const t of p.tags) expect(t).toMatch(/^#[A-Za-z0-9]+$/);
    }
  });

  it("no two accounts inside one wrap share a place", () => {
    const places = GEO_PACKS.map((p) => p.place);
    expect(new Set(places).size).toBe(places.length);
    const tags = GEO_PACKS.flatMap((p) => p.tags);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("an account's place NEVER changes", () => {
    for (const idx of [0, 1, 7, 39, 40, 113]) {
      expect(geoPackFor(idx).place).toBe(geoPackFor(idx).place);
    }
    // and it wraps rather than falling off the end
    expect(geoPackFor(GEO_PACKS.length).place).toBe(GEO_PACKS[0].place);
    expect(geoPackFor(0).place).toBe("Manchester");
  });

  it("the place tags are on EVERY post, never dropped for a general tag", () => {
    for (let seq = 1; seq <= 12; seq++) {
      for (let idx = 0; idx < 6; idx++) {
        const tags = tagsFor(seq, idx);
        for (const t of geoPackFor(idx).tags) expect(tags).toContain(t);
        expect(tags.length).toBeLessThanOrEqual(MAX_HASHTAGS);
        expect(new Set(tags).size).toBe(tags.length);
      }
    }
  });

  it("shows up in the caption the account actually posts", () => {
    const caption = composeCaption(3, 0);
    expect(caption).toContain("#Manchester");
  });
});

describe("todaySlotsWithKickoff", () => {
  // Hugo, 09 Aug 2026: "as soon as the user connects... within five minutes we
  // should post the first video, and then it gets on the queue for the day."
  const dawn = new Date("2026-08-08T00:30:00Z"); // 06:00 IST, before every slot

  it("an account that has never posted goes out RIGHT NOW", () => {
    const slots = todaySlotsWithKickoff(dawn, "Asia/Kolkata", 21, true);
    expect(slots[0].slot).toBe("now");
    expect(slots[0].at.getTime()).toBe(dawn.getTime());
  });

  it("day one is still three videos, not four", () => {
    const slots = todaySlotsWithKickoff(dawn, "Asia/Kolkata", 21, true);
    expect(slots.length).toBe(POSTS_PER_DAY);
    // The kickoff REPLACES the next clock slot, so an account connecting five
    // minutes before its first slot does not post twice inside five minutes.
    expect(slots.map((s) => s.slot)).toEqual(["now", "s02", "s03"]);
  });

  it("connecting after the last slot still posts tonight, not tomorrow", () => {
    const late = new Date("2026-08-08T18:00:00Z"); // 23:30 IST, every slot gone
    const slots = todaySlotsWithKickoff(late, "Asia/Kolkata", 0, true);
    expect(slots.map((s) => s.slot)).toEqual(["now"]);
    expect(slots[0].at.getTime()).toBe(late.getTime());
  });

  it("an account that has posted before is left on the clock", () => {
    const now = new Date("2026-08-08T06:00:00Z");
    expect(todaySlotsWithKickoff(now, "Asia/Kolkata", 0, false)).toEqual(
      todaySlots(now, "Asia/Kolkata", 0),
    );
  });
});

describe("nextSlots", () => {
  // 06:00 UTC = 11:30 in India (UTC+5:30). At three a day the slots are 08:00,
  // 13:00 and 18:00 local, so the first is already past.
  it("skips a slot already past in the creator's own day", () => {
    const after = new Date("2026-08-08T06:00:00Z");
    const slots = nextSlots(after, "Asia/Kolkata", 0, 3);
    expect(slots[0].slot).toBe("s02");
    // 13:00 IST = 07:30 UTC
    expect(slots[0].at.toISOString()).toBe("2026-08-08T07:30:00.000Z");
    expect(slots[1].slot).toBe("s03");
    // 18:00 IST = 12:30 UTC
    expect(slots[1].at.toISOString()).toBe("2026-08-08T12:30:00.000Z");
    // and then round to tomorrow's first, 08:00 IST = 02:30 UTC
    expect(slots[2].slot).toBe("s01");
    expect(slots[2].at.toISOString()).toBe("2026-08-09T02:30:00.000Z");
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
