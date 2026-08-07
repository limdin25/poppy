// archetypes.ts: the background generator.
//
// THE ONE STRUCTURAL IDEA. Every archetype compiles down to the same small
// model: one base RAMP plus a list of radial BLOBS. There is then exactly one
// function that turns a model into CSS, and exactly one that samples a model
// analytically at a pixel. They cannot drift, because there are not two
// descriptions of the background to keep in step. Adding an archetype means
// adding one builder, not a matching pair of renderer and sampler.
//
// WHY THE SAMPLER HAS TO EXIST AT ALL. The hook sits on a gradient, sometimes
// with a glow behind it. "Does the ink pass on the canvas colour" is the wrong
// question; the right one is "does the ink pass on the worst pixel actually
// under the text". colorAt() is what lets the gate ask that, in node, without
// rendering a frame.
//
// WHY 21 STOPS. CSS gradients interpolate in sRGB. An OKLCH ramp emitted as
// three sRGB stops does not survive that: a navy to sky ramp visibly passes
// through a dead purple. Computing the ramp in OKLCH and emitting 21 sRGB stops
// at 5 percent intervals tracks the true ramp to under one JND, makes the
// sampler an exact piecewise lerp of the same stops, and is smooth enough that
// x264 does not band it.

import { CANVAS, type Point } from './geometry';
import {
  antiMud,
  type Palette,
} from './palettes';
import {
  easeInOutSine,
  hexToRgb,
  oklchLerp,
  toHex,
  type Oklch,
  type Rgb,
} from './oklch';

export type ArchetypeKey =
  | 'linearTriStop'
  | 'meshDual'
  | 'duotoneDiagonal'
  | 'spotlightVignette'
  | 'haloArc'
  | 'bandStack'
  | 'conicSweep';

export const ARCHETYPE_KEYS: ArchetypeKey[] = [
  'linearTriStop',
  'meshDual',
  'duotoneDiagonal',
  'spotlightVignette',
  'haloArc',
  'bandStack',
  'conicSweep',
];

/** Seeded numbers for one archetype. Flat and JSON-serialisable on purpose. */
export type ArchetypeParams = Record<string, number>;

// --- the model ---------------------------------------------------------------

interface Stop {
  /** 0 to 1 along the gradient. */
  readonly pos: number;
  readonly hex: string;
}

type Ramp =
  | { readonly kind: 'linear'; readonly angleDeg: number; readonly stops: Stop[] }
  | {
      readonly kind: 'conic';
      readonly fromDeg: number;
      readonly cx: number;
      readonly cy: number;
      readonly stops: Stop[];
    }
  | {
      readonly kind: 'bands';
      readonly splitY: number;
      readonly above: string;
      readonly below: string;
    };

/**
 * A radial layer.
 *
 * `profile` covers all three shapes the archetypes need:
 *  - blob:     brightest at the centre, zero at `edge`
 *  - ring:     zero at `inner`, peak halfway, zero at `edge`
 *  - vignette: zero at `inner`, rising to full at `edge` and staying there
 *
 * Distances are normalised elliptical: 1.0 means "on the rx/ry ellipse".
 */
interface Blob {
  readonly profile: 'blob' | 'ring' | 'vignette';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly inner: number;
  readonly edge: number;
  readonly hex: string;
  readonly alpha: number;
}

export interface BgModel {
  readonly ramp: Ramp;
  readonly blobs: Blob[];
  /** Overlay grain strength. Always non-zero. See GRAIN below. */
  readonly grainAlpha: number;
}

// --- ramps -------------------------------------------------------------------

const RAMP_STOPS = 21;

/**
 * An OKLCH ramp emitted as sRGB stops.
 *
 * The ease is not decoration. A linear ramp reads flat; an eased one reads lit,
 * because real light does not fall off linearly.
 */
function ramp(a: Oklch, b: Oklch, n = RAMP_STOPS): Stop[] {
  const stops: Stop[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    stops.push({ pos: t, hex: toHex(antiMud(oklchLerp(a, b, easeInOutSine(t)))) });
  }
  return stops;
}

/** Three-part ramp: deep to canvas to lift, with the middle stop movable. */
function triRamp(deep: Oklch, mid: Oklch, lift: Oklch, midPos: number): Stop[] {
  const lower = ramp(deep, mid, 11).map((s) => ({ pos: s.pos * midPos, hex: s.hex }));
  const upper = ramp(mid, lift, 11)
    .slice(1)
    .map((s) => ({ pos: midPos + s.pos * (1 - midPos), hex: s.hex }));
  return [...lower, ...upper];
}

