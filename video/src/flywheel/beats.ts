// The beat sheet: what appears on top of the speaker, and exactly when.
//
// TIMES ARE IN SOURCE SECONDS, straight against the original 74.2s take.
//
// An earlier version cut the pauses out and timed everything against the
// shortened edit. Hugo watched it and rejected the cuts, so the take now plays
// whole and these times were converted back through data/plan.json. That plan
// file and scripts/flywheel-plan.mjs are the leftovers of that approach: they
// are no longer in the render path and nothing here depends on them.
//
// So: if you change a time in this file, it is a plain source timestamp. Check
// it against data/transcript.json, not against any edit.

/** A line of kinetic type. Short by design: this is emphasis, not subtitles. */
export interface TypeBeat {
  readonly text: string;
  readonly at: number;
  readonly seconds: number;
  /** Words rendered in gold rather than white. Matched case-insensitively. */
  readonly gold?: readonly string[];
  /** hero is full-screen and centred, and is used exactly once, on the price. */
  readonly style?: 'lower' | 'hero';
}

/**
 * A B-roll insert, kept but OFF by default.
 *
 * These are not dead: the twelve images exist in public/flywheel/broll and the
 * timings are right. They are behind the showBroll prop because the brief came
 * back as type and music only. Flip the prop to see them again.
 */
export interface BrollBeat {
  readonly slug: string;
  readonly at: number;
  readonly seconds: number;
  readonly kind: 'literal' | 'abstract';
  readonly push: 'in' | 'out';
}

export const TYPE: readonly TypeBeat[] = [
  { text: 'EVEN ME', at: 5.13, seconds: 1.0, gold: ['ME'] },
  { text: 'THE WORLD SHIFTED', at: 6.68, seconds: 1.4, gold: ['SHIFTED'] },
  { text: 'A TOY', at: 10.26, seconds: 1.0, gold: ['TOY'] },
  { text: 'ENTIRE TEAMS', at: 13.76, seconds: 1.3, gold: ['TEAMS'] },
  { text: 'ONE LAPTOP', at: 15.12, seconds: 1.2, gold: ['LAPTOP'] },
  { text: 'THE REAL GAME', at: 19.02, seconds: 1.3, gold: ['GAME'] },
  { text: 'INTO MONEY', at: 23.84, seconds: 1.2, gold: ['MONEY'] },
  { text: 'FLYWHEEL', at: 25.59, seconds: 1.5, gold: ['FLYWHEEL'] },
  { text: '5 ACCOUNTS', at: 33.6, seconds: 1.4, gold: ['5'] },
  { text: 'AFFILIATE OFFERS', at: 40.27, seconds: 1.2, gold: ['OFFERS'] },
  { text: 'WE DO THE LIFTING', at: 41.69, seconds: 1.4, gold: ['WE'] },
  { text: 'WE MAKE IT', at: 45.39, seconds: 1.0, gold: ['WE'] },
  { text: 'YOU CONNECT', at: 46.51, seconds: 1.1, gold: ['YOU'] },
  { text: 'DOMINATE THE FEED', at: 49.67, seconds: 1.4, gold: ['DOMINATE'] },
  { text: 'SET IT UP ONCE', at: 51.67, seconds: 1.3, gold: ['ONCE'] },
  { text: 'START TODAY', at: 59.51, seconds: 1.3, gold: ['TODAY'] },
  { text: '$9', at: 63.6, seconds: 1.9, gold: ['$9'], style: 'hero' },
  { text: 'PRICE GOES UP', at: 66.85, seconds: 1.4, gold: ['UP'] },
  { text: 'GRAB YOUR SPOT', at: 68.91, seconds: 1.3, gold: ['SPOT'] },
  { text: 'SEE YOU INSIDE', at: 71.9, seconds: 1.3, gold: ['INSIDE'] },
];

export const BROLL: readonly BrollBeat[] = [
  { slug: 'ai-face', at: 3.06, seconds: 1.3, kind: 'abstract', push: 'in' },
  { slug: 'shift', at: 6.64, seconds: 1.2, kind: 'abstract', push: 'out' },
  { slug: 'toy', at: 10.2, seconds: 1.1, kind: 'literal', push: 'in' },
  { slug: 'empty-studio', at: 13.74, seconds: 1.3, kind: 'literal', push: 'out' },
  { slug: 'one-laptop', at: 15.1, seconds: 1.15, kind: 'literal', push: 'in' },
  { slug: 'into-money', at: 23.78, seconds: 1.1, kind: 'abstract', push: 'out' },
  { slug: 'flywheel', at: 25.56, seconds: 1.4, kind: 'abstract', push: 'in' },
  { slug: 'five-phones', at: 33.56, seconds: 1.5, kind: 'literal', push: 'out' },
  { slug: 'heavy-lift', at: 41.66, seconds: 1.3, kind: 'abstract', push: 'in' },
  { slug: 'the-feed', at: 49.58, seconds: 1.25, kind: 'literal', push: 'out' },
  { slug: 'outside-looking', at: 54.84, seconds: 1.4, kind: 'literal', push: 'in' },
  { slug: 'window-closing', at: 71.1, seconds: 1.2, kind: 'abstract', push: 'out' },
];
