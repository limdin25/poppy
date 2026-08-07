// fonts.ts: the typeface bank. PURE: no Remotion, no DOM, no I/O.
//
// The actual loading lives in parts/useVariantFont.ts, which is the only file
// that touches delayRender. Keeping this module pure is what lets the plan and
// its 5,000-seed sweep run in node in milliseconds.
//
// WHY SELF-HOSTED WOFF2 AND NOT @remotion/google-fonts.
//
// Neither @remotion/fonts nor @remotion/google-fonts is installed here, and
// that turns out to be the right answer rather than an inconvenience. The Google
// Fonts package fetches CSS and font binaries from fonts.googleapis.com AT
// RENDER TIME. That gives every render worker a network dependency on every
// render, and one flaky DNS lookup produces a video with a fallback typeface,
// silently. Worse for us specifically: Google serves different subsets per
// user-agent, so two workers on different Chromium builds can receive different
// files, glyph metrics differ, and a hook that wraps to two lines on one machine
// wraps to three on another. That breaks reproducibility from a seed, which is
// the premise of the whole system.
//
// So: files on disk, hashes in a lock file, loaded with the native FontFace API.
//
// WHY CAP HEIGHT AND NOT FONT SIZE. Two typefaces at the same fontSize differ by
// up to 20 percent in perceived size and over 2x in width. Anton at 96px and
// Playfair at 96px do not look like the same size at all. Setting a target CAP
// HEIGHT and deriving fontSize from each face's own metrics is what makes the
// rotation read as one design system rather than as an accident.

import measured from './font-metrics.json';
import { HOOK_MAX_LINES } from './geometry';
import type { Temperament } from './palettes';

export type FontKey =
  | 'inter-tight'
  | 'archivo'
  | 'anton'
  | 'bricolage'
  | 'space-grotesk'
  | 'sora'
  | 'manrope'
  | 'playfair'
  | 'instrument-serif'
  | 'schibsted';

export interface FontSpec {
  readonly key: FontKey;
  /** CSS family name. Must match what the loader registers. */
  readonly family: string;
  /** woff2 filename under video/public/fonts/. */
  readonly file: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  /** Letter spacing in em. Negative tightens. */
  readonly tracking: number;
  readonly transform: 'none' | 'uppercase';
  readonly lineHeight: number;
  /** Which palette families this face is allowed on. */
  readonly temperament: Temperament;
  /**
   * Minimum size this face stays attractive at.
   *
   * These were set against a 70px cap height and had to come down with it when
   * the hook dropped to 54 (see HOOK_CAP_PX). At 54, Anton derives 63px and
   * Playfair 82px, both of which sat BELOW their old floors, and fitHook then
   * reported perfectly good hooks as unfittable because its loop had nothing to
   * iterate. Scaled by 54/70 and rounded down to a round number.
   */
  readonly minSize: number;
  /**
   * Optical size correction, multiplied into the cap-height target.
   *
   * Cap-height normalisation makes faces match in MEASURED size, which is the
   * right baseline. It does not make them match in PRESENCE: a 400 weight italic
   * serif at the same cap height as an 800 weight grotesque reads far smaller
   * and weaker, because presence comes from stroke mass, not from letter height.
   * The contact sheet showed this immediately, with Instrument Serif looking
   * like a caption sitting next to headlines.
   *
   * 1.0 for the heavy grotesques, above 1 for the thin-stroked display faces.
   */
  readonly capScale: number;
  readonly note: string;
}

