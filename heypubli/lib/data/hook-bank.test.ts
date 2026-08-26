import { describe, expect, it } from "vitest";
import {
  BEAT_KEYS,
  MAX_LINE_CHARS,
  MAX_LINES_PER_BEAT,
  bankHeadroom,
  hookKey,
  parseHookBatch,
  pickHook,
  validateHook,
  type BankHook,
  type Hook,
} from "./hook-bank";

const good: Hook = {
  beat1: "Nobody wants\nto say this",
  beat2: "Watch her\nfor five seconds",
  beat3: "Then tell me\nwhat is wrong",
};

describe("validateHook", () => {
  it("passes a hook shaped the way the renderer expects", () => {
    expect(validateHook(good)).toEqual({ ok: true, faults: [] });
  });

  it("needs all three beats", () => {
    expect(validateHook({ beat1: "a", beat2: "b" }).faults).toContain("not-three-beats");
    expect(validateHook({ ...good, beat3: "   " }).faults).toContain("not-three-beats");
  });

  it("rejects a beat that would wrap to a third line", () => {
    const long = "x".repeat(MAX_LINE_CHARS + 1);
    expect(validateHook({ ...good, beat2: long }).faults).toContain("line-too-long");
  });

  it("rejects more lines than the layout was designed for", () => {
    const many = Array.from({ length: MAX_LINES_PER_BEAT + 1 }, () => "ok").join("\n");
    expect(validateHook({ ...good, beat1: many }).faults).toContain("too-many-lines");
  });

  it("rejects the punctuation this codebase never uses", () => {
    // Hugo, 27 Jul 2026: no long dashes ever, anywhere.
    for (const bad of ["a — b", "a – b", "it’s here", "“quoted”", "wait…"]) {
      expect(validateHook({ ...good, beat1: bad }).faults).toContain("banned-punctuation");
    }
  });

  // THE IMPORTANT ONE. The end card is the only place the video says it is AI.
  // A hook that says it first destroys the thing every other line is holding
  // the viewer for.
  it("rejects anything that gives the ending away", () => {
    const spoilers = [
      "This is AI",
      "Nobody filmed this",
      "She is not real",
      "Made with a camera",
      "It was generated",
      "This is fake",
      "A robot did this",
    ];
    for (const s of spoilers) {
      const check = validateHook({ ...good, beat1: s });
      expect(check.faults, `"${s}" should have been rejected`).toContain(
        "reveals-the-ending",
      );
    }
  });

  it("does not reject ordinary language that merely contains those letters", () => {
    // A substring test rejected most usable English: "said" contains ai,
    // "flair" contains air, "software" was fine but "soft" was not the issue.
    for (const fine of ["She said nothing", "Look at her flair", "Wait for the promise"]) {
      const check = validateHook({ ...good, beat1: fine });
      expect(check.faults, `"${fine}" should have passed`).not.toContain(
        "reveals-the-ending",
      );
    }
  });

  it("reports every fault at once, not the first one it meets", () => {
    const check = validateHook({
      beat1: "This is AI — " + "x".repeat(MAX_LINE_CHARS),
      beat2: "ok",
      beat3: "ok",
    });
    expect(check.faults).toContain("reveals-the-ending");
    expect(check.faults).toContain("banned-punctuation");
    expect(check.faults).toContain("line-too-long");
  });
});

