// contrast.ts: the readability gate. Pure, no deps.
//
// TWO METRICS, AND APCA IS THE ONE WE ENFORCE.
//
// WCAG 2.1 defines "large text" as >= 18.66px bold and lets it pass at 3:1. Our
// hook runs around 96px at weight 800, so a 3:1 threshold would wave through
// combinations that wash out on a phone held at arm's length in daylight. That
// is precisely the failure this system exists to make impossible. WCAG 2.1 also
// systematically misjudges light-on-dark, and 9 of our 14 palette families are
// light-on-dark.
//
// APCA is polarity aware and scales with size and weight, which is what we
// actually need. We enforce APCA and keep WCAG as a secondary floor, because
// WCAG is the number anyone auditing the output will reach for first.
//
// APCA implementation is APCA-W3 0.1.9 (the version referenced by WCAG 3
// drafts). The constants below are that specification's, not tuned by us.
// Do not "clean them up".

import { hexToRgb, type Rgb } from './oklch';

// --- APCA-W3 0.1.9 constants -------------------------------------------------
const MAIN_TRC = 2.4;
const R_CO = 0.2126729;
const G_CO = 0.7151522;
const B_CO = 0.072175;

const NORM_BG = 0.56;
const NORM_TXT = 0.57;
const REV_TXT = 0.62;
const REV_BG = 0.65;

const BLK_THRS = 0.022;
const BLK_CLMP = 1.414;
const SCALE_BOW = 1.14;
const SCALE_WOB = 1.14;
const LO_BOW_OFFSET = 0.027;
const LO_WOB_OFFSET = 0.027;
const DELTA_Y_MIN = 0.0005;
const LO_CLIP = 0.1;

/** APCA's own screen luminance. Note this is NOT the WCAG relative luminance. */
function apcaY({ r, g, b }: Rgb): number {
  return (
    R_CO * Math.pow(r, MAIN_TRC) + G_CO * Math.pow(g, MAIN_TRC) + B_CO * Math.pow(b, MAIN_TRC)
  );
}

/**
 * APCA lightness contrast, Lc.
 *
 * Sign carries polarity: POSITIVE for dark text on a light background, NEGATIVE
 * for light text on a dark background. Callers almost always want the absolute
 * value, so use apcaLc() below unless you specifically need the polarity.
 */
export function apcaContrastSigned(textRgb: Rgb, bgRgb: Rgb): number {
  let txtY = apcaY(textRgb);
  let bgY = apcaY(bgRgb);

  // Soft clamp near black. Without this, two very dark colours report an
  // enormous contrast that nobody can actually see on a real display.
  txtY = txtY > BLK_THRS ? txtY : txtY + Math.pow(BLK_THRS - txtY, BLK_CLMP);
  bgY = bgY > BLK_THRS ? bgY : bgY + Math.pow(BLK_THRS - bgY, BLK_CLMP);

  if (Math.abs(bgY - txtY) < DELTA_Y_MIN) return 0;

  let out: number;
  if (bgY > txtY) {
    // dark text on light background
    const sapc = (Math.pow(bgY, NORM_BG) - Math.pow(txtY, NORM_TXT)) * SCALE_BOW;
    out = sapc < LO_CLIP ? 0 : sapc - LO_BOW_OFFSET;
  } else {
    // light text on dark background
    const sapc = (Math.pow(bgY, REV_BG) - Math.pow(txtY, REV_TXT)) * SCALE_WOB;
    out = sapc > -LO_CLIP ? 0 : sapc + LO_WOB_OFFSET;
  }
  return out * 100;
}

/** Absolute APCA Lc, which is what every threshold in this project is stated in. */
export function apcaLc(textHex: string, bgHex: string): number {
  return Math.abs(apcaContrastSigned(hexToRgb(textHex), hexToRgb(bgHex)));
}

// --- WCAG 2.1 ----------------------------------------------------------------

