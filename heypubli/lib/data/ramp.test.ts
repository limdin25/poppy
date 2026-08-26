import { describe, expect, it } from "vitest";
import { RAMP, rampFor, utcDay, postsPerDayToday } from "./ramp";
import { postsPerDayFromEnv, MAX_POSTS_PER_DAY } from "./video-pipeline";

describe("the ramp table", () => {
  it("is the schedule Hugo agreed, in order, ending at fifty", () => {
    expect(RAMP.map((s) => s.postsPerDay)).toEqual([10, 20, 40, 50]);
    const dates = RAMP.map((s) => s.from);
    expect([...dates].sort()).toEqual(dates);
    expect(RAMP[RAMP.length - 1].postsPerDay).toBe(MAX_POSTS_PER_DAY);
  });

  it("gives each day its step", () => {
    expect(rampFor("2026-08-26")).toBe(10);
    expect(rampFor("2026-08-27")).toBe(20);
    expect(rampFor("2026-08-28")).toBe(40);
    expect(rampFor("2026-08-29")).toBe(50);
  });

  it("STAYS at fifty forever rather than falling off the end", () => {
    // A ramp that ran out and reverted to the default would quietly drop the
    // whole fleet to three a day on the fifth morning.
    for (const d of ["2026-08-30", "2026-09-15", "2027-01-01"]) {
      expect(rampFor(d)).toBe(50);
    }
  });

  it("holds the first step for anything before it starts", () => {
    expect(rampFor("2026-08-25")).toBe(10);
    expect(rampFor("2020-01-01")).toBe(10);
  });

  it("reads the day the same way the table writes it", () => {
    expect(utcDay(new Date("2026-08-27T23:59:59Z"))).toBe("2026-08-27");
    expect(utcDay(new Date("2026-08-28T00:00:01Z"))).toBe("2026-08-28");
  });
});

describe("postsPerDayToday", () => {
  const at = (iso: string) => new Date(iso);

  it("follows the calendar when nothing is pinned", () => {
    const r = postsPerDayToday(at("2026-08-28T09:00:00Z"), undefined, postsPerDayFromEnv);
    expect(r).toEqual({ postsPerDay: 40, source: "ramp" });
  });

  it("treats an empty env var as not pinned", () => {
    // Vercel hands back "" for a cleared value, and an empty string that counted
    // as a pin would freeze the ramp at whatever it parsed to.
    for (const blank of ["", "   ", undefined, null]) {
      expect(postsPerDayToday(at("2026-08-29T09:00:00Z"), blank, postsPerDayFromEnv).source)
        .toBe("ramp");
    }
  });

  // The stop button. If reach collapses or accounts start failing, this pins
  // the fleet within two minutes instead of after a deploy.
  it("lets an override win immediately, and says that is what happened", () => {
    const r = postsPerDayToday(at("2026-08-29T09:00:00Z"), "5", postsPerDayFromEnv);
    expect(r).toEqual({ postsPerDay: 5, source: "override" });
  });

  it("an override is still bounded by the hard ceiling", () => {
    expect(postsPerDayToday(at("2026-08-29T09:00:00Z"), "9000", postsPerDayFromEnv).postsPerDay)
      .toBe(MAX_POSTS_PER_DAY);
    expect(postsPerDayToday(at("2026-08-29T09:00:00Z"), "0", postsPerDayFromEnv).postsPerDay)
      .toBe(1);
  });

  it("never returns something the scheduler cannot use", () => {
    for (const d of ["2026-08-26", "2026-08-27", "2026-08-28", "2026-09-30"]) {
      const n = rampFor(d);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(MAX_POSTS_PER_DAY);
    }
  });
});
