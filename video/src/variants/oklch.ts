// oklch.ts: colour maths for the variation factory. No dependencies, no Remotion,
// no DOM. Pure functions only, so the whole palette system is testable in node.
//
// WHY OKLCH AND NOT HSL. HSL lightness is a lie. hsl(240 100% 50%) and
// hsl(60 100% 50%) both claim 50% lightness and differ by roughly 8x in
// perceived luminance. Every "my generated palette looks awful" story starts
// there. OKLCH lightness is perceptually even, so a contrast rule expressed in
// L actually holds, and a jitter of +/-0.025 L looks like the same amount of
// change on a navy and on a cream.
//
// WHY CHROMA IS NEVER A FREE PARAMETER. The sRGB gamut boundary in OKLCH swings
// wildly with hue and lightness. Measured on this code: at L=0.60 a cyan (H200)
// holds C=0.102 and a pink (H330) holds C=0.274, a 2.7x spread. So a fixed
// "dC +/-0.02" is meaningless in one place and clipping garbage in another.
// Chroma is always REQUESTED, then clipped by maxChromaInSrgb() below.

export interface Oklch {
  /** Perceptual lightness, 0 (black) to 1 (white). */
  L: number;
  /** Chroma. 0 is grey. Useful values run 0 to about 0.32 inside sRGB. */
  C: number;
  /** Hue angle in degrees, 0 to 360. */
  H: number;
}

export interface Rgb {
  /** 0 to 1, linear-light sRGB is NOT what this holds. These are display values. */
  r: number;
  g: number;
  b: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Wrap a hue into 0..360. Negative inputs are fine. */
export function wrapHue(h: number): number {
  const m = h % 360;
  return m < 0 ? m + 360 : m;
}

/** Shortest angular distance between two hues, 0 to 180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(wrapHue(a) - wrapHue(b));
  return d > 180 ? 360 - d : d;
}

// sRGB transfer function and its inverse. These are the exact IEC 61966-2-1
// numbers, not the 2.2 gamma approximation, because the approximation drifts
// enough near black to move a contrast measurement by a point or two.
const toLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const fromLinear = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** OKLab to linear sRGB. Bjorn Ottosson's matrices. */
function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Linear sRGB to OKLab. */
function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Convert to display sRGB WITHOUT clamping. Values outside 0..1 mean the colour
 * is out of gamut. inGamut() reads this, so it must not clamp.
 */
function oklchToRawRgb(c: Oklch): [number, number, number] {
  const hRad = (wrapHue(c.H) * Math.PI) / 180;
  const a = c.C * Math.cos(hRad);
  const b = c.C * Math.sin(hRad);
  const [lr, lg, lb] = oklabToLinearRgb(c.L, a, b);
  return [fromLinear(lr), fromLinear(lg), fromLinear(lb)];
}

/**
 * Is this colour representable in sRGB? The epsilon absorbs float error at the
 * exact boundary, where a mathematically in-gamut colour can land at -1e-9.
 */
export function inGamut(c: Oklch): boolean {
  const [r, g, b] = oklchToRawRgb(c);
  const eps = 1e-6;
  return (
    r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps
  );
}

/**
 * The largest chroma that stays inside sRGB at this L and H, found by bisection.
 * L and H are preserved exactly, which is the whole point: naive RGB clamping
 * shifts hue and lightness as well as chroma, and shifting lightness is what
 * silently breaks a contrast guarantee that was checked before the clamp.
 *
 * 24 iterations resolves to about 1e-7 of chroma, far below a JND, and costs
 * nothing because this runs at plan time and never per frame.
 */
export function maxChromaInSrgb(L: number, H: number): number {
  if (L <= 0 || L >= 1) return 0;
  let lo = 0;
  let hi = 0.4; // no sRGB colour exceeds about 0.33 chroma in OKLCH
  if (inGamut({ L, C: hi, H })) return hi;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ L, C: mid, H })) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Pull chroma inside the gamut, keeping L and H exact.
 *
 * `headroom` defaults to 0.92 rather than 1.0 on purpose. Right at the gamut
 * wall at least one RGB channel is pinned at 0 or 255, and h264's 4:2:0 chroma
 * subsampling then produces visible edge crawl on saturated blues and reds.
 * Backing off 8% costs nothing anyone can see and removes the artifact.
 */
export function gamutClip(c: Oklch, headroom = 0.92): Oklch {
  const L = clamp01(c.L);
  const H = wrapHue(c.H);
  const ceiling = maxChromaInSrgb(L, H) * headroom;
  return { L, C: Math.min(Math.max(0, c.C), ceiling), H };
}

/** Display-referred sRGB in 0..1, clamped. Call gamutClip first if you care. */
export function oklchToRgb(c: Oklch): Rgb {
  const [r, g, b] = oklchToRawRgb(c);
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

const hex2 = (n: number): string =>
  Math.round(clamp01(n) * 255)
    .toString(16)
    .padStart(2, '0');

/** Lowercase 6-digit hex, always with a leading hash. */
export function toHex(c: Oklch): string {
  const { r, g, b } = oklchToRgb(c);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Parse #rgb or #rrggbb. Throws on anything else, because a silent black is worse. */
export function hexToRgb(hex: string): Rgb {
  const s = hex.trim().replace(/^#/, '');
  const full =
    s.length === 3
      ? s
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`bad hex: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

/** Hex to OKLCH. Round-trips with toHex to within a quantisation step. */
export function hexToOklch(hex: string): Oklch {
  const { r, g, b } = hexToRgb(hex);
  const [L, a, bb] = linearRgbToOklab(toLinear(r), toLinear(g), toLinear(b));
  const C = Math.sqrt(a * a + bb * bb);
  // Below this chroma the hue angle is numerical noise, so pin it rather than
  // let a near-grey report a meaningless hue that a separation test then reads.
  const H = C < 1e-6 ? 0 : wrapHue((Math.atan2(bb, a) * 180) / Math.PI);
  return { L, C, H };
}

/**
 * Interpolate in OKLCH, taking the SHORT way round the hue circle.
 * Going the long way is how a navy-to-sky ramp ends up passing through green.
 */
export function oklchLerp(a: Oklch, b: Oklch, t: number): Oklch {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  let dh = wrapHue(b.H) - wrapHue(a.H);
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    L: a.L + (b.L - a.L) * k,
    C: a.C + (b.C - a.C) * k,
    H: wrapHue(a.H + dh * k),
  };
}

/**
 * Perceptual distance, the OKLab dE. Under about 0.02 is invisible.
 * Used by the test that proves a hex round trip did not silently clamp.
 */
export function deltaE(a: Oklch, b: Oklch): number {
  const ar = (wrapHue(a.H) * Math.PI) / 180;
  const br = (wrapHue(b.H) * Math.PI) / 180;
  const dL = a.L - b.L;
  const da = a.C * Math.cos(ar) - b.C * Math.cos(br);
  const db = a.C * Math.sin(ar) - b.C * Math.sin(br);
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** Ease used by every gradient ramp. Linear ramps read flat, eased ones read lit. */
export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
