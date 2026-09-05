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
  return `${body}\n\n${tagsFor(masterSeq, variantIdx).join(" ")}`;
}

/**
 * The tag block one account puts under one master: its two permanent place tags
 * first, then whatever room is left filled from the general pool.
 *
 * The place tags come FIRST and are never dropped. They are the only part of
 * the block that says anything about this account specifically, and an account
 * whose location tag appears on some posts and not others is not anchored to a
 * place at all, which was the entire point of having one.
 */
export function tagsFor(masterSeq: number, variantIdx: number): string[] {
  const geo = geoPackFor(variantIdx).tags;
  const room = Math.max(0, MAX_HASHTAGS - geo.length);
  const general = hashtagsFor(masterSeq, variantIdx)
    .filter((t) => !geo.includes(t))
    .slice(0, room);
  return [...geo, ...general];
}

/** The window a creator posts inside, in their OWN local time.
 *
 *  This replaced three hardcoded hours (11:00, 15:00, 19:00). Hugo, 26 Aug
 *  2026: the ramp goes 10 a day, then 20, then 40, then 50, and a list of
 *  literal hours cannot carry fifty of anything. So the slots are DERIVED from
 *  the count instead: spread evenly across the waking window, which is the only
 *  rule that holds at 3 and at 50 alike.
 *
 *  08:00 to 23:00 is fifteen hours. At three a day that is a five hour gap; at
 *  fifty it is eighteen minutes. Nobody posts while their audience is asleep,
 *  which is the one thing the old hours got right and this keeps. */
export const DAY_WINDOW_START_MIN = 8 * 60;
export const DAY_WINDOW_END_MIN = 23 * 60;

/** Instagram's own publishing ceiling is 100 per account per 24 hours
 *  (Content Publishing API). Fifty is Hugo's cap and half of theirs, so a
 *  double-scheduled day still cannot get an account rate limited. */
export const MAX_POSTS_PER_DAY = 50;

/** What the ramp starts at when nothing says otherwise. */
export const DEFAULT_POSTS_PER_DAY = 3;

/** Back-compat: the old constant, still the default the cron falls back to. */
export const POSTS_PER_DAY = DEFAULT_POSTS_PER_DAY;

/**
 * The ramp dial. Hugo moves 10 -> 20 -> 40 -> 50 by changing one environment
 * variable, never by a code change, because a deploy in the middle of a ramp is
 * how you lose a day. Anything unparseable, out of range or absent falls back
 * to the safe default rather than throwing: a bad value must slow the machine
 * down, never stop it.
 */
export function postsPerDayFromEnv(raw: string | undefined | null): number {
  // An env var that EXISTS but is empty is what Vercel hands back when the
  // value is cleared, and Number("") is 0, not NaN. Left to the numeric path
  // that clamps to 1 and the whole fleet quietly drops to one post a day.
  const text = (raw ?? "").trim();
  if (!text) return DEFAULT_POSTS_PER_DAY;
  const n = Number(text);
  if (!Number.isFinite(n)) return DEFAULT_POSTS_PER_DAY;
  return Math.min(MAX_POSTS_PER_DAY, Math.max(1, Math.floor(n)));
}

/**
 * The minute-of-day each of today's slots lands on, evenly spread across the
 * waking window. The first slot is at the start of the window and the last one
 * strictly inside it, so a slot can never spill into the small hours.
 */
export function dailySlotMinutes(postsPerDay: number): number[] {
  const n = Math.min(MAX_POSTS_PER_DAY, Math.max(1, Math.floor(postsPerDay)));
  const span = DAY_WINDOW_END_MIN - DAY_WINDOW_START_MIN;
  if (n === 1) return [DAY_WINDOW_START_MIN + Math.round(span / 2)];
  const step = span / n;
  return Array.from({ length: n }, (_, i) =>
    Math.round(DAY_WINDOW_START_MIN + i * step),
  );
}

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

/**
 * The SECOND-level half of the offset, which the minute grid on its own can no
 * longer cover.
 *
 * At three posts a day, 126 minutes was plenty. At fifty a day across 74
 * accounts the machine emits 3,700 posts a day, about two and a half every
 * minute, so accounts sharing a minute stopped being an edge case and became
 * the normal state. The file already flagged this as the next thing to fix and
 * said what the fix was: stop measuring in minutes.
 *
 * The account's permanent look number picks its second, scattered rather than
 * sequential so neighbouring enrolments do not land a second apart. 126 minutes
 * x 60 seconds is 7,560 distinct instants, which is two orders of magnitude
 * more accounts than exist.
 */
export function staggerSecondsFor(variantIdx: number): number {
  // 37 is coprime with 60, so consecutive look numbers walk the whole minute
  // before any second is reused.
  return (((variantIdx * 37) % 60) + 60) % 60;
}

