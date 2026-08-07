// palettes.ts: the ONE place a colour scheme is defined. Everything downstream
// (background archetypes, the hook band, the phone rim light, the end card)
// reads from here and derives nothing of its own.
//
// THE SHAPE OF THE PROBLEM. Free-random hue is what makes generated palettes
// look cheap: it produces clashes no amount of contrast checking can rescue. So
// hue is never free. There are 14 hand-tuned FAMILIES, each a known-good anchor,
// and the seed picks a family and then jitters inside bounds that provably
// cannot walk one family into another.
//
// WHAT JITTER IS FOR, AND WHAT IT IS NOT FOR. Jitter exists so that four
// variants sharing a family do not look copy-pasted side by side. It contributes
// NOTHING to how many distinct-looking videos this system can make. That number
// comes from the decks in plan.ts and is bounded by the family count. Anyone who
// widens these bounds "to get more variety" has misunderstood the design and
// will get mud instead. The lever is more families, not louder jitter.
//
// EVERY VALUE HERE IS MEASURED. The contrast figures in the comments came out of
// palettes.test.ts, not out of anyone's head. If you edit an anchor, run the
// tests and update the comment with what they print.

import {
  gamutClip,
  hexToOklch,
  toHex,
  wrapHue,
  type Oklch,
} from './oklch';

// The phone bezel, and the reason the rim light exists. Measured L = 0.149.
export const BEZEL_HEX = '#0a0b0d';
export const BEZEL_L = hexToOklch(BEZEL_HEX).L;

/**
 * The label colour that sits on an accent pill.
 *
 * This is a CONSTANT rather than a per-family field, and that is provable rather
 * than lucky: accentFill is always forced to L >= 0.78 (see ACCENT_FILL_MIN_L),
 * so a near-black always clears the contrast floor on it. Measured 71.8 on the
 * worst accent in the bank and 85.2 on the best. One less thing to get wrong.
 */
export const ON_ACCENT_HEX = '#0d0d0f';

/**
 * accentFill is forced at least this light. This is what makes ON_ACCENT_HEX safe.
 *
 * 0.79 rather than 0.78 buys one step of headroom above the olive-band threshold
 * in antiMud. At exactly 0.78 an amber fill round-trips through hex to 0.77998
 * and then trips the very rule it was built to satisfy.
 */
export const ACCENT_FILL_MIN_L = 0.79;
/** accentInk is forced at most this dark, so it can carry text on light canvases. */
export const ACCENT_INK_MAX_L = 0.5;

// --- harmonies ---------------------------------------------------------------

/**
 * How the accent hue moves relative to its family anchor.
 *
 * Deliberately small. A true complementary accent was tried and rejected: a
 * green family with a red accent is a Christmas tree, and no contrast gate
 * catches "tasteless". These three offsets give up to three usable accents per
 * family while staying inside the family's own colour story.
 */
export const HARMONY_OFFSETS = {
  anchor: 0,
  analogousWarm: 22,
  analogousCool: -22,
} as const;

export type HarmonyKey = keyof typeof HARMONY_OFFSETS;

// --- the family definition ---------------------------------------------------

export type FamilyKey =
  | 'obsidian-citrus'
  | 'champagne-noir'
  | 'molten-graphite'
  | 'cyber-mint'
  | 'sunset-foil'
  | 'ultraviolet'
  | 'ink-signal'
  | 'emerald-vault'
  | 'cobalt-glass'
  | 'arctic-steel'
  | 'blush-studio'
  | 'sea-glass'
  | 'vermilion-cut'
  | 'bone-ink';

/** Which typefaces suit a family. See fonts.ts for what each one means. */
export type Temperament = 'neutral' | 'brutal' | 'techno' | 'editorial';

export interface JitterBounds {
  readonly L: number;
  readonly C: number;
  readonly H: number;
}

