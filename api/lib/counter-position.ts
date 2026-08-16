// They came back on price. Do we raise, hold, or walk away?
//
// Hugo, 2026-08-14: "AI should draft the email reply based on the course and
// based on comparable and likely cost of fixing and then decide if we can
// increase the offer or just pass."
//
// THE DECISION IS MADE HERE, IN CODE, NOT BY A MODEL. The same law the rest of
// the machine lives by: the AI decides words, code decides money. A model
// asked "should we go up?" will find a reason to say yes, because that is what
// the conversation is pulling towards, and the one thing that cannot be undone
// on a property deal is a number said out loud.
//
// The ceiling is not a guideline. It is TMV x 0.80, the course's own "20
// percent below market value as a minimum", and the whole business only works
// because of it: the bank lends 75% of the finished value, so paying more than
// the ceiling leaves the investor's money stuck in the wall and there is no
// deal to sell. See BRRR_STRATEGY.md section 4.
//
// The live case this was written for: Lexi at DDM, 39 Orion Way, 2026-08-14.
// The vendor rejected GBP 96,375 and wants nearer the GBP 110,000 asking price.
// Our corrected ceiling on that house is GBP 68,345. There is nothing to
// discuss, and the honest answer is the one this returns.

export type Position = 'raise' | 'hold' | 'pass';

export interface CounterInput {
  /** The most we may ever pay. deal.offer.max, read from the engine. */
  ceiling?: number | null;
  /** What we have already put to them. */
  currentOffer?: number | null;
  /** The figure THEY named, or their asking price if they only pointed at it. */
  theirFigure?: number | null;
  /** gold or strong. Anything else and we are not negotiating on this house. */
  evidenceTier?: string | null;
}

export interface CounterDecision {
  position: Position;
  /** The figure to put to them. Never above the ceiling. Null on hold/pass. */
  newOffer: number | null;
  /** Why, in one plain sentence, for the email writer and for Hugo. */
  reason: string;
  /** A short machine tag, so this is greppable in logs and testable. */
  code: string;
  /** Everything the email writer is allowed to name. */
  figuresAllowed: number[];
}

const SHIPPABLE_TIERS = ['gold', 'strong'];

const gbp = (n: number) => `GBP ${Math.round(n).toLocaleString('en-GB')}`;

export function decideCounter(input: CounterInput): CounterDecision {
  const ceiling = num(input.ceiling);
  const current = num(input.currentOffer);
  const theirs = num(input.theirFigure);
  const tier = String(input.evidenceTier ?? '').trim().toLowerCase();

  const allowed = [ceiling, current, theirs].filter((n): n is number => n !== null);

  // ---- no ceiling, no negotiation ------------------------------------
  // Without a maximum from the engine there is no way to know whether any
  // number is safe, and guessing one is exactly the failure this business
  // cannot survive.
  if (ceiling === null) {
    return {
      position: 'hold', newOffer: null, code: 'no_ceiling',
      reason: 'There is no maximum on file for this house, so there is no figure to move to. '
        + 'Hold, and get the valuation finished before answering on price.',
      figuresAllowed: allowed,
    };
  }

  // ---- evidence we would not have shipped on -------------------------
  // 39 Orion Way was valued on `good` comps (another street, or another year).
  // Raising an offer on evidence we have already decided is not good enough to
  // make an offer on is the worst of both.
  if (!SHIPPABLE_TIERS.includes(tier)) {
    return {
      position: 'hold', newOffer: null, code: 'evidence_below_standard',
      reason: 'The valuation on this house rests on evidence below our own standard, '
        + `${tier ? `${tier} comparables` : 'no recorded tier'}, so there is nothing to raise to. `
        + 'Hold, and say plainly that we cannot improve it.',
      figuresAllowed: allowed,
    };
  }

  // ---- they are inside our ceiling: this is a deal --------------------
  if (theirs !== null && theirs <= ceiling) {
    return {
      position: 'raise', newOffer: theirs, code: 'their_figure_within_ceiling',
      reason: `Their figure of ${gbp(theirs)} is inside our maximum of ${gbp(ceiling)}, `
        + 'so we can meet it. Put it to them as agreed subject to our builder viewing.',
      figuresAllowed: [...allowed, theirs],
    };
  }

  // ---- they want more than we may pay --------------------------------
  const haveHeadroom = current === null || current < ceiling;
  if (haveHeadroom) {
    return {
      position: 'raise', newOffer: ceiling, code: 'raise_to_ceiling_final',
      reason: `They want more than we can pay, but we still have room up to ${gbp(ceiling)}. `
        + 'Go to the maximum and be clear it is the maximum, so the next answer is a yes or a no.',
      figuresAllowed: allowed,
    };
  }

  // ---- already at the maximum ----------------------------------------
  return {
    position: 'pass', newOffer: null, code: 'already_at_ceiling',
    reason: `We are already at our maximum of ${gbp(ceiling)} and they want more. `
      + 'Pass, and leave the door open in case the vendor moves later.',
    figuresAllowed: allowed,
  };
}

/** THE ONE CEILING. Hugo's written ruling in the pinned note OVERRIDES the
 *  engine's band, in EITHER direction: "up to 102,800" authorises more than an
 *  engine ceiling of 96,375, and "never past 90,000" lowers one of 111,500.
 *  Not Math.max, which was the first version and was wrong: it silently kept
 *  the engine's higher number when Hugo had ruled lower.
 *
 *  Found live on DDM, 16 Aug: the stress test approved the counter at Hugo's
 *  pinned ladder while the draft route, fed only the engine ceiling, wrote
 *  "we are not able to improve our offer". Two fences, two answers. Every
 *  caller that needs a cap goes through here now, so they cannot disagree. */
export function effectiveCeiling(engine: number | null | undefined, pinned: number | null | undefined): number | null {
  return num(pinned) ?? num(engine);
}

/** THE INVARIANT, checkable on its own: a decision may never propose paying
 *  more than the ceiling. Called by the tests and by the email route before
 *  anything is written, because one wrong number here is a deal that loses
 *  money for whoever buys it. */
export function respectsCeiling(d: CounterDecision, ceiling?: number | null): boolean {
  const cap = num(ceiling);
  if (d.newOffer === null) return true;
  if (cap === null) return false;
  return d.newOffer <= cap;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
