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

/** UI chips only: the family's real canvas colour, which is the background the
 *  phone mockup sits on, so the dot on /admin/videos is the colour Hugo will
 *  actually see in that account's videos. Taken from the factory's own
 *  PALETTE_FAMILIES anchors (gamut-clipped), not eyeballed. */
export const FAMILY_CHIP_HEX: Record<string, string> = {
  "obsidian-citrus": "#111a1d",
  "champagne-noir": "#14110d",
  "molten-graphite": "#281c18",
  "cyber-mint": "#0b3533",
  "sunset-foil": "#511d39",
  "ultraviolet": "#402168",
  "ink-signal": "#193763",
  "emerald-vault": "#0c492f",
  "cobalt-glass": "#14617a",
  "arctic-steel": "#dce6ee",
  "blush-studio": "#f7e1e9",
  "sea-glass": "#d4efe7",
  "vermilion-cut": "#f0e9e8",
  "bone-ink": "#f4f0e7",
};

/** The family's accent, the colour on the end card pill. Half of each chip, so
 *  two accounts whose backgrounds are both near-black are still telling apart
 *  at a glance. */
export const FAMILY_ACCENT_HEX: Record<string, string> = {
  "obsidian-citrus": "#adef5b",
  "champagne-noir": "#e1c792",
  "molten-graphite": "#faa680",
  "cyber-mint": "#60f4af",
  "sunset-foil": "#faa58f",
  "ultraviolet": "#fa97db",
  "ink-signal": "#8bcdfa",
  "emerald-vault": "#eabf3a",
  "cobalt-glass": "#79e3fb",
  "arctic-steel": "#95c1fa",
  "blush-studio": "#faa58f",
  "sea-glass": "#faa495",
  "vermilion-cut": "#faa495",
  "bone-ink": "#f3ae58",
};

// ---- captions ---------------------------------------------------------------
// Hugo, 08 Aug 2026: "We need the captions for every video. And every caption
// should be unique." Unique means UNIQUE PER ACCOUNT PER VIDEO: nine accounts
// posting one identical caption is exactly the clustering the per-account
// colors exist to avoid. Captions are assembled from parts (the factory's
// hooks.ts pattern), deterministic per (master seq, account look number), and
// none may hint at the AI reveal: that is the end card's job, and telling it
// early is the one thing VARIANTS.md forbids. Hugo's own caption on a master,
// when he types one, wins over all of this.

const CAPTION_OPENERS = [
  "Wait for the end.",
  "Watch till the end 👀",
  "The ending is the whole point.",
  "Stay for the last ten seconds.",
  "You will want to see how this ends.",
  "Do not scroll, the end pays off.",
  "The last part changes everything.",
  "Keep watching.",
  "Trust me, watch the whole thing.",
  "The end of this one got me.",
  "Hold on till the finish.",
  "It gets better at the end.",
] as const;

const CAPTION_CLOSERS = [
  "",
  "🔗 in bio.",
  "Everything is in the bio.",
  "More in bio.",
  "Check the bio when you are done.",
  "The link explains the rest.",
  "Bio has the rest.",
  "Answers in bio.",
] as const;

const CAPTION_MARKS = ["", " 👀", " 🤯", " 😳", " 🔥", " ✨"] as const;

function buildCaptionCombos(): string[] {
  const out: string[] = [];
  for (const opener of CAPTION_OPENERS) {
    // An opener that already carries an emoji never gets a second one.
    const marks = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(opener) ? [""] : CAPTION_MARKS;
    for (const mark of marks) {
      for (const closer of CAPTION_CLOSERS) {
        out.push(closer ? `${opener}${mark}\n\n${closer}` : `${opener}${mark}`);
      }
    }
  }
  return out;
}

export const CAPTION_COMBOS: string[] = buildCaptionCombos();

/**
 * The caption for one account's copy of one master. 131 is coprime with the
 * combo count, so within one master every look number up to that count gets a
 * DIFFERENT caption ("even if it's hundreds", Hugo), and one account never
 * repeats a caption across consecutive masters either.
 */
export function captionFor(masterSeq: number, variantIdx: number): string {
  const n = CAPTION_COMBOS.length;
  return CAPTION_COMBOS[(((variantIdx * 131 + masterSeq * 17) % n) + n) % n];
}

// ---- hashtags ---------------------------------------------------------------
// Hugo's own list, 08 Aug 2026: "include 1 to 4 hashtag per video, very random."
// Given verbatim, duplicates removed, order kept. The draw is seeded from
// (master, account) so it is reproducible, but the COUNT and the tags both move,
// which is what stops nine accounts posting one identical tag block.

export const HASHTAGS = [
  "#AI", "#ArtificialIntelligence", "#ChatGPT", "#OpenAI", "#GenerativeAI",
  "#GenAI", "#AITools", "#AIAutomation", "#MachineLearning", "#DeepLearning",
  "#LLM", "#GPT", "#Claude", "#Gemini", "#AIAgents", "#AgenticAI", "#Automation",
  "#NoCode", "#LowCode", "#Productivity", "#FutureOfWork", "#Innovation",
  "#Tech", "#Technology", "#Startup", "#SaaS", "#Entrepreneur", "#Business",
  "#Marketing", "#DigitalMarketing", "#ContentCreation", "#CreatorEconomy",
  "#PromptEngineering", "#Coding", "#Programming", "#Developer", "#Software",
  "#DataScience", "#Analytics", "#Future", "#Robotics", "#ComputerVision",
  "#NLP", "#BuildInPublic", "#IndieHacker", "#SideHustle", "#GrowthHacking",
  "#SmallBusiness", "#AIForBusiness", "#AIVideo", "#AIFilmmaking",
  "#AIAnimation", "#AICreator", "#AIFilms", "#AIArt", "#AIVFX", "#AIContent",
  "#AIReels", "#AIShorts", "#CinematicAI", "#RunwayML", "#Veo3", "#KlingAI",
  "#PikaLabs", "#LumaAI", "#Midjourney", "#HailuoAI", "#CreativeAI",
  "#FutureTech", "#UGC", "#UGCCreator", "#UGCCommunity", "#UGCContent",
  "#ContentCreator", "#VideoCreator", "#DigitalCreator", "#Influencer",
  "#MicroInfluencer", "#LifestyleCreator", "#BrandCollab", "#BrandPartnership",
  "#PaidPartnership", "#BusinessOwner", "#SocialMediaMarketing", "#Ecommerce",
  "#Shopify", "#AmazonFinds", "#ProductDemo", "#ProductReview", "#Unboxing",
] as const;