export interface PaletteFamily {
  readonly key: FamilyKey;
  /** Drives which archetypes are allowed and how strong the rim light starts. */
  readonly mode: 'dark' | 'light';
  /** The large field the phone sits on. */
  readonly canvas: Oklch;
  /** The only text colour by default. Never the accent. */
  readonly ink: Oklch;
  /**
   * Set when the ink must not move at all. Only cobalt-glass needs it: it is the
   * one mid-lightness family, so pure white with zero jitter is the only thing
   * that reliably clears the gate at the top of its gradient.
   */
  readonly inkLocked?: string;
  /** Anchor hue for the accent, before the harmony offset. */
  readonly accentH: number;
  /** Requested accent chroma. Clipped to the gamut like everything else. */
  readonly accentC: number;
  /** Requested accent lightness, before ACCENT_FILL_MIN_L is applied. */
  readonly accentL: number;
  /** Gradient dark end, as a delta on canvas L. Always negative. */
  readonly deepDelta: number;
  /** Gradient light end, as a delta on canvas L. Always positive. */
  readonly liftDelta: number;
  readonly harmonies: readonly HarmonyKey[];
  readonly temperaments: readonly Temperament[];
  /** Per-family jitter override. Only set it when the tests say a family needs it. */
  readonly jitter?: Partial<Record<'canvas' | 'accent' | 'ink', Partial<JitterBounds>>>;
  /** One line on what this family is for, so a contact sheet review can name it. */
  readonly note: string;
}

/**
 * Default jitter bounds.
 *
 * dH of 6 is DERIVED, not chosen. Families sit at least 25 degrees apart in
 * canvas hue (asserted by the family-separation test), so plus or minus 6 on two
 * neighbours still leaves a 13 degree gap. Jitter can never walk one family into
 * another. Widening this breaks that guarantee, which is why the derivation is
 * written down here rather than left for someone to rediscover.
 */
export const DEFAULT_JITTER: Record<'canvas' | 'accent' | 'ink', JitterBounds> = {
  canvas: { L: 0.025, C: 0.012, H: 6 },
  accent: { L: 0.02, C: 0.015, H: 5 },
  ink: { L: 0.015, C: 0.006, H: 10 },
};

/** Canvas L jitter is halved in the mid band, where the eye is most sensitive. */
const MID_BAND: readonly [number, number] = [0.3, 0.55];

/**
 * Every light family uses this gradient depth, and it is shallow on purpose.
 *
 * On a light family the DARK end of the gradient is what limits text contrast,
 * not the ink. Measured: going from -0.07 to -0.04 buys 5 APCA points, while
 * darkening the ink all the way from L 0.26 to L 0.16 buys only 4, because APCA
 * saturates once dark text is already dark. Two families failed the end card
 * body floor at -0.07 and both pass comfortably here.
 *
 * It is also the better look. A deep gradient on pale paper reads like a Word
 * document background, which is the opposite of what this is for.
 */
const LIGHT_DEEP_DELTA = -0.04;