// ---- geo packs ---------------------------------------------------------------
// Hugo, 26 Aug 2026: "one account always Manchester, Manchester life, another
// account always North Carolina." One place per account, permanent, so an
// account reads as a local page rather than as one of 74 identical AI feeds.
//
// TWO HONEST LIMITS, written down so nobody expects more of this than it gives.
// Hashtags are a weak location signal on Reels; the algorithm mostly goes on
// who actually watches. And Outstand's API carries no location field, so a real
// Instagram place tag, which WOULD be a strong signal, is not available to us.
// What this does buy is differentiation: 74 accounts all posting #AI look like
// one network, and that is the risk this is really paid to reduce.

export interface GeoPack {
  /** Shown in the admin list, and usable in caption copy. */
  readonly place: string;
  /** Always applied, in full, to every post from the account that holds it. */
  readonly tags: readonly string[];
}

export const GEO_PACKS: readonly GeoPack[] = [
  { place: "Manchester", tags: ["#Manchester", "#ManchesterLife"] },
  { place: "London", tags: ["#London", "#LondonLife"] },
  { place: "Birmingham", tags: ["#Birmingham", "#BrumLife"] },
  { place: "Leeds", tags: ["#Leeds", "#LeedsLife"] },
  { place: "Glasgow", tags: ["#Glasgow", "#GlasgowLife"] },
  { place: "Liverpool", tags: ["#Liverpool", "#LiverpoolLife"] },
  { place: "Bristol", tags: ["#Bristol", "#BristolLife"] },
  { place: "Newcastle", tags: ["#Newcastle", "#NewcastleLife"] },
  { place: "Dublin", tags: ["#Dublin", "#DublinLife"] },
  { place: "North Carolina", tags: ["#NorthCarolina", "#NCLife"] },
  { place: "Texas", tags: ["#Texas", "#TexasLife"] },
  { place: "Florida", tags: ["#Florida", "#FloridaLife"] },
  { place: "California", tags: ["#California", "#CaliforniaLife"] },
  { place: "Georgia", tags: ["#Georgia", "#AtlantaLife"] },
  { place: "Ohio", tags: ["#Ohio", "#OhioLife"] },
  { place: "Arizona", tags: ["#Arizona", "#PhoenixLife"] },
  { place: "Michigan", tags: ["#Michigan", "#DetroitLife"] },
  { place: "Colorado", tags: ["#Colorado", "#DenverLife"] },
  { place: "New Jersey", tags: ["#NewJersey", "#JerseyLife"] },
  { place: "Illinois", tags: ["#Illinois", "#ChicagoLife"] },
  { place: "Washington", tags: ["#Washington", "#SeattleLife"] },
  { place: "Tennessee", tags: ["#Tennessee", "#NashvilleLife"] },
  { place: "Nevada", tags: ["#Nevada", "#VegasLife"] },
  { place: "Toronto", tags: ["#Toronto", "#TorontoLife"] },
  { place: "Vancouver", tags: ["#Vancouver", "#VancouverLife"] },
  { place: "Calgary", tags: ["#Calgary", "#CalgaryLife"] },
  { place: "Sydney", tags: ["#Sydney", "#SydneyLife"] },
  { place: "Melbourne", tags: ["#Melbourne", "#MelbourneLife"] },
  { place: "Brisbane", tags: ["#Brisbane", "#BrisbaneLife"] },
  { place: "Perth", tags: ["#Perth", "#PerthLife"] },
  { place: "Auckland", tags: ["#Auckland", "#AucklandLife"] },
  { place: "Dubai", tags: ["#Dubai", "#DubaiLife"] },
  { place: "Singapore", tags: ["#Singapore", "#SingaporeLife"] },
  { place: "Manila", tags: ["#Manila", "#ManilaLife"] },
  { place: "Cebu", tags: ["#Cebu", "#CebuLife"] },
  { place: "Nairobi", tags: ["#Nairobi", "#NairobiLife"] },
  { place: "Lagos", tags: ["#Lagos", "#LagosLife"] },
  { place: "Mumbai", tags: ["#Mumbai", "#MumbaiLife"] },
  { place: "Delhi", tags: ["#Delhi", "#DelhiLife"] },
  { place: "Dhaka", tags: ["#Dhaka", "#DhakaLife"] },
] as const;

/**
 * The pack an account holds, forever, from its permanent look number. Wraps
 * once there are more accounts than places, which only costs two accounts the
 * same city and never costs anyone a changing one. A pack that MOVED would be
 * worse than no pack at all: the whole point is that this account is always
 * that place.
 */
export function geoPackFor(variantIdx: number): GeoPack {
  const n = GEO_PACKS.length;
  return GEO_PACKS[(((variantIdx % n) + n) % n)];
}