export const FONT_BANK: Record<FontKey, FontSpec> = {
  'inter-tight': {
    key: 'inter-tight',
    family: 'Inter Tight',
    file: 'InterTight-ExtraBold.woff2',
    weight: 800,
    style: 'normal',
    // Inter at zero tracking looks like a UI label blown up to 96px. It is not
    // a display face until you tighten it.
    tracking: -0.028,
    transform: 'none',
    lineHeight: 1.02,
    temperament: 'neutral',
    minSize: 48,
    capScale: 1,
    note: 'The default. Never wrong, never exciting.',
  },
  archivo: {
    key: 'archivo',
    family: 'Archivo',
    file: 'Archivo-ExtraBold.woff2',
    weight: 800,
    style: 'normal',
    tracking: -0.01,
    transform: 'uppercase',
    lineHeight: 1.0,
    temperament: 'neutral',
    minSize: 48,
    capScale: 1,
    note: 'Semi-expanded grotesque. Poster energy without shouting.',
  },
  anton: {
    key: 'anton',
    family: 'Anton',
    file: 'Anton-Regular.woff2',
    weight: 400,
    style: 'normal',
    // POSITIVE tracking, and it is the only face here that needs it. Anton's
    // counters close up at display size and it turns into a black slab.
    tracking: 0.004,
    transform: 'uppercase',
    lineHeight: 0.94,
    temperament: 'brutal',
    minSize: 48,
    capScale: 1,
    note: 'Ultra condensed. The native short-form face. Fits twice the words.',
  },
  bricolage: {
    key: 'bricolage',
    family: 'Bricolage Grotesque',
    file: 'BricolageGrotesque-ExtraBold.woff2',
    weight: 800,
    style: 'normal',
    tracking: -0.02,
    transform: 'none',
    lineHeight: 1.04,
    temperament: 'brutal',
    minSize: 48,
    capScale: 1,
    note: 'Quirky and contemporary, with a real optical size axis.',
  },
  'space-grotesk': {
    key: 'space-grotesk',
    family: 'Space Grotesk',
    file: 'SpaceGrotesk-Bold.woff2',
    weight: 700,
    style: 'normal',
    tracking: -0.014,
    transform: 'none',
    lineHeight: 1.06,
    temperament: 'techno',
    minSize: 48,
    capScale: 1,
    note: 'Reads "developer tool". Right for AI, wrong for anything soft.',
  },
  sora: {
    key: 'sora',
    family: 'Sora',
    file: 'Sora-ExtraBold.woff2',
    weight: 800,
    style: 'normal',
    tracking: -0.022,
    transform: 'none',
    lineHeight: 1.04,
    temperament: 'techno',
    minSize: 48,
    capScale: 1,
    note: 'Geometric. The current default for AI landing pages, used knowingly.',
  },
  manrope: {
    key: 'manrope',
    family: 'Manrope',
    file: 'Manrope-ExtraBold.woff2',
    weight: 800,
    style: 'normal',
    tracking: -0.024,
    transform: 'none',
    lineHeight: 1.06,
    temperament: 'neutral',
    minSize: 48,
    capScale: 1,
    note: 'Rounded terminals. The friendliest thing in the bank.',
  },
  playfair: {
    key: 'playfair',
    family: 'Playfair Display',
    file: 'PlayfairDisplay-ExtraBold.woff2',
    weight: 800,
    style: 'normal',
    tracking: -0.008,
    transform: 'none',
    lineHeight: 1.0,
    temperament: 'editorial',
    // A high-contrast didone needs size to earn its thin strokes. Below this it
    // just looks weak rather than expensive, so it keeps a higher floor than the
    // grotesques even after the scale-down.
    minSize: 64,
    // A didone's hairlines vanish at a grotesque's size. Measured on the contact
    // sheet: at capScale 1 it read a full step smaller than its neighbours.
    capScale: 1.08,
    note: 'High-contrast didone. Instant luxury, needs room.',
  },
  'instrument-serif': {
    key: 'instrument-serif',
    family: 'Instrument Serif',
    file: 'InstrumentSerif-Italic.woff2',
    weight: 400,
    style: 'italic',
    tracking: -0.006,
    transform: 'none',
    lineHeight: 1.02,
    temperament: 'editorial',
    minSize: 60,
    // The weakest face in the bank by stroke mass: a 400 italic against nine
    // bolds. It needs the biggest correction of any of them to hold a hook at
    // thumbnail scale, which is where these are actually seen.
    capScale: 1.18,
    note: 'The most expensive-looking face here. Short hooks only.',
  },
  schibsted: {
    key: 'schibsted',
    family: 'Schibsted Grotesk',
    file: 'SchibstedGrotesk-ExtraBold.woff2',
    weight: 800,
    style: 'normal',
    tracking: -0.018,
    transform: 'none',
    lineHeight: 1.04,
    temperament: 'neutral',
    minSize: 48,
    capScale: 1,
    note: 'Newsy and credible. Good for stat-shaped hooks.',
  },
};

interface Metrics {
  readonly capHeightEm: number;
  readonly avgAdvanceEm: number;
  readonly source: string;
  readonly variable: boolean;
}

/**
 * Measured by scripts/measure-fonts.mjs from the canonical OFL ttf files.
 *
 * These are GENERATED, never hand-written, because guessing them is exactly the
 * mistake that puts an overflowing hook in a finished video. The first pass at
 * this file declared Anton's cap height as 0.73; it is actually 0.859, which
 * would have rendered Anton 18 percent too large in every video it appeared in.
 */
const METRICS = measured as Record<FontKey, Metrics>;

/**
 * Eight of the ten faces ship as VARIABLE fonts, whose default instance is
 * Regular. So the measured advance width is Regular's, while we render at
 * ExtraBold, which is wider. Applying a widening factor keeps the line estimate
 * on the safe side: it overestimates width, so a marginal hook gets rejected by
 * the test rather than overflowing in a render.
 *
 * 1.08 is a conservative figure for the weight jump on a grotesque. It does not
 * need to be exact, because the browser does the real line breaking at render
 * time (see fitTextToBox in parts/). This number only decides which hooks the
 * test suite lets into the bank.
 */
const VARIABLE_BOLD_WIDENING = 1.08;

export function metrics(key: FontKey): { capHeightEm: number; avgAdvanceEm: number } {
  const m = METRICS[key];
  if (!m) throw new Error(`no measured metrics for ${key}. Run scripts/measure-fonts.mjs`);
  const spec = FONT_BANK[key];
  const widen = m.variable && spec.weight > 400 ? VARIABLE_BOLD_WIDENING : 1;
  return { capHeightEm: m.capHeightEm, avgAdvanceEm: m.avgAdvanceEm * widen };
}