export const PALETTE_FAMILIES: Record<FamilyKey, PaletteFamily> = {
  'obsidian-citrus': {
    key: 'obsidian-citrus',
    mode: 'dark',
    // Hue 220, not 250: at 250 this sat 8 degrees from ink-signal and only 0.13
    // apart in lightness, which failed the family separation invariant. At
    // C 0.015 the hue is barely perceptible anyway, so moving it costs nothing.
    canvas: { L: 0.21, C: 0.015, H: 220 },
    ink: { L: 0.98, C: 0.004, H: 220 },
    accentH: 130,
    accentC: 0.19,
    accentL: 0.88,
    deepDelta: -0.04,
    liftDelta: 0.08,
    harmonies: ['anchor', 'analogousWarm', 'analogousCool'],
    temperaments: ['brutal', 'techno', 'neutral'],
    note: 'Near-black with an acid lime. The default high-energy look.',
  },
  'champagne-noir': {
    key: 'champagne-noir',
    mode: 'dark',
    // Hue 75, not 60: at 60 this sat 20 degrees from molten-graphite with only
    // 0.06 of lightness between them. At C 0.010 the hue is near-invisible.
    canvas: { L: 0.18, C: 0.01, H: 75 },
    ink: { L: 0.96, C: 0.01, H: 85 },
    accentH: 85,
    accentC: 0.075,
    accentL: 0.84,
    deepDelta: -0.03,
    liftDelta: 0.08,
    harmonies: ['anchor', 'analogousWarm'],
    temperaments: ['editorial', 'neutral'],
    note: 'Warm near-black with soft gold. The expensive one.',
  },
  'molten-graphite': {
    key: 'molten-graphite',
    mode: 'dark',
    canvas: { L: 0.24, C: 0.02, H: 40 },
    ink: { L: 0.97, C: 0.008, H: 40 },
    accentH: 45,
    accentC: 0.19,
    accentL: 0.8,
    deepDelta: -0.05,
    liftDelta: 0.09,
    harmonies: ['anchor', 'analogousWarm', 'analogousCool'],
    temperaments: ['brutal', 'neutral'],
    note: 'Warm charcoal with a molten orange. Reads industrial.',
  },
  'cyber-mint': {
    key: 'cyber-mint',
    mode: 'dark',
    canvas: { L: 0.3, C: 0.045, H: 190 },
    ink: { L: 0.97, C: 0.01, H: 180 },
    accentH: 160,
    accentC: 0.16,
    accentL: 0.87,
    deepDelta: -0.07,
    liftDelta: 0.08,
    harmonies: ['anchor', 'analogousCool'],
    temperaments: ['techno', 'brutal'],
    note: 'Deep teal with a mint pop. The most obviously "AI product" look.',
  },
  'sunset-foil': {
    key: 'sunset-foil',
    mode: 'dark',
    canvas: { L: 0.32, C: 0.085, H: 350 },
    ink: { L: 0.97, C: 0.012, H: 350 },
    accentH: 35,
    accentC: 0.18,
    accentL: 0.8,
    deepDelta: -0.07,
    liftDelta: 0.08,
    harmonies: ['anchor', 'analogousWarm'],
    temperaments: ['editorial', 'neutral'],
    note: 'Plum into coral. Warm, cinematic, good for lifestyle content.',
  },
  ultraviolet: {
    key: 'ultraviolet',
    mode: 'dark',
    canvas: { L: 0.33, C: 0.12, H: 300 },
    ink: { L: 0.97, C: 0.014, H: 310 },
    accentH: 340,
    accentC: 0.21,
    accentL: 0.8,
    deepDelta: -0.07,
    liftDelta: 0.08,
    harmonies: ['anchor', 'analogousCool'],
    temperaments: ['techno', 'neutral', 'brutal'],
    note: 'Saturated violet with hot pink. The loudest family in the bank.',
  },
  'ink-signal': {
    key: 'ink-signal',
    mode: 'dark',
    canvas: { L: 0.34, C: 0.085, H: 258 },
    ink: { L: 0.97, C: 0.012, H: 258 },
    accentH: 240,
    accentC: 0.18,
    accentL: 0.82,
    deepDelta: -0.08,
    liftDelta: 0.08,
    harmonies: ['anchor', 'analogousWarm'],
    temperaments: ['neutral', 'techno'],
    note: 'Navy with a sky blue signal. The safe, credible one.',
  },
  'emerald-vault': {
    key: 'emerald-vault',
    mode: 'dark',
    canvas: { L: 0.36, C: 0.075, H: 160 },
    ink: { L: 0.97, C: 0.01, H: 150 },
    accentH: 90,
    accentC: 0.15,
    accentL: 0.82,
    deepDelta: -0.07,
    liftDelta: 0.07,
    harmonies: ['anchor', 'analogousCool'],
    temperaments: ['editorial', 'neutral'],
    note: 'Deep green with gold. Money, without saying money.',
  },
  'cobalt-glass': {
    key: 'cobalt-glass',
    mode: 'dark',
    // Hue 225, not 255: at 255 this sat 3 degrees from ink-signal, and the two
    // are only 0.12 apart in lightness, so they read as the same video. 225 is
    // still unambiguously cobalt, just a touch greener.
    canvas: { L: 0.46, C: 0.13, H: 225 },
    ink: { L: 1, C: 0, H: 0 },
    inkLocked: '#ffffff',
    accentH: 215,
    accentC: 0.16,
    accentL: 0.86,
    deepDelta: -0.09,
    liftDelta: 0.04,
    harmonies: ['anchor', 'analogousCool'],
    temperaments: ['neutral', 'techno'],
    // The one mid-lightness family, and the only one that needed retuning. At a
    // higher canvas L with a wider lift it fell under the WCAG floor at the top
    // of its gradient. Locked ink, a small lift and halved L jitter fix it. Keep
    // the per-family jitter override: it earned its place here.
    jitter: { canvas: { L: 0.015 } },
    note: 'Bright cobalt. The only mid-lightness family, and the most fragile.',
  },
  'arctic-steel': {
    key: 'arctic-steel',
    mode: 'light',
    canvas: { L: 0.92, C: 0.015, H: 240 },
    // Ink at L 0.20, not 0.26. At 0.26 this family measured Lc 70 to 75 against
    // its own gradient, which clears the hook floor but misses the stricter end
    // card body floor of 75. The end card is where the offer is, so the family
    // gets darker ink rather than the floor getting lowered.
    ink: { L: 0.2, C: 0.06, H: 255 },
    accentH: 255,
    accentC: 0.18,
    accentL: 0.8,
    // deepDelta -0.04, shallower than its siblings. Measured: on a light family
    // the dark end of the gradient, not the ink, is what limits contrast. Going
    // from -0.07 to -0.04 buys 5 Lc points where darkening the ink all the way
    // to L 0.16 only buys 4. This is the family with the darkest canvas of the
    // five light ones, so it is the first place it showed up.
    deepDelta: LIGHT_DEEP_DELTA,
    liftDelta: 0.03,
    harmonies: ['anchor', 'analogousCool'],
    temperaments: ['neutral', 'techno'],
    note: 'Cool paper with a strong blue. Clean, corporate, calm.',
  },
  'blush-studio': {
    key: 'blush-studio',
    mode: 'light',
    // Hue 355, not 20: at 20 this sat 10 degrees from vermilion-cut with 0.01 of
    // lightness between them. 355 is a rosier paper, which is more blush anyway.
    canvas: { L: 0.93, C: 0.025, H: 355 },
    ink: { L: 0.22, C: 0.07, H: 355 },
    accentH: 35,
    accentC: 0.14,
    accentL: 0.8,
    deepDelta: LIGHT_DEEP_DELTA,
    liftDelta: 0.03,
    harmonies: ['anchor', 'analogousWarm'],
    temperaments: ['editorial', 'neutral'],
    note: 'Warm blush paper. Soft, beauty-adjacent.',
  },
  'sea-glass': {
    key: 'sea-glass',
    mode: 'light',
    canvas: { L: 0.93, C: 0.03, H: 175 },
    ink: { L: 0.27, C: 0.05, H: 190 },
    accentH: 30,
    accentC: 0.17,
    accentL: 0.8,
    deepDelta: LIGHT_DEEP_DELTA,
    liftDelta: 0.03,
    harmonies: ['anchor', 'analogousWarm'],
    temperaments: ['editorial', 'neutral'],
    note: 'Pale mint paper with a coral accent. Fresh without being clinical.',
  },
  'vermilion-cut': {
    key: 'vermilion-cut',
    mode: 'light',
    canvas: { L: 0.94, C: 0.008, H: 30 },
    ink: { L: 0.19, C: 0.012, H: 20 },
    accentH: 30,
    accentC: 0.19,
    accentL: 0.8,
    deepDelta: LIGHT_DEEP_DELTA,
    liftDelta: 0.03,
    harmonies: ['anchor', 'analogousWarm', 'analogousCool'],
    temperaments: ['brutal', 'neutral', 'editorial'],
    note: 'Near-white with near-black and a hot red. Maximum contrast, poster energy.',
  },
  'bone-ink': {
    key: 'bone-ink',
    mode: 'light',
    canvas: { L: 0.955, C: 0.012, H: 85 },
    ink: { L: 0.21, C: 0.015, H: 80 },
    accentH: 70,
    accentC: 0.13,
    accentL: 0.8,
    deepDelta: LIGHT_DEEP_DELTA,
    liftDelta: 0.02,
    harmonies: ['anchor', 'analogousWarm'],
    temperaments: ['editorial', 'neutral'],
    note: 'Warm bone paper, near-black ink, amber accent. The safe fallback.',
  },
};

