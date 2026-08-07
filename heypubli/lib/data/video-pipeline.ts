// The creator video pipeline's pure rules. Hugo, 07 Aug 2026: "every account
// gets two videos per day... everyone gets on the same pipeline of videos in
// sequence... every account they have their own color... it cannot be in the
// same time." Everything here is deterministic and unit-tested; the cron in
// app/api/cron/video-pipeline applies it, the Mac worker renders what it
// queues, and Hugo's approval page (/admin/videos) is the only thing that can
// let a master into the sequence.

import { timezoneForPhone } from "@/lib/data/lanes";

/** MIRROR of video/src/variants/palettes.ts FAMILY_KEYS (14 families). The
 *  factory owns the colors; this list only exists so enrolment can hand out
 *  unused ones. tests/video-pipeline verifies count and uniqueness; if the
 *  factory grows a family, add it here (the worker would accept it either
 *  way, an unknown family falls back to the seeded draw). */
export const COLOR_FAMILIES = [
  "obsidian-citrus",
  "champagne-noir",
  "molten-graphite",
  "cyber-mint",
  "sunset-foil",
  "ultraviolet",
  "ink-signal",
  "emerald-vault",
  "cobalt-glass",
  "arctic-steel",
  "blush-studio",
  "sea-glass",
  "vermilion-cut",
  "bone-ink",
] as const;

/** UI chips only: a representative hex per family so the approval page can
 *  show Hugo which color an account owns without loading the video project. */
export const FAMILY_CHIP_HEX: Record<string, string> = {
  "obsidian-citrus": "#1a1a17",
  "champagne-noir": "#181410",
  "molten-graphite": "#232323",
  "cyber-mint": "#0f1f1a",
  "sunset-foil": "#2a130d",
  "ultraviolet": "#170f2a",
  "ink-signal": "#101321",
  "emerald-vault": "#0d2018",
  "cobalt-glass": "#0e1626",
  "arctic-steel": "#e8edf2",
  "blush-studio": "#f4e4e0",
  "sea-glass": "#dfeee9",
  "vermilion-cut": "#20100c",
  "bone-ink": "#efeae0",
};

/** The two daily base slots, in the creator's OWN local time. */
export const SLOT_HOURS = [11, 19] as const;

/** Minutes between two accounts' stagger offsets. With step 7 over [0, 63)
 *  nine accounts never share a minute; past nine the offsets wrap but the
 *  variant jitter of real-world cron timing keeps exact collisions rare. */
export const STAGGER_STEP_MIN = 7;
export const STAGGER_WRAP = 9;

/** Pick the color for a new account: the first family not held by any active
 *  account, or the least-held one once all 14 are taken. Deterministic given
 *  the same inputs, so re-running enrolment cannot flap a color. */
export function pickColorFamily(taken: string[]): string {
  const counts = new Map<string, number>(COLOR_FAMILIES.map((f) => [f, 0]));
  for (const t of taken) counts.set(t, (counts.get(t) ?? 0) + 1);
  let best: string = COLOR_FAMILIES[0];
  let bestCount = Infinity;
  for (const f of COLOR_FAMILIES) {
    const c = counts.get(f) ?? 0;
    if (c < bestCount) {
      best = f;
      bestCount = c;
    }
  }
  return best;
}

/** The nth enrolled account's permanent offsets: stagger minutes added to
 *  both daily slots, and the variants factory look number. */
export function enrollmentOffsets(enrolledCount: number): {
  staggerMin: number;
  variantIdx: number;
} {
  return {
    staggerMin: (enrolledCount % STAGGER_WRAP) * STAGGER_STEP_MIN,
    variantIdx: enrolledCount,
  };
}

/** What time is it right now in this zone, as parts. */
function zoneParts(now: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour === "24" ? "0" : p.hour),
    mm: Number(p.minute),
  };
}

/** Convert a wall time in a zone to a real instant. Walks the offset in two
 *  steps, which is exact for every zone whose offset is stable across the
 *  hour in question (all of ours; the creators are IN/BD/PH/KE/US). */
function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  const seen = zoneParts(new Date(guess), timeZone);
  const seenUtc = Date.UTC(seen.y, seen.m - 1, seen.d, seen.hh, seen.mm, 0, 0);
  return new Date(guess + (guess - seenUtc));
}

export interface PostSlot {
  /** The exact instant the post goes out. */
  at: Date;
  /** 'morning' | 'evening', for the admin page. */
  slot: "morning" | "evening";
}

/**
 * The next `count` posting slots for one account, starting strictly after
 * `after`. Two a day at SLOT_HOURS local, each shifted by the account's
 * stagger minutes. Deterministic, timezone-correct, never in the past.
 */
export function nextSlots(
  after: Date,
  timeZone: string,
  staggerMin: number,
  count: number,
): PostSlot[] {
  const out: PostSlot[] = [];
  const today = zoneParts(after, timeZone);
  for (let dayOffset = 0; out.length < count && dayOffset < count + 3; dayOffset++) {
    for (let s = 0; s < SLOT_HOURS.length && out.length < count; s++) {
      const base = zonedTimeToUtc(today.y, today.m, today.d, SLOT_HOURS[s], 0, timeZone);
      const at = new Date(base.getTime() + dayOffset * 86_400_000 + staggerMin * 60_000);
      if (at.getTime() <= after.getTime()) continue;
      out.push({ at, slot: s === 0 ? "morning" : "evening" });
    }
  }
  return out;
}

/** The zone an account posts in: from their WhatsApp country, else UTC. */
export function creatorTimeZone(whatsapp: string | null | undefined): string {
  return timezoneForPhone(whatsapp) ?? "Etc/UTC";
}

/** How many pipeline posts exist for this creator inside their CURRENT local
 *  day, given the scheduled_at instants of their pipeline posts. */
export function postsInLocalDay(now: Date, timeZone: string, scheduledAts: Date[]): number {
  const today = zoneParts(now, timeZone);
  return scheduledAts.filter((at) => {
    const p = zoneParts(at, timeZone);
    return p.y === today.y && p.m === today.m && p.d === today.d;
  }).length;
}
