// seed.ts: deterministic randomness. The whole factory's reproducibility rests
// on this file, so read the two warnings before changing anything.
//
// WARNING 1: TWO KINDS OF SEED, AND CONFUSING THEM BREAKS THINGS SILENTLY.
// A deck's SHUFFLE seed must not include the variant index. If it does, every
// variant reshuffles the deck from scratch and the "no repeat until exhausted"
// guarantee evaporates, while every test that checks a single variant still
// passes. A JITTER seed must include the variant index, or all four variants of
// one source get identical jitter. Different lifetimes, hence different
// constructors with different names. Do not merge them.
//
// WARNING 2: NEVER ADD A DRAW IN THE MIDDLE.
// The streams are salted per attribute precisely so that adding a new attribute
// later is additive. Inserting a draw into an existing stream shifts every
// decision after it, which silently changes the appearance of every variant ever
// rendered and makes the good ones unreproducible.

import { rng } from '../lib/human';

/**
 * FNV-1a 32 bit. Stable across machines, node versions and architectures, which
 * is the only property that matters here. Nothing depends on Math.random,
 * Date.now, object key order or floating point.
 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A named random stream.
 *
 * The two discarded draws are deliberate: mulberry32's first output is weakly
 * mixed for adjacent seeds, and two labels differing by one character would
 * otherwise produce visibly correlated first values. Two multiplications is
 * nothing. Do not remove them.
 */
export function stream(label: string): () => number {
  const next = rng(fnv1a(label));
  next();
  next();
  return next;
}

/** Shuffle seed: stable for the whole of one source's run. No variant index. */
export function shuffleLabel(attr: string, sourceId: string, filter = ''): string {
  return `shuffle|${attr}|${sourceId}|${filter}`;
}

/** Jitter seed: varies per variant, so siblings do not look copy-pasted. */
export function jitterLabel(attr: string, sourceId: string, variantIndex: number): string {
  return `jitter|${attr}|${sourceId}|${variantIndex}`;
}

/** Seeded Fisher-Yates. Returns a new array, never mutates the input. */
export function shuffled<T>(items: readonly T[], label: string): T[] {
  const a = items.slice();
  const next = stream(label);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Take the first admissible item at or after the cursor, moving it INTO the
 * cursor slot by a forward swap.
 *
 * The swap rather than a skip is what preserves the deck's whole point: every
 * item is still used exactly once before any item repeats. A reroll would not
 * preserve that, and a skip would leave holes that never get drawn.
 *
 * If nothing in the tail is admissible it takes the cursor item anyway. That is
 * a bounded, deterministic relaxation, and the tests assert it is unreachable
 * with the real banks.
 */
export function drawConstrained<T>(
  order: T[],
  cursor: number,
  isAdmissible: (item: T) => boolean,
): T {
  for (let j = cursor; j < order.length; j++) {
    if (isAdmissible(order[j])) {
      if (j !== cursor) [order[cursor], order[j]] = [order[j], order[cursor]];
      return order[cursor];
    }
  }
  return order[cursor];
}

/**
 * A deck yields every item once, then reshuffles into a DIFFERENT order.
 *
 * The epoch in the reshuffle label is what makes cycle two differ from cycle
 * one. Without it a source running 30 variants over a 14 item bank emits the
 * identical order twice and a human notices immediately.
 */
export class Deck<T> {
  private order: T[];
  private cursor = 0;
  private epoch = 0;
  private lastTaken: T | undefined;

  constructor(
    private readonly items: readonly T[],
    private readonly label: string,
  ) {
    if (items.length === 0) throw new Error(`empty deck: ${label}`);
    this.order = shuffled(items, `${label}|e0`);
  }

  take(isAdmissible: (item: T) => boolean = () => true): T {
    if (this.cursor >= this.order.length) {
      this.epoch += 1;
      this.cursor = 0;
      this.order = shuffled(this.items, `${this.label}|e${this.epoch}`);
      // Carry-over guard. If the new order opens with what the old one closed
      // on, the seam between epochs shows as an immediate repeat.
      if (this.order.length > 1 && this.order[0] === this.lastTaken) {
        this.order.push(this.order.shift() as T);
      }
    }
    const v = drawConstrained(this.order, this.cursor, isAdmissible);
    this.cursor += 1;
    this.lastTaken = v;
    return v;
  }
}