export const FAMILY_KEYS = Object.keys(PALETTE_FAMILIES) as FamilyKey[];

/** Always returns a family. Never null, so callers never branch on absence. */
export function family(key: string): PaletteFamily {
  const hit = PALETTE_FAMILIES[key as FamilyKey];
  if (!hit) throw new Error(`unknown palette family: ${key}`);
  return hit;
}

// --- anti-mud ----------------------------------------------------------------

/**
 * Three deterministic pushes that keep a jittered colour out of the specific
 * places where generated colour goes ugly. Applied in order, then gamut clipped.
 *
 * These are PUSHES, never rerolls. A reroll would also stay deterministic, but
 * it would hide the problem: if a family started needing six rerolls a loop
 * would silently absorb it and nobody would learn the family is badly tuned.
 */
const inDeadZone = (L: number, C: number): boolean =>
  L >= 0.4 && L <= 0.62 && C >= 0.03 && C <= 0.09;

/** Hue range where a dark colour reads as khaki rather than as gold. */
export const OLIVE_BAND: readonly [number, number] = [70, 105];

export const inOliveBand = (H: number): boolean =>
  wrapHue(H) >= OLIVE_BAND[0] && wrapHue(H) <= OLIVE_BAND[1];

export function antiMud(c: Oklch): Oklch {
  let { L, C } = c;
  const H = wrapHue(c.H);

  // MUD-1, the chroma dead zone. Mid lightness plus timid chroma is the single
  // biggest source of "looks like a 2011 PowerPoint". Commit to one or the other.
  if (inDeadZone(L, C)) {
    C = C < 0.06 ? 0.02 : 0.1;
  }

  // MUD-2, the olive band. Hue 70 to 105 at mid lightness is khaki. It is only
  // beautiful as gold, and gold lives high. Note the chroma gate: near-neutral
  // inks in this hue range (champagne-noir, bone-ink) are deliberately spared.
  if (inOliveBand(H) && C > 0.03 && L < 0.78) {
    L = 0.78;
  }

  // MUD-3, dirty extremes. A saturated near-black reads as a crushed shadow and
  // a saturated near-white reads as a printing error.
  if (C > 0.05 && L < 0.16) L = 0.16;
  if (C > 0.04 && L > 0.97) C = 0.04;

  const clipped = gamutClip({ L, C, H });

  // MUD-1's upward push is not always REACHABLE. At cyan around L 0.5 the whole
  // gamut ceiling sits inside the dead zone (max chroma there is about 0.085),
  // so committing to colour and then clipping lands straight back in the mud.
  // Committing to neutral is always reachable, so that is the fallback. Found by
  // the test, not by reasoning, which is why the test sweeps every seed.
  if (inDeadZone(clipped.L, clipped.C)) {
    return gamutClip({ L: clipped.L, C: 0.02, H: clipped.H });
  }
  return clipped;
}

