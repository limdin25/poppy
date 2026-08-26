// ramp.ts: how many posts a day, decided by the calendar rather than by hand.
//
// Hugo, 26 Aug 2026: "ten videos today, second day twenty, then forty, and then
// we go for fifty... the machine is gonna start working soon without
// supervision non-stop."
//
// The dial was an environment variable I changed by hand. That is not
// unsupervised, it is me every morning, and the day I forget is the day the
// fleet posts ten instead of fifty and nobody notices. So the schedule is data:
// the cron reads the day and the step follows.
//
// PURE. No env, no clock of its own. The caller passes the day.

/** The steps, in order. Each entry is the first day it applies from. */
export interface RampStep {
  /** UTC date, YYYY-MM-DD, that this step starts on. */
  readonly from: string;
  readonly postsPerDay: number;
}

/**
 * The agreed ramp. Dates are absolute, never "day 1, day 2", because a relative
 * schedule silently restarts every time the process does.
 *
 * It ENDS at fifty and stays there. Fifty is half of Instagram's own published
 * ceiling of 100 per account per 24 hours, so even a double-scheduled day
 * cannot get an account rate limited.
 */
export const RAMP: readonly RampStep[] = [
  { from: "2026-08-26", postsPerDay: 10 },
  { from: "2026-08-27", postsPerDay: 20 },
  { from: "2026-08-28", postsPerDay: 40 },
  { from: "2026-08-29", postsPerDay: 50 },
] as const;

/** What the fleet should be doing on a given UTC day. */
export function rampFor(
  todayUtc: string,
  steps: readonly RampStep[] = RAMP,
): number {
  let current = steps[0]?.postsPerDay ?? 3;
  for (const step of steps) {
    // Plain string comparison is correct for YYYY-MM-DD and needs no Date
    // parsing, which is where timezone bugs come from.
    if (todayUtc >= step.from) current = step.postsPerDay;
  }
  return current;
}

/** The UTC day, as the ramp table spells it. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The number to use, with an override that always wins.
 *
 * The override exists for one reason: when the ramp has to STOP, it has to stop
 * within two minutes, not after a deploy. If views per post collapse, or
 * accounts start failing, setting VIDEO_POSTS_PER_DAY pins the fleet
 * immediately and the calendar is ignored until it is cleared.
 */
export function postsPerDayToday(
  now: Date,
  override: string | undefined | null,
  fromEnv: (raw: string | undefined | null) => number,
  steps: readonly RampStep[] = RAMP,
): { postsPerDay: number; source: "override" | "ramp" } {
  const text = (override ?? "").trim();
  if (text) return { postsPerDay: fromEnv(text), source: "override" };
  return { postsPerDay: rampFor(utcDay(now), steps), source: "ramp" };
}