/**
 * Position along a CSS linear gradient at a point.
 *
 * This is the CSS spec's own construction: 0deg points up, angles increase
 * clockwise, and the gradient line is long enough to cover the box corners.
 * Getting this wrong would not throw, it would just make the sampler quietly
 * disagree with what the browser paints, which is the worst kind of bug here.
 */
function linearT(angleDeg: number, p: Point): number {
  const a = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const len = Math.abs(CANVAS.w * sin) + Math.abs(CANVAS.h * cos);
  const dx = p.x - CANVAS.w / 2;
  const dy = p.y - CANVAS.h / 2;
  return 0.5 + (dx * sin - dy * cos) / len;
}

function conicT(fromDeg: number, cx: number, cy: number, p: Point): number {
  const ang = (Math.atan2(p.x - cx, -(p.y - cy)) * 180) / Math.PI;
  let rel = (ang - fromDeg) % 360;
  if (rel < 0) rel += 360;
  return rel / 360;
}

/** Lerp between the two bracketing stops, in sRGB, exactly as CSS does. */
function stopAt(stops: Stop[], t: number): Rgb {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  if (k <= stops[0].pos) return hexToRgb(stops[0].hex);
  const last = stops[stops.length - 1];
  if (k >= last.pos) return hexToRgb(last.hex);
  for (let i = 1; i < stops.length; i++) {
    if (k <= stops[i].pos) {
      const a = stops[i - 1];
      const b = stops[i];
      const f = b.pos === a.pos ? 0 : (k - a.pos) / (b.pos - a.pos);
      const ca = hexToRgb(a.hex);
      const cb = hexToRgb(b.hex);
      return {
        r: ca.r + (cb.r - ca.r) * f,
        g: ca.g + (cb.g - ca.g) * f,
        b: ca.b + (cb.b - ca.b) * f,
      };
    }
  }
  return hexToRgb(last.hex);
}

// --- blob alpha --------------------------------------------------------------

function blobAlpha(b: Blob, d: number): number {
  if (b.profile === 'blob') {
    return d >= b.edge ? 0 : b.alpha * (1 - d / b.edge);
  }
  if (b.profile === 'ring') {
    const mid = (b.inner + b.edge) / 2;
    if (d <= b.inner || d >= b.edge) return 0;
    return d < mid
      ? (b.alpha * (d - b.inner)) / (mid - b.inner)
      : (b.alpha * (b.edge - d)) / (b.edge - mid);
  }
  if (d <= b.inner) return 0;
  if (d >= b.edge) return b.alpha;
  return (b.alpha * (d - b.inner)) / (b.edge - b.inner);
}

// --- sampling ----------------------------------------------------------------

function rampRgb(ramp: Ramp, p: Point): Rgb {
  if (ramp.kind === 'linear') return stopAt(ramp.stops, linearT(ramp.angleDeg, p));
  if (ramp.kind === 'conic') return stopAt(ramp.stops, conicT(ramp.fromDeg, ramp.cx, ramp.cy, p));
  return hexToRgb(p.y < ramp.splitY ? ramp.above : ramp.below);
}