const wcagChannel = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * wcagChannel(r) + 0.7152 * wcagChannel(g) + 0.0722 * wcagChannel(b);
}

/** WCAG 2.1 contrast ratio, 1 to 21. Order of arguments does not matter. */
export function wcagRatio(aHex: string, bHex: string): number {
  const la = relativeLuminance(hexToRgb(aHex));
  const lb = relativeLuminance(hexToRgb(bHex));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// --- The enforced thresholds -------------------------------------------------

/**
 * Every text role in the factory and the floor it must clear.
 *
 * The APCA floors sit ABOVE the specification's own minimum for large text
 * (Lc 45) on purpose. This is advertising, not a document, and it has to read
 * on a phone in sunlight at thumbnail scale. The designed families clear these
 * by 8 to 32 points, so a failure is an ASSERTION THAT SHOULD NEVER FIRE, not a
 * search that is expected to iterate. That distinction is the architecture.
 */
export interface TextRole {
  /** Human name, used in the failure message so a red test says what broke. */
  readonly label: string;
  /** Enforced APCA floor, absolute Lc. */
  readonly minLc: number;
  /** Secondary WCAG 2.1 floor. */
  readonly minWcag: number;
}

export const TEXT_ROLES = {
  /** The rotating hook, 76 to 108px at weight 700 to 900. */
  hook: { label: 'hook display text', minLc: 60, minWcag: 4.5 },
  /** End card headline, 64 to 84px at weight 700 to 800. */
  ctaHeadline: { label: 'end card headline', minLc: 60, minWcag: 4.5 },
  /** End card body and LINK IN BIO, 34 to 44px at weight 500 to 600. Smaller
   *  text needs MORE contrast, which is exactly what WCAG 2.1 gets backwards. */
  ctaBody: { label: 'end card body', minLc: 75, minWcag: 4.5 },
  /** Near-black label sitting on an accent pill. */
  onAccent: { label: 'text on accent pill', minLc: 60, minWcag: 4.5 },
} as const satisfies Record<string, TextRole>;

export type TextRoleKey = keyof typeof TEXT_ROLES;

/**
 * Grain is a mandatory overlay and it cannot be modelled analytically, so every
 * gate measurement carries this much uncertainty in luminance terms. We do not
 * subtract it from the sample, we require the sample to clear the floor with
 * this much margin already spent. Cheap insurance, one constant.
 */
export const GRAIN_L_UNCERTAINTY = 0.012;

export interface GateResult {
  readonly pass: boolean;
  /** The worst APCA Lc found across every sample. */
  readonly worstLc: number;
  /** The worst WCAG ratio found across every sample. */
  readonly worstWcag: number;
  /** Hex of the background sample that produced the worst reading. */
  readonly worstAgainst: string;
}

/**
 * Test one text colour against MANY background samples and report the worst.
 *
 * The hook sits on a gradient, possibly with a glow behind it, so the right
 * question is never "does ink pass on the nominal canvas colour" but "does ink
 * pass on the worst pixel actually under the text". Callers pass the sampled
 * grid; this function does not know or care where the samples came from.
 */
export function gateText(
  textHex: string,
  bgSamples: readonly string[],
  role: TextRole,
): GateResult {
  if (bgSamples.length === 0) {
    throw new Error(`gateText called with no background samples for ${role.label}`);
  }
  let worstLc = Infinity;
  let worstWcag = Infinity;
  let worstAgainst = bgSamples[0];

  for (const bg of bgSamples) {
    const lc = apcaLc(textHex, bg);
    const ratio = wcagRatio(textHex, bg);
    if (lc < worstLc) {
      worstLc = lc;
      worstAgainst = bg;
    }
    if (ratio < worstWcag) worstWcag = ratio;
  }

  return {
    pass: worstLc >= role.minLc && worstWcag >= role.minWcag,
    worstLc,
    worstWcag,
    worstAgainst,
  };
}