/**
 * WHICH MASTER AN ACCOUNT PLAYS NEXT, and the reason this function exists.
 *
 * The sequence used to be a straight line: play master 1, then 2, then 9, then
 * nothing, forever. On 15 Aug 2026 that is exactly what happened. 94 of 108
 * accounts reached seq 10, there is no master 10, the conductor found nothing
 * and broke out of the loop, and the whole machine went quiet for eleven days
 * without a single error anywhere. It was not broken. It had run out of
 * material, and nothing said so.
 *
 * Hugo, 26 Aug 2026: "we're gonna be reusing the nine master clips in circles."
 * So the line becomes a ring. Position 10 of a 9-master library is master 1
 * again, and an account never runs dry.
 *
 * It matters that this WRAPS rather than resetting to 1 when it runs out: each
 * account's cursor keeps climbing forever, which is what keeps the openings,
 * the captions and the end cards moving even while the body repeats.
 *
 * Returns a 0-based index into the approved list, or null when there are no
 * approved masters at all, which is a real state and the caller's to handle.
 */
export function masterIndexForCursor(
  nextSeq: number,
  approvedCount: number,
): number | null {
  if (approvedCount <= 0) return null;
  const from0 = Math.max(0, Math.floor(nextSeq) - 1);
  return from0 % approvedCount;
}

/**
 * The next position in the ring whose body is actually BUILT.
 *
 * The scheduler used to stop the moment the master at the cursor had no ready
 * render, which sounds cautious and is not. 26 Aug 2026: 928 finished bodies
 * were sitting on disk and not one account could post, because every cursor
 * happened to be parked on the one master approved ten minutes earlier and
 * still in the render queue. One unbuilt video held up the whole fleet.
 *
 * Walking forward costs nothing. A master skipped now is not lost, the ring
 * brings it back round on the next lap, by which time it is rendered.
 *
 * Gives up after a full lap, which is the honest "this account genuinely has
 * nothing to play" and is the only case the caller should treat as blocked.
 */
export function advanceToPlayable(
  startCursor: number,
  approvedCount: number,
  isReady: (index: number) => boolean,
): { cursor: number; index: number } | null {
  if (approvedCount <= 0) return null;
  for (let step = 0; step < approvedCount; step++) {
    const cursor = startCursor + step;
    const index = masterIndexForCursor(cursor, approvedCount);
    if (index !== null && isReady(index)) return { cursor, index };
  }
  return null;
}

/** How many times an account has been all the way round the library. Zero on
 *  the first pass. Worth reporting: it is the number that says how hard the
 *  same footage is being reused, which no other figure in the system shows. */
export function libraryLapsCompleted(nextSeq: number, approvedCount: number): number {
  if (approvedCount <= 0) return 0;
  return Math.floor(Math.max(0, Math.floor(nextSeq) - 1) / approvedCount);
}

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
  /** Which of the day's slots this is, for the admin page. 'now' is the
   *  kickoff post a brand new account gets the moment it connects; everything
   *  else is its position in the day, "s01" upward. Named hours ("morning")
   *  died with the fixed three: there is no word for the thirty-first slot. */
  slot: string;
}

/** The label for the nth slot of the day. Zero padded so they sort. */
export function slotLabel(index: number): string {
  return `s${String(index + 1).padStart(2, "0")}`;
}

/**
 * The next `count` posting slots for one account, starting strictly after
 * `after`. Three a day at SLOT_HOURS local, each shifted by the account's
 * stagger minutes. Deterministic, timezone-correct, never in the past.
 */
export function nextSlots(
  after: Date,
  timeZone: string,
  staggerMin: number,
  count: number,
  postsPerDay: number = DEFAULT_POSTS_PER_DAY,
  staggerSec: number = 0,
): PostSlot[] {
  const out: PostSlot[] = [];
  const today = zoneParts(after, timeZone);
  const minutes = dailySlotMinutes(postsPerDay);
  const maxDays = Math.ceil(count / minutes.length) + 2;
  for (let dayOffset = 0; out.length < count && dayOffset < maxDays; dayOffset++) {
    for (let s = 0; s < minutes.length && out.length < count; s++) {
      const base = zonedTimeToUtc(today.y, today.m, today.d, 0, minutes[s], timeZone);
      const at = new Date(
        base.getTime() +
          dayOffset * 86_400_000 +
          staggerMin * 60_000 +
          staggerSec * 1_000,
      );
      if (at.getTime() <= after.getTime()) continue;
      out.push({ at, slot: slotLabel(s) });
    }
  }
  return out;
}

/**
 * The slots still remaining in the account's CURRENT local day. This is what
 * the scheduler fills from: review proved that filling "until 2 today" from
 * slots that may land on FUTURE days marches the sequence weeks ahead (each
 * run adds more tomorrow-or-later posts while today's count never moves).
 * Filling only today's remaining slots is self-limiting: at most POSTS_PER_DAY,
 * and an account enrolled at noon gets what is left of today and the full three
 * from tomorrow.
 */