// --- building a palette ------------------------------------------------------

export interface Palette {
  readonly family: FamilyKey;
  readonly mode: 'dark' | 'light';
  readonly harmony: HarmonyKey;
  /** The main field colour. */
  readonly canvas: Oklch;
  /** Gradient dark end. Always darker than canvas. */
  readonly canvasDeep: Oklch;
  /** Gradient light end. Always lighter than canvas. */
  readonly canvasLift: Oklch;
  /** The only default text colour. */
  readonly ink: string;
  /** Glow, ring, rule, bloom. NEVER text. */
  readonly accent: Oklch;
  /** Pill and button fill, forced light. Carries ON_ACCENT_HEX. */
  readonly accentFill: string;
  /** A dark accent that may carry text, light families only. Null on dark ones. */
  readonly accentInk: string | null;
}

const jitterFor = (
  f: PaletteFamily,
  role: 'canvas' | 'accent' | 'ink',
): JitterBounds => ({ ...DEFAULT_JITTER[role], ...(f.jitter?.[role] ?? {}) });

/** Symmetric jitter in [-amount, +amount] from one draw of the stream. */
const jit = (next: () => number, amount: number): number => (next() * 2 - 1) * amount;

/**
 * Build a concrete palette from a family, a harmony and a seeded stream.
 *
 * The stream is consumed in a fixed order. Do not reorder these draws or every
 * previously rendered variant changes appearance while every test still passes.
 */
