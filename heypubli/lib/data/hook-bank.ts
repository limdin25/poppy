// hook-bank.ts: the rules for the three beats of text that open every video.
//
// PURE. No Supabase, no fetch, no env. The writer calls validateHook on what
// the model returned, the draw calls pickHook, and both are testable without a
// network.
//
// THE ONE RULE THAT MATTERS MOST: a hook may never mention AI, generation,
// filming, cameras or anything being fake. The whole video is built on the
// viewer not knowing until the end card tells them. VARIANTS.md puts it in
// stronger terms than I would: told up front it is a novelty, told at the end
// it is a demonstration. One hook giving it away costs the reveal, and the
// reveal is the point. So this is enforced in code, not in a prompt, because a
// prompt is a request and this is a requirement.

/** One opening: three beats, each one or two short lines. */
export interface Hook {
  readonly beat1: string;
  readonly beat2: string;
  readonly beat3: string;
}

/** Beats as they are stored: lines joined by newlines. */
export type HookBeatKey = "beat1" | "beat2" | "beat3";
export const BEAT_KEYS: readonly HookBeatKey[] = ["beat1", "beat2", "beat3"];

/** Measured against the render engine: at its smallest type size a line wider
 *  than this wraps, and a wrapped beat is three lines where two were designed. */
export const MAX_LINE_CHARS = 24;
export const MAX_LINES_PER_BEAT = 2;

/** Punctuation this codebase does not use, anywhere, ever. Hugo, 27 Jul 2026:
 *  "no long dashes ever". Curly quotes and the ellipsis character go with them. */
export const BANNED_PUNCTUATION = /[–—‘’“”…]/;

/** Words that give the ending away before the ending. */
const REVEAL_WORDS = [
  "ai", "a.i", "artificial", "generated", "generate", "generative",
  "filmed", "filming", "film", "camera", "cgi", "deepfake", "deep fake",
  "fake", "not real", "isn't real", "is not real", "render", "rendered",
  "prompt", "midjourney", "sora", "veo", "runway", "avatar", "robot",
  "software", "computer made", "made by a machine",
];

export type HookFault =
  | "empty"
  | "too-many-lines"
  | "line-too-long"
  | "banned-punctuation"
  | "reveals-the-ending"
  | "not-three-beats";

export interface HookCheck {
  readonly ok: boolean;
  readonly faults: readonly HookFault[];
}

function lines(beat: string): string[] {
  return beat
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Word-boundary match, so "said" does not trip on "ai" and "flair" does not
 *  trip on "air". A substring test here rejected most of the usable language. */
function mentionsReveal(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-z.']+/).filter(Boolean);
  const joined = ` ${words.join(" ")} `;
  return REVEAL_WORDS.some((w) => joined.includes(` ${w} `));
}

/**
 * Judge one hook. Every fault it can have, not just the first, because the
 * writer retries against the whole list and a one-fault-at-a-time loop takes
 * three round trips to learn what one would have taught it.
 */
export function validateHook(hook: Partial<Hook>): HookCheck {
  const faults = new Set<HookFault>();
  const present = BEAT_KEYS.filter((k) => (hook[k] ?? "").trim().length > 0);
  if (present.length !== BEAT_KEYS.length) faults.add("not-three-beats");

  for (const key of BEAT_KEYS) {
    const beat = (hook[key] ?? "").trim();
    if (!beat) {
      faults.add("empty");
      continue;
    }
    const ls = lines(beat);
    if (ls.length === 0) faults.add("empty");
    if (ls.length > MAX_LINES_PER_BEAT) faults.add("too-many-lines");
    if (ls.some((l) => l.length > MAX_LINE_CHARS)) faults.add("line-too-long");
    if (BANNED_PUNCTUATION.test(beat)) faults.add("banned-punctuation");
    if (mentionsReveal(beat)) faults.add("reveals-the-ending");
  }
  return { ok: faults.size === 0, faults: [...faults] };
}

/** The key two hooks are the same under. Case and spacing do not make a hook
 *  different, and the bank filling with the same line in two capitalisations is
 *  the failure this exists to stop. */
export function hookKey(hook: Hook): string {
  return BEAT_KEYS.map((k) => hook[k].toLowerCase().replace(/\s+/g, " ").trim()).join("|");
}

/**
 * Read a batch out of whatever the model sent back.
 *
 * The format asked for is one hook per line, beats separated by " / " and the
 * two lines inside a beat by " | ". Anything that does not parse, or does not
 * validate, is DROPPED rather than repaired: a half-understood hook is how a
 * broken line reaches 3,700 posts, and the writer can always be run again.
 */
export function parseHookBatch(raw: string): Hook[] {
  const out: Hook[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const text = line.trim().replace(/^[-*\d.)\s]+/, "");
    if (!text.includes("/")) continue;
    const parts = text.split("/").map((p) => p.trim());
    if (parts.length !== 3) continue;
    const hook: Hook = {
      beat1: parts[0].split("|").map((s) => s.trim()).filter(Boolean).join("\n"),
      beat2: parts[1].split("|").map((s) => s.trim()).filter(Boolean).join("\n"),
      beat3: parts[2].split("|").map((s) => s.trim()).filter(Boolean).join("\n"),
    };
    if (!validateHook(hook).ok) continue;
    const key = hookKey(hook);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hook);
  }
  return out;
}

export interface BankHook extends Hook {
  readonly id: string;
}

/**
 * The account's next opening: the oldest hook it has not used.
 *
 * Oldest-first rather than random, for one reason. Random draws collide by the
 * birthday problem long before a bank is exhausted, so an account would repeat
 * a hook while hundreds sat unused, and "always unique" would be false in a way
 * nobody would notice for weeks. Walking the bank in order uses every line once
 * before any line twice, which is the actual promise.
 *
 * Returns null when the account has used everything, which is a real state and
 * the caller's job to handle: it means the writer needs to run, and the honest
 * answer is to hold the post rather than repeat a hook.
 */
export function pickHook(
  bank: readonly BankHook[],
  usedIds: ReadonlySet<string>,
  startOffset: number = 0,
): BankHook | null {
  if (!bank.length) return null;
  // WHERE an account starts matters as much as the order.
  //
  // 26 Aug 2026, first live batch: six posts built in one minute and four of
  // them opened with the same line. Every account walked the bank from the top,
  // so they all drew hook 1, then hook 2, in lockstep. Unique per account is
  // not the same as unique across the fleet, and the words are the part a human
  // actually reads.
  const from = ((Math.floor(startOffset) % bank.length) + bank.length) % bank.length;
  for (let i = 0; i < bank.length; i++) {
    const h = bank[(from + i) % bank.length];
    if (!usedIds.has(h.id)) return h;
  }
  return null;
}

/** How many unused hooks the whole fleet has left, which is the number that
 *  says whether the writer is keeping up. */
export function bankHeadroom(
  bankSize: number,
  usedByBusiestAccount: number,
): number {
  return Math.max(0, bankSize - usedByBusiestAccount);
}