export const MAX_HASHTAGS = 4;

/** Deterministic 32-bit mix of two numbers. Not crypto, just a good scatter so
 *  neighbouring (seq, look) pairs do not draw neighbouring tags. */
function mix32(a: number, b: number): number {
  let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A repeatable 0..1 stream from a seed. */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The hashtags for one account's copy of one master: between one and four,
 * never the same tag twice in a caption, drawn from Hugo's list.
 */
export function hashtagsFor(masterSeq: number, variantIdx: number): string[] {
  const rnd = stream(mix32(masterSeq, variantIdx));
  const count = 1 + Math.floor(rnd() * MAX_HASHTAGS);
  const pool = [...HASHTAGS];
  const out: string[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return out;
}

/**
 * The exact text one account posts under one master. Hugo's typed caption wins
 * over the machine one; it still gets its own tags unless he wrote his own
 * (a "#" anywhere in what he typed means hands off completely).
 */
export function composeCaption(
  masterSeq: number,
  variantIdx: number,
  override?: string | null,
): string {
  const typed = (override ?? "").trim();
  if (typed.includes("#")) return typed;
  const body = typed || captionFor(masterSeq, variantIdx);
  return `${body}\n\n${hashtagsFor(masterSeq, variantIdx).join(" ")}`;
}

/** The two daily base slots, in the creator's OWN local time. */
export const SLOT_HOURS = [11, 19] as const;

/** Minutes between two accounts' stagger offsets, over the same [0, 126)
 *  window either side of each slot hour.
 *
 *  This was 18 offsets of 7 minutes, and there were already 18 accounts, so
 *  account 19 was handed a minute a LIVE account already held and the two
 *  posted simultaneously. Hugo, 08 Aug 2026: "it cannot be, you know, it
 *  posted the same minute, we have to fix that." VARIANTS.md makes the same
 *  point in stronger terms: identical posting behaviour across accounts
 *  clusters harder than any pixel signature, and it is the one signal no
 *  amount of visual variation can fix.
 *
 *  One-minute steps give 126 accounts their own minute. The old 7-minute
 *  offsets are all multiples of 1, so every existing account keeps exactly the
 *  time it already posts at and only new enrolments see the finer grid.
 *
 *  126 is the new ceiling. Past it, `enrollmentOffsets` reports `exhausted` so
 *  it is a visible problem rather than a silent collision, and the fix at that
 *  point is second-level offsets, which needs the column to stop being minutes. */
export const STAGGER_STEP_MIN = 1;
export const STAGGER_SLOTS = 126;

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

/** A new account's permanent offsets, computed from what LIVE accounts hold
 *  (a deleted account's slot may be reused; a live one's may not, and the
 *  look number is never reused at all so two accounts can never share a
 *  visual identity). */
export function enrollmentOffsets(
  takenStaggers: number[],
  takenVariants: number[],
): { staggerMin: number; variantIdx: number; exhausted: boolean } {
  const counts = new Map<number, number>();
  for (let i = 0; i < STAGGER_SLOTS; i++) counts.set(i * STAGGER_STEP_MIN, 0);
  for (const t of takenStaggers) counts.set(t, (counts.get(t) ?? 0) + 1);
  let staggerMin = 0;
  let best = Infinity;
  for (let i = 0; i < STAGGER_SLOTS; i++) {
    const off = i * STAGGER_STEP_MIN;
    const c = counts.get(off) ?? 0;
    if (c < best) {
      best = c;
      staggerMin = off;
    }
    if (c === 0) break;
  }
  // A free minute exists unless every one of them is already held. Saying so
  // is the whole point: the old code quietly handed out a duplicate and two
  // accounts in one timezone started posting together with nothing to show it.
  const exhausted = best > 0;
  const variantIdx = takenVariants.length ? Math.max(...takenVariants) + 1 : 0;
  return { staggerMin, variantIdx, exhausted };
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

/**
 * The slots still remaining in the account's CURRENT local day. This is what
 * the scheduler fills from: review proved that filling "until 2 today" from
 * slots that may land on FUTURE days marches the sequence weeks ahead (each
 * 15-minute run adds two more tomorrow-or-later posts while today's count
 * never moves). Filling only today's remaining slots is self-limiting: at
 * most two per day, an account enrolled at noon gets one today and the full
 * two from tomorrow.
 */
export function todaySlots(now: Date, timeZone: string, staggerMin: number): PostSlot[] {
  const today = zoneParts(now, timeZone);
  return nextSlots(now, timeZone, staggerMin, 2).filter((s) => {
    const p = zoneParts(s.at, timeZone);
    return p.y === today.y && p.m === today.m && p.d === today.d;
  });
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