export function buildPalette(
  familyKey: FamilyKey,
  harmony: HarmonyKey,
  next: () => number,
): Palette {
  const f = family(familyKey);

  // canvas
  const cj = jitterFor(f, 'canvas');
  const inMidBand = f.canvas.L >= MID_BAND[0] && f.canvas.L <= MID_BAND[1];
  const canvasLAmt = inMidBand ? Math.min(cj.L, 0.015) : cj.L;
  const canvas = antiMud({
    L: f.canvas.L + jit(next, canvasLAmt),
    C: f.canvas.C + jit(next, cj.C),
    H: f.canvas.H + jit(next, cj.H),
  });

  // Gradient ends track the jittered canvas, so a family reads as one colour
  // story rather than three independently wobbling ones.
  const canvasDeep = antiMud({ ...canvas, L: canvas.L + f.deepDelta });
  const canvasLift = antiMud({ ...canvas, L: canvas.L + f.liftDelta });

  // ink
  const ij = jitterFor(f, 'ink');
  const ink = f.inkLocked
    ? f.inkLocked
    : toHex(
        antiMud({
          L: f.ink.L + jit(next, ij.L),
          C: f.ink.C + jit(next, ij.C),
          H: f.ink.H + jit(next, ij.H),
        }),
      );
  if (f.inkLocked) {
    // Keep the stream position identical whether or not ink is locked, so adding
    // or removing a lock on a family cannot reshuffle everything after it.
    next();
    next();
    next();
  }

  // accent
  const aj = jitterFor(f, 'accent');
  const accentBase: Oklch = {
    L: f.accentL + jit(next, aj.L),
    C: f.accentC + jit(next, aj.C),
    H: f.accentH + HARMONY_OFFSETS[harmony] + jit(next, aj.H),
  };
  const accent = antiMud(accentBase);
  const accentFill = toHex(
    antiMud({ ...accentBase, L: Math.max(accentBase.L, ACCENT_FILL_MIN_L) }),
  );
  // accentInk is a DARK accent that may carry text, so it only exists where a
  // dark accent is actually attractive. Two exclusions, both deliberate:
  //
  //  - dark families, where a dark accent on a dark canvas is unreadable anyway;
  //  - any accent sitting in the olive band, because a dark khaki is exactly
  //    what MUD-2 exists to forbid. Forcing one dark and then having MUD-2 shove
  //    it back up produced a colour that was neither, so the family simply does
  //    not get an accentInk. It still has accent pills.
  const accentInk =
    f.mode === 'light' && !inOliveBand(accentBase.H)
      ? toHex(antiMud({ ...accentBase, L: Math.min(accentBase.L, ACCENT_INK_MAX_L) }))
      : null;

  return {
    family: familyKey,
    mode: f.mode,
    harmony,
    canvas,
    canvasDeep,
    canvasLift,
    ink,
    accent,
    accentFill,
    accentInk,
  };
}

/**
 * The three gradient stops as hex, cheapest possible gate sample.
 *
 * The real gate samples the composited background through an archetype's
 * colorAt(), because the hook can sit on a glow the gradient alone does not
 * describe. This is the coarse check used while tuning a family in isolation.
 */
export function paletteExtremes(p: Palette): string[] {
  return [toHex(p.canvasDeep), toHex(p.canvas), toHex(p.canvasLift)];
}

// --- rim light ---------------------------------------------------------------

/**
 * How strong the phone's edge highlight has to be, given how close the
 * background actually gets to the bezel in lightness.
 *
 * A flat rule like "the canvas must differ from the bezel by 0.18 in L" was
 * rejected twice over. It would delete the three best near-black families, and
 * it is unsound anyway: a vignette can darken the ring around the phone far
 * below the canvas anchor, so an anchor-based check passes while the real edge
 * turns to mush. So the rim is always on and its strength is measured from the
 * composited background in an annulus around the phone.
 *
 * Monotonically non-increasing in minDeltaL, which the tests assert: a sign
 * error here would put a strong white rim on a white background, and that looks
 * like a rendering bug rather than a design choice.
 */
export function deriveRimAlpha(minDeltaL: number): number {
  const t = (minDeltaL - 0.1) / 0.22;
  const raw = 0.55 + (0.1 - 0.55) * t;
  return Math.min(0.55, Math.max(0.1, raw));
}