describe("parseHookBatch", () => {
  const raw = [
    "Nobody wants | to say this / Watch her | for five seconds / Then tell me | what is wrong",
    "- The influencer era | is already over / And almost nobody | has noticed / Watch this | to the end",
    "this line has no separators at all",
    "This is AI / so it / gets dropped",
    "Nobody wants | to say this / Watch her | for five seconds / Then tell me | what is wrong",
  ].join("\n");

  it("reads the hooks it can and silently drops the rest", () => {
    const hooks = parseHookBatch(raw);
    expect(hooks.length).toBe(2);
    expect(hooks[0].beat1).toBe("Nobody wants\nto say this");
    expect(hooks[1].beat3).toBe("Watch this\nto the end");
  });

  it("never lets a spoiler through, however well formatted", () => {
    expect(parseHookBatch("This is AI / all of it / watch")).toEqual([]);
  });

  it("drops a repeat inside the same batch", () => {
    // the raw above ends with a duplicate of its first line
    expect(parseHookBatch(raw).length).toBe(2);
  });

  it("survives an empty or junk response instead of throwing", () => {
    expect(parseHookBatch("")).toEqual([]);
    expect(parseHookBatch("I'm sorry, I can't help with that.")).toEqual([]);
  });
});

describe("hookKey", () => {
  it("treats case and spacing as the same hook", () => {
    expect(hookKey(good)).toBe(
      hookKey({
        beat1: "NOBODY WANTS\n  to say this",
        beat2: "Watch her\nfor five seconds",
        beat3: "Then tell me\nwhat is wrong",
      }),
    );
  });
});

describe("pickHook", () => {
  const bank: BankHook[] = ["a", "b", "c"].map((id) => ({ id, ...good }));

  it("gives an account something it has not used", () => {
    expect(pickHook(bank, new Set(["a"]))?.id).toBe("b");
    expect(pickHook(bank, new Set(["a", "b"]))?.id).toBe("c");
  });

  // The reason this is oldest-first and not random: a random draw repeats by
  // the birthday problem long before the bank runs out, so an account would see
  // the same opening twice while hundreds of lines sat unused.
  it("uses EVERY line once before it uses any line twice", () => {
    const big: BankHook[] = Array.from({ length: 200 }, (_, i) => ({
      id: `h${i}`,
      ...good,
    }));
    const used = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const h = pickHook(big, used);
      expect(h, `ran out at draw ${i}`).not.toBeNull();
      expect(used.has(h!.id)).toBe(false);
      used.add(h!.id);
    }
    expect(used.size).toBe(200);
  });

  // The live failure, 26 Aug 2026: four of six posts built in one minute
  // carried the same opening, because every account walked the bank from row
  // one in lockstep.
  it("starts each account somewhere else in the bank", () => {
    const big: BankHook[] = Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, ...good }));
    const firsts = [0, 7, 19, 33].map((off) => pickHook(big, new Set(), off)?.id);
    expect(new Set(firsts).size).toBe(4);
    expect(pickHook(big, new Set(), 7)?.id).toBe("h7");
  });

  it("wraps past the end rather than falling off it", () => {
    const three: BankHook[] = ["a", "b", "c"].map((id) => ({ id, ...good }));
    expect(pickHook(three, new Set(), 5)?.id).toBe("c");
    expect(pickHook(three, new Set(["c"]), 5)?.id).toBe("a");
  });

  it("still uses every line once before any line twice, from any start", () => {
    const big: BankHook[] = Array.from({ length: 40 }, (_, i) => ({ id: `h${i}`, ...good }));
    const used = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const h = pickHook(big, used, 13);
      expect(h).not.toBeNull();
      expect(used.has(h!.id)).toBe(false);
      used.add(h!.id);
    }
    expect(used.size).toBe(40);
  });

  it("says so when the account has used everything, rather than repeating", () => {
    expect(pickHook(bank, new Set(["a", "b", "c"]))).toBeNull();
    expect(pickHook([], new Set())).toBeNull();
  });
});

describe("bankHeadroom", () => {
  it("counts from the account that has used the most, not the average", () => {
    expect(bankHeadroom(500, 120)).toBe(380);
    expect(bankHeadroom(100, 100)).toBe(0);
    expect(bankHeadroom(100, 140)).toBe(0);
  });
});

describe("the shape the renderer relies on", () => {
  it("is three beats, in order", () => {
    expect(BEAT_KEYS).toEqual(["beat1", "beat2", "beat3"]);
  });
});