export const FONT_KEYS = Object.keys(FONT_BANK) as FontKey[];

export function font(key: string): FontSpec {
  const hit = FONT_BANK[key as FontKey];
  if (!hit) throw new Error(`unknown font: ${key}`);
  return hit;
}

/**
 * Fonts a family may use.
 *
 * This is the mechanism that stops a combination looking wrong in a way no
 * contrast gate can catch. Instrument Serif italic on cyber-mint is a spa
 * brochure wearing a neon vest. Anton on blush-studio is a demolition notice on
 * a nail bar. Neither is unreadable, both are bad, so they are made
 * unrepresentable rather than merely discouraged.
 */
export function admissibleFonts(temperaments: readonly Temperament[]): FontKey[] {
  const out = FONT_KEYS.filter((k) => temperaments.includes(FONT_BANK[k].temperament));
  if (out.length === 0) throw new Error(`no admissible font for ${temperaments.join(',')}`);
  return out;
}

/**
 * Target cap height for the hook, in px. fontSize is derived from it per face.
 *
 * 54, down from 70. Measured across all sixteen hooks and all ten faces: at 70
 * the worst case wraps to three lines and a 331px block, at 54 nothing exceeds
 * two lines and 182px. That 149px is what pays for the top margin the hook needs
 * to survive a real feed. See the layout budget in geometry.ts.
 */
export const HOOK_CAP_PX = 54;
/** Target cap height for the end card headline. */
export const CTA_CAP_PX = 58;

/**
 * Per-variant type scale. Multiplied into BOTH cap targets above.
 *
 * WHY IT ONLY GOES DOWN. 54 is a ceiling, not a midpoint. The two-line guarantee
 * and the 190px hook box were both derived AT 54 with 8px of slack, so scaling
 * up breaks the layout budget in geometry.ts. Scaling down is free and provably
 * safe in both directions that matter: smaller type fits MORE characters per
 * line, so line count can only fall, and a shorter block always fits a box
 * measured for a taller one.
 *
 * 0.86 is the floor because below it the smallest face (Anton, which derives
 * 54px at cap 46) starts closing on its own minSize of 48, and a clamped face
 * silently stops varying while every test still passes. Asserted, not assumed:
 * see the no-face-clamps test in plan.test.ts.
 *
 * ONE scale drives both the hook and the end card on purpose. Independent scales
 * would give a video a big hook and a small end card, which reads as a mistake.
 * Moving them together reads as a deliberate typographic choice, which is the
 * whole point of varying it at all.
 */
export const TYPE_SCALE_MIN = 0.86;
export const TYPE_SCALE_MAX = 1;

/** The font size that gives this face the target cap height. */
export function sizeForCap(spec: FontSpec, capPx: number): number {
  return Math.round((capPx * spec.capScale) / metrics(spec.key).capHeightEm);
}

/**
 * Break text into lines that fit a column, using the face's own metrics.
 *
 * Deliberately done from a metrics table rather than by measuring in the
 * browser. Browser text measurement is exact but is only available inside the
 * render, which would put line breaking outside the reach of the test suite and
 * make it depend on the Chromium build. A metrics estimate that both the test
 * and the renderer agree on is worth more here than an exact number only one of
 * them can see, and the estimate is only used to REJECT hooks that are too long,
 * with real wrapping left to the browser at render time.
 */
export function estimateLines(
  text: string,
  spec: FontSpec,
  fontSize: number,
  columnPx: number,
): string[] {
  const perChar = metrics(spec.key).avgAdvanceEm * fontSize;
  const maxChars = Math.max(1, Math.floor(columnPx / perChar));
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    // A word longer than the whole line has to be broken, or it becomes one
    // enormous line that the caller then reads as "fits in one line". That is
    // how a 400 character string reported a clean fit at 96px.
    let w = word;
    while (w.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Largest size at or below the cap-height target that fits in `maxLines`.
 * Returns null when the text cannot fit even at the face's minimum size, which
 * is a rejection, not a fallback.
 */
export function fitHook(
  text: string,
  spec: FontSpec,
  columnPx: number,
  maxLines = HOOK_MAX_LINES,
  capPx = HOOK_CAP_PX,
): { fontSize: number; lines: string[] } | null {
  // Clamped up to minSize, exactly as TextBlock does when it renders. Without
  // the clamp the two disagree: a face whose cap-derived size falls below its
  // own floor gives fitHook an empty loop, so it returns null and reports a
  // perfectly good hook as unfittable, while the renderer would have drawn it
  // happily at the floor.
  const start = Math.max(spec.minSize, sizeForCap(spec, capPx));
  for (let size = start; size >= spec.minSize; size -= 2) {
    const lines = estimateLines(text, spec, size, columnPx);
    if (lines.length <= maxLines) return { fontSize: size, lines };
  }
  return null;
}