const hex2 = (n: number): string =>
  Math.round(Math.min(1, Math.max(0, n)) * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * The composited background colour at a pixel, as hex.
 *
 * Compositing is done in display sRGB, which is what the browser actually does
 * for gradient layers. Doing it in OKLCH would have been tidier and would have
 * disagreed with the render by a point or two of contrast, which is exactly the
 * margin the gate is measuring.
 */
export function colorAt(model: BgModel, p: Point): string {
  let out = rampRgb(model.ramp, p);
  for (const b of model.blobs) {
    const dx = (p.x - b.cx) / b.rx;
    const dy = (p.y - b.cy) / b.ry;
    const d = Math.sqrt(dx * dx + dy * dy);
    const a = blobAlpha(b, d);
    if (a <= 0) continue;
    const src = hexToRgb(b.hex);
    out = {
      r: src.r * a + out.r * (1 - a),
      g: src.g * a + out.g * (1 - a),
      b: src.b * a + out.b * (1 - a),
    };
  }
  return `#${hex2(out.r)}${hex2(out.g)}${hex2(out.b)}`;
}

/** Sample many points at once. */
export function sampleAt(model: BgModel, points: readonly Point[]): string[] {
  return points.map((p) => colorAt(model, p));
}

// --- CSS ---------------------------------------------------------------------

const rgba = (hex: string, a: number): string => {
  const { r, g, b } = hexToRgb(hex);
  // Always carry the SAME rgb into the zero-alpha stop. The `transparent`
  // keyword is transparent BLACK, and interpolating toward it darkens the
  // midpoint of every glow, which reads as a dirty smudge on a light canvas.
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a.toFixed(4)})`;
};

function blobCss(b: Blob): string {
  const pos = `at ${b.cx.toFixed(1)}px ${b.cy.toFixed(1)}px`;
  const size = `${b.rx.toFixed(1)}px ${b.ry.toFixed(1)}px`;
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  if (b.profile === 'blob') {
    return `radial-gradient(${size} ${pos}, ${rgba(b.hex, b.alpha)} 0%, ${rgba(b.hex, 0)} ${pct(b.edge)})`;
  }
  if (b.profile === 'ring') {
    const mid = (b.inner + b.edge) / 2;
    return `radial-gradient(${size} ${pos}, ${rgba(b.hex, 0)} ${pct(b.inner)}, ${rgba(b.hex, b.alpha)} ${pct(mid)}, ${rgba(b.hex, 0)} ${pct(b.edge)})`;
  }
  return `radial-gradient(${size} ${pos}, ${rgba(b.hex, 0)} ${pct(b.inner)}, ${rgba(b.hex, b.alpha)} ${pct(b.edge)})`;
}

function rampCss(ramp: Ramp): string {
  const list = (stops: Stop[]) =>
    stops.map((s) => `${s.hex} ${(s.pos * 100).toFixed(2)}%`).join(', ');
  if (ramp.kind === 'linear') return `linear-gradient(${ramp.angleDeg}deg, ${list(ramp.stops)})`;
  if (ramp.kind === 'conic') {
    return `conic-gradient(from ${ramp.fromDeg.toFixed(2)}deg at ${ramp.cx.toFixed(1)}px ${ramp.cy.toFixed(1)}px, ${ramp.stops
      .map((s) => `${s.hex} ${(s.pos * 360).toFixed(2)}deg`)
      .join(', ')})`;
  }
  const p = ((ramp.splitY / CANVAS.h) * 100).toFixed(3);
  return `linear-gradient(180deg, ${ramp.above} 0%, ${ramp.above} ${p}%, ${ramp.below} ${p}%, ${ramp.below} 100%)`;
}

/**
 * The `background` shorthand value. Layers are listed top first, which is why
 * the blobs come before the ramp.
 */
export function toCss(model: BgModel): string {
  return [...model.blobs.map(blobCss), rampCss(model.ramp)].join(', ');
}

/**
 * Grain, and it is a MODIFIER rather than a choice, so it has no key and cannot
 * be switched off by the seed.
 *
 * Two reasons it is mandatory. A 1080x1920 gradient bands visibly under h264,
 * and banding is the single clearest tell of a cheap render, which directly
 * contradicts the brief. And grain is most of what separates a flat CSS
 * gradient from something that reads as photographed.
 *
 * NEVER animate it per frame. Static grain compresses almost for free; grain
 * that changes every frame destroys inter-frame prediction and roughly triples
 * the file size for no visible gain at this resolution.
 */
export const GRAIN = {
  /** Baked once at module scope, never regenerated per frame. */
  dataUri:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='128' height='128' filter='url(%23n)'/%3E%3C/svg%3E\")",
  tile: 128,
  darkAlpha: 0.045,
  lightAlpha: 0.03,
} as const;

// --- the archetypes ----------------------------------------------------------

const pick = <T>(next: () => number, items: readonly T[]): T =>
  items[Math.min(items.length - 1, Math.floor(next() * items.length))];

const between = (next: () => number, lo: number, hi: number): number =>
  lo + next() * (hi - lo);

export interface Archetype {
  readonly key: ArchetypeKey;
  /** Which palette modes this archetype is allowed on. */
  readonly modes: readonly ('dark' | 'light')[];
  readonly params: (next: () => number) => ArchetypeParams;
  readonly build: (p: Palette, params: ArchetypeParams) => BgModel;
  readonly note: string;
}

const grainFor = (p: Palette): number =>
  p.mode === 'dark' ? GRAIN.darkAlpha : GRAIN.lightAlpha;

export const ARCHETYPES: Record<ArchetypeKey, Archetype> = {
  linearTriStop: {
    key: 'linearTriStop',
    modes: ['dark', 'light'],
    // Near-vertical only. A diagonal linear gradient on a 9:16 canvas fights the
    // phone's vertical axis and instantly reads as a stock template.
    params: (next) => ({
      angle: pick(next, [156, 168, 180, 192, 204]),
      midPos: between(next, 0.42, 0.58),
    }),
    build: (p, q) => ({
      ramp: {
        kind: 'linear',
        angleDeg: q.angle,
        stops: triRamp(p.canvasDeep, p.canvas, p.canvasLift, q.midPos),
      },
      blobs: [],
      grainAlpha: grainFor(p),
    }),
    note: 'A clean vertical ramp. The one that never gets in the way.',
  },

  meshDual: {
    key: 'meshDual',
    modes: ['dark', 'light'],
    // Glow centres live in the SIDE MARGINS, not merely "low".
    //
    // The first version pushed both glows below 55 percent of the canvas height
    // and assumed that put them clear of the phone. It does not: the phone runs
    // from y 380 to y 1688, which is 68 percent of the canvas, so "low" is still
    // squarely behind the device. The phone leaves 166px of margin on each side,
    // so that is where a glow can actually be seen. Placing them there also
    // reads better: it is two-point rim lighting rather than a blob behind the
    // subject.
    params: (next) => ({
      ax: between(next, 0.03, 0.13),
      ay: between(next, 0.55, 0.88),
      bx: between(next, 0.87, 0.97),
      by: between(next, 0.6, 0.92),
      aAlpha: between(next, 0.26, 0.36),
      bAlpha: between(next, 0.36, 0.5),
    }),
    build: (p, q) => ({
      ramp: {
        kind: 'linear',
        angleDeg: 180,
        stops: ramp(p.canvasDeep, p.canvas),
      },
      blobs: [
        {
          profile: 'blob',
          cx: q.ax * CANVAS.w,
          cy: q.ay * CANVAS.h,
          rx: CANVAS.w * 0.72,
          ry: CANVAS.h * 0.46,
          inner: 0,
          edge: 0.68,
          hex: toHex(p.accent),
          alpha: q.aAlpha,
        },
        {
          profile: 'blob',
          cx: q.bx * CANVAS.w,
          cy: q.by * CANVAS.h,
          rx: CANVAS.w * 0.64,
          ry: CANVAS.h * 0.4,
          inner: 0,
          edge: 0.72,
          hex: toHex(p.canvasLift),
          alpha: q.bAlpha,
        },
      ],
      grainAlpha: grainFor(p),
    }),
    note: 'Two soft glows low behind the phone. The best looking one.',
  },

  duotoneDiagonal: {
    key: 'duotoneDiagonal',
    modes: ['dark', 'light'],
    // The split is placed by choosing the y it passes through at the canvas
    // centre line, and that y is forced to 700 or lower on the screen. So the
    // split always crosses BEHIND the phone, never through the hook, which is
    // also where it looks deliberate rather than accidental.
    params: (next) => ({
      angle: pick(next, [104, 112, 120, 128]),
      crossY: between(next, 700, 1050),
      feather: between(next, 0.05, 0.11),
    }),
    build: (p, q) => {
      const split = linearT(q.angle, { x: CANVAS.w / 2, y: q.crossY });
      const half = q.feather / 2;
      const lo = Math.max(0.02, split - half);
      const hi = Math.min(0.98, split + half);
      const deep = toHex(p.canvasDeep);
      const lift = toHex(p.canvasLift);
      const feather = ramp(p.canvasDeep, p.canvasLift, 9).map((s) => ({
        pos: lo + s.pos * (hi - lo),
        hex: s.hex,
      }));
      return {
        ramp: {
          kind: 'linear',
          angleDeg: q.angle,
          stops: [{ pos: 0, hex: deep }, ...feather, { pos: 1, hex: lift }],
        },
        blobs: [],
        grainAlpha: grainFor(p),
      };
    },
    note: 'A feathered diagonal split passing behind the phone.',
  },

  spotlightVignette: {
    key: 'spotlightVignette',
    modes: ['dark', 'light'],
    params: (next) => ({
      strength: between(next, 0.55, 0.82),
      spotR: between(next, 0.78, 0.94),
      spotAlpha: between(next, 0.4, 0.6),
    }),
    build: (p, q) => ({
      ramp: { kind: 'linear', angleDeg: 180, stops: ramp(p.canvas, p.canvas, 2) },
      blobs: [
        {
          profile: 'blob',
          cx: CANVAS.w * 0.5,
          cy: CANVAS.h * 0.54,
          rx: CANVAS.w * q.spotR,
          ry: CANVAS.h * 0.52,
          inner: 0,
          edge: 0.74,
          hex: toHex(p.canvasLift),
          alpha: q.spotAlpha,
        },
        {
          profile: 'vignette',
          cx: CANVAS.w * 0.5,
          cy: CANVAS.h * 0.5,
          rx: CANVAS.w * 1.4,
          ry: CANVAS.h * 1.0,
          inner: 0.38,
          edge: 1,
          hex: toHex(p.canvasDeep),
          alpha: q.strength,
        },
      ],
      grainAlpha: grainFor(p),
    }),
    note: 'Studio spotlight with a soft vignette. The conservative default.',
  },

  haloArc: {
    key: 'haloArc',
    modes: ['dark', 'light'],
    // The core of the ring is transparent on purpose. A filled glow behind the
    // phone backlights it into a silhouette and the device disappears.
    //
    // The ring is a WIDE FLAT ELLIPSE (ry is half rx), not a circle. A circular
    // halo big enough to frame a 1308px tall phone reaches straight up through
    // the hook and wrecks its contrast, which is what the hook-flatness test
    // caught. Flattened and pushed down, it frames the lower half of the device
    // and never comes near the text.
    params: (next) => ({
      rx: between(next, 800, 900),
      alpha: between(next, 0.22, 0.34),
      cy: between(next, 0.6, 0.68),
    }),
    build: (p, q) => ({
      ramp: { kind: 'linear', angleDeg: 178, stops: ramp(p.canvasDeep, p.canvas) },
      blobs: [
        {
          profile: 'ring',
          cx: CANVAS.w * 0.5,
          cy: CANVAS.h * q.cy,
          rx: q.rx,
          ry: q.rx * 0.5,
          // Peak sits exactly on the rx/ry ellipse, band reaching 0.72 to 1.28.
          inner: 0.72,
          edge: 1.28,
          hex: toHex(p.accent),
          alpha: q.alpha,
        },
      ],
      grainAlpha: grainFor(p),
    }),
    note: 'An accent ring behind the phone. Reads as an AI product shot.',
  },

  bandStack: {
    key: 'bandStack',
    // Light families only. A hard band on a dark background reads as a broken
    // render rather than as an editorial choice.
    modes: ['light'],
    params: (next) => ({ split: between(next, 0.28, 0.36) }),
    build: (p, q) => ({
      ramp: {
        kind: 'bands',
        splitY: q.split * CANVAS.h,
        above: toHex(p.canvasLift),
        below: toHex(p.canvas),
      },
      blobs: [],
      grainAlpha: grainFor(p),
    }),
    note: 'Swiss editorial bands. Light families only.',
  },

  conicSweep: {
    key: 'conicSweep',
    modes: ['dark', 'light'],
    // Amplitude is capped hard. A high-amplitude conic looks like a Windows 95
    // screensaver; at low amplitude it is a beautiful soft studio sweep. The
    // centre is forced low so the sweep sits behind and below the phone.
    params: (next) => ({
      from: between(next, 0, 360),
      cy: between(next, 0.64, 0.78),
      amp: between(next, 0.03, 0.1),
    }),
    build: (p, q) => {
      const lo: Oklch = { ...p.canvas, L: p.canvas.L - q.amp / 2 };
      const hi: Oklch = { ...p.canvas, L: p.canvas.L + q.amp / 2 };
      const quarter = ramp(hi, lo, 7);
      const back = ramp(lo, hi, 7).slice(1);
      const half = [...quarter, ...back].map((s, i, arr) => ({
        pos: i / (arr.length - 1) / 2,
        hex: s.hex,
      }));
      const mirror = half
        .slice(0, -1)
        .reverse()
        .map((s, i, arr) => ({ pos: 0.5 + (i + 1) / (arr.length + 1) / 2, hex: s.hex }));
      return {
        ramp: {
          kind: 'conic',
          fromDeg: q.from,
          cx: CANVAS.w * 0.5,
          cy: CANVAS.h * q.cy,
          stops: [...half, ...mirror, { pos: 1, hex: half[0].hex }],
        },
        blobs: [],
        grainAlpha: grainFor(p),
      };
    },
    note: 'A low-amplitude conic sweep. Soft studio light.',
  },
};

/** Which archetypes a palette family may use. */
export function admissibleArchetypes(mode: 'dark' | 'light'): ArchetypeKey[] {
  return ARCHETYPE_KEYS.filter((k) => ARCHETYPES[k].modes.includes(mode));
}