export function todaySlots(
  now: Date,
  timeZone: string,
  staggerMin: number,
  postsPerDay: number = DEFAULT_POSTS_PER_DAY,
  staggerSec: number = 0,
): PostSlot[] {
  const today = zoneParts(now, timeZone);
  return nextSlots(now, timeZone, staggerMin, postsPerDay, postsPerDay, staggerSec).filter(
    (s) => {
      const p = zoneParts(s.at, timeZone);
      return p.y === today.y && p.m === today.m && p.d === today.d;
    },
  );
}

/**
 * Today's slots for an account, with the first video going out IMMEDIATELY if
 * this account has never posted.
 *
 * Hugo, 09 Aug 2026: "as soon as the user connects we already should post, and
 * then within five minutes we should post the first video, and then it gets on
 * the queue for the day."
 *
 * The kickoff post TAKES THE PLACE of the next clock slot rather than being
 * added to it, for two reasons: day one is then still three videos and not
 * four, and an account connecting at 10:55 does not post twice inside five
 * minutes. If every slot for today has already gone by, the kickoff is still
 * made, so somebody who connects at 21:00 sees their first video tonight
 * instead of waiting until 11:00 tomorrow.
 */
/**
 * ROTATION FILL: spread whatever is left of today's quota from RIGHT NOW to the
 * end of the day, instead of waiting for fixed clock positions.
 *
 * Hugo, 26 Aug 2026: "it doesn't matter when we post, it just keep posting.
 * In a posting rotation anytime, doesn't matter, just keep posting."
 *
 * The fixed grid throws away the part of the day that has already gone. An
 * account at ten a day whose first five clock slots are in the past can only
 * post five times today, so the fleet quietly runs at half the number on the
 * dial every single day the dial is changed. This fills the runway that is
 * actually left.
 *
 * The end of the posting window is still respected where there is any of it
 * left, because posting to a sleeping audience is not the same as posting. When
 * the window is already gone it falls back to the rest of the local day rather
 * than returning nothing: Hugo's rule is keep posting, and a post at 23:40 is
 * worth more than a post that never happened.
 */
export function rotationSlots(
  now: Date,
  timeZone: string,
  count: number,
  staggerSec: number = 0,
): PostSlot[] {
  if (count <= 0) return [];
  const p = zoneParts(now, timeZone);
  const nowMin = p.hh * 60 + p.mm;
  // Two minutes of head start: the conductor runs every two minutes and a slot
  // in the past is a slot the publisher fires immediately, all at once.
  const start = nowMin + 2;
  const windowEnd = DAY_WINDOW_END_MIN;
  const end = start >= windowEnd - 10 ? Math.min(24 * 60 - 5, start + 200) : windowEnd;
  const span = Math.max(1, end - start);
  const step = count === 1 ? span / 2 : span / count;

  const out: PostSlot[] = [];
  for (let i = 0; i < count; i++) {
    const minute = Math.round(start + i * step);
    const at = new Date(
      zonedTimeToUtc(p.y, p.m, p.d, 0, minute, timeZone).getTime() + staggerSec * 1000,
    );
    if (at.getTime() <= now.getTime()) continue;
    out.push({ at, slot: slotLabel(i) });
  }
  return out;
}

export function todaySlotsWithKickoff(
  now: Date,
  timeZone: string,
  staggerMin: number,
  neverPosted: boolean,
  postsPerDay: number = DEFAULT_POSTS_PER_DAY,
  staggerSec: number = 0,
): PostSlot[] {
  const slots = todaySlots(now, timeZone, staggerMin, postsPerDay, staggerSec);
  if (!neverPosted) return slots;
  return [{ at: now, slot: "now" }, ...slots.slice(1)];
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

/**
 * THE QUOTA COUNTER, and why counting the calendar day was not enough.
 *
 * 26 Aug 2026, first live day: accounts were handed 41, 55, even 118 posts
 * against a quota of 10. The cause was a gap between two rules that each looked
 * right. rotationSlots, once the evening window had closed, placed its slots a
 * few hours out, which can land after local midnight. postsInLocalDay then did
 * not count those, because they belong to tomorrow. So the quota never filled,
 * and a cron running every two minutes kept topping the account up, all night.
 *
 * Counting from local midnight FORWARD, with no upper bound, closes it: a post
 * that spilled past midnight still counts against the day that created it, so
 * the quota fills exactly once.
 */
export function postsCountingForward(
  now: Date,
  timeZone: string,
  scheduledAts: Date[],
): number {
  const t = zoneParts(now, timeZone);
  const localMidnight = zonedTimeToUtc(t.y, t.m, t.d, 0, 0, timeZone).getTime();
  return scheduledAts.filter((at) => at.getTime() >= localMidnight).length;
}
