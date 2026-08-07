// plan.ts: turns (sourceId, variantIndex) into everything a frame needs.
//
// This is where the decks live, and the decks are what actually make the videos
// different from each other. Jitter does not; see the note in palettes.ts.
//
// THE STATELESS WORKER PROBLEM, and its one-line answer. A deck is stateful by
// nature: it has to remember what it has already dealt. Render workers are
// stateless and may pick up any variant in any order. So planSource(id, n) is
// the primitive, and planVariant(id, i) is defined as planSource(id, i+1)[i].
// Recomputing the prefix costs microseconds and means any worker can reproduce
// any variant from two values with nothing shared between machines.

import {
  admissibleArchetypes,
  ARCHETYPES,
  colorAt,
  sampleAt,
  toCss,
  type ArchetypeKey,
  type ArchetypeParams,
  type BgModel,
} from './archetypes';
import { gateText, TEXT_ROLES } from './contrast';
import {
  annulusPoints,
  CTA_TEXT_AREA,
  HOOK_SAFE_AREA,
  sampleGrid,
} from './geometry';
import { admissibleFonts, type FontKey } from './fonts';
import {
  CTA_LAYOUTS,
  CTA_OFFER_IDS,
  CTA_REVEAL_IDS,
  RETENTION_IDS,
  type CtaLayout,
} from './hooks';
import { hexToOklch, toHex } from './oklch';
import {
  BEZEL_L,
  buildPalette,
  deriveRimAlpha,
  family,
  FAMILY_KEYS,
  PALETTE_FAMILIES,
  type FamilyKey,
  type HarmonyKey,
  type Palette,
} from './palettes';
import { channel, deriveRecipe, seedFor, type Recipe } from './recipe';
import { Deck, shuffleLabel, stream } from './seed';

/** Sample grids. Fixed, so a plan is reproducible down to the sample positions. */
const HOOK_POINTS = sampleGrid(HOOK_SAFE_AREA, 9, 5);
const CTA_POINTS = sampleGrid(CTA_TEXT_AREA, 7, 5);
const RING_POINTS = annulusPoints();

/**
 * Where the hook plate takes its colour from, and why it is exactly this point.
 *
 * Before the shrink the hook sits on top of the playing video, and no gate can
 * say anything about video pixels. So the text gets an opaque plate under it.
 * The plate has to be a colour the ink is PROVEN readable on, and the cheapest
 * proof available is to take a colour the gate already measured: this is the
 * centre of the bottom-anchored text, on the 9x5 grid above, and the gate passes
 * a variant only when all 45 of those points clear the floor.
 */
const PLATE_POINT = {
  x: HOOK_SAFE_AREA.x + HOOK_SAFE_AREA.w / 2,
  y: HOOK_SAFE_AREA.y + (HOOK_SAFE_AREA.h * 3) / 4,
};

/**
 * How the contrast gate resolved. Exposed so the test suite can BUDGET it.
 *
 * 0 is the seeded ink passing first time, which is what should happen almost
 * always. Anything above 0 means a family or archetype is drifting and wants
 * looking at. Step 4 means the safe fallback was used, which the tests assert is
 * unreachable. This is a monitoring surface, not an expected code path, and that
 * is exactly why it is a ladder rather than a reroll loop: a loop would absorb
 * the problem silently and nobody would ever learn a family was badly tuned.
 */
export type GateStep = 0 | 1 | 2 | 3 | 4;

export interface VariantPlan {
  readonly sourceId: string;
  readonly variantIndex: number;
  readonly seed: number;
  readonly recipe: Recipe;

  readonly family: FamilyKey;
  readonly harmony: HarmonyKey;
  readonly palette: Palette;
  /** The resolved text colour. Usually palette.ink, see the gate ladder. */
  readonly ink: string;
  readonly gateStep: GateStep;
  /** Worst APCA reading under the hook, after resolution. For diagnostics. */
  readonly hookLc: number;

  readonly archetype: ArchetypeKey;
  readonly archetypeParams: ArchetypeParams;
  /** Ready to drop into a `background` CSS property. */
  readonly backgroundCss: string;
  readonly grainAlpha: number;
  readonly rimAlpha: number;
  /** Opaque backing for the hook while it sits over the full-bleed video. */
  readonly hookPlate: string;

  readonly font: FontKey;
  readonly hookIds: string[];
  readonly ctaLayout: CtaLayout;
  /** The AI reveal on the end card. The only place the video admits what it is. */
  readonly revealId: string;
  /**
   * The colour the reveal is drawn in, and it is a resolved value rather than
   * "use the accent" for a reason worth keeping.
   *
   * accentFill is forced LIGHT by construction (L >= 0.79) so that a near-black
   * always reads on top of it as a pill. Used as a text colour it is therefore
   * fine on the nine dark families and close to invisible on the five light
   * ones. accentInk is the opposite and only exists on light families. So the
   * right one is picked by mode and then GATED against the real composited
   * background, falling back to the plain ink if it does not clear the floor.
   */
  readonly revealInk: string;
  /** Which wording of the offer sits under the reveal. */
  readonly offerId: string;
  /** Vertical nudge on the end card block, in px. Kept inside the gated region. */
  readonly ctaOffsetY: number;
}

// --- the gate ladder ---------------------------------------------------------

interface Resolved {
  readonly palette: Palette;
  readonly model: BgModel;
  readonly ink: string;
  readonly step: GateStep;
  readonly lc: number;
  /**
   * The archetype and params ACTUALLY used, which is not always what was drawn.
   *
   * These have to travel together. An earlier version returned only the model
   * and let the caller keep the drawn archetype and the drawn params, so an
   * escalation to step 3 produced a plan claiming linearTriStop while carrying
   * meshDual's parameters. Rebuilding from that gives a gradient with an
   * undefined angle. The gate would still have reported a pass, because it
   * measured the model rather than the plan.
   */
  readonly archetype: ArchetypeKey;
  readonly params: ArchetypeParams;
}

/**
 * One ink has to work in TWO places: the hook at the top of the body, and the
 * end card text in the middle of the same background.
 *
 * An earlier version gated only the hook, and cobalt-glass and sea-glass then
 * slipped through with end card text at Lc 74 against a floor of 75. Nothing was
 * wrong with the palettes; the gate was simply looking at the wrong part of the
 * frame. Both regions are checked here, each against its own role, and a step
 * only counts as passing if both do.
 */
function passes(ink: string, model: BgModel): { pass: boolean; worstLc: number } {
  const h = gateText(ink, sampleAt(model, HOOK_POINTS), TEXT_ROLES.hook);
  const c = gateText(ink, sampleAt(model, CTA_POINTS), TEXT_ROLES.ctaBody);
  return { pass: h.pass && c.pass, worstLc: Math.min(h.worstLc, c.worstLc) };
}

/** The step 4 background. A plain vertical ramp, nothing on top of it. */
const SAFE_PARAMS: ArchetypeParams = { angle: 180, midPos: 0.5 };

/** Pull the canvas back toward its family anchor by a fraction. */
function lerpCanvasTowardAnchor(p: Palette, k: number): Palette {
  const anchor = family(p.family).canvas;
  return {
    ...p,
    canvas: {
      L: p.canvas.L + (anchor.L - p.canvas.L) * k,
      C: p.canvas.C + (anchor.C - p.canvas.C) * k,
      H: p.canvas.H + (anchor.H - p.canvas.H) * k,
    },
  };
}

/**
 * Resolve text against the composited background, escalating deterministically.
 *
 * Each step is a fixed, bounded operation. There is no search and no retry with
 * a different seed, so this terminates in a known number of operations even when
 * four thousand workers are calling it at once.
 */
function resolveText(
  p0: Palette,
  arch: ArchetypeKey,
  params: ArchetypeParams,
): Resolved {
  const build = (p: Palette) => ARCHETYPES[arch].build(p, params);

  // Step 0: the seeded ink, as drawn.
  let model = build(p0);
  let r = passes(p0.ink, model);
  if (r.pass) return { palette: p0, model, ink: p0.ink, step: 0, lc: r.worstLc, archetype: arch, params };

  // Step 1: drop the ink jitter and use the family's proven anchor pair.
  const anchorInk = family(p0.family).inkLocked ?? toHex(family(p0.family).ink);
  r = passes(anchorInk, model);
  if (r.pass) return { palette: p0, model, ink: anchorInk, step: 1, lc: r.worstLc, archetype: arch, params };

  // Step 2: pull the canvas back toward its anchor, in four fixed steps.
  for (const k of [0.25, 0.5, 0.75, 1]) {
    const p = lerpCanvasTowardAnchor(p0, k);
    model = build(p);
    r = passes(anchorInk, model);
    if (r.pass) return { palette: p, model, ink: anchorInk, step: 2, lc: r.worstLc, archetype: arch, params };
  }

  // Step 3: the archetype is the problem, not the palette. Fall back to the
  // quietest one, which is a plain vertical ramp with nothing on top of it.
  const quietParams = ARCHETYPES.linearTriStop.params(stream(`quiet|${p0.family}`));
  model = ARCHETYPES.linearTriStop.build(p0, quietParams);
  r = passes(anchorInk, model);
  if (r.pass)
    return { palette: p0, model, ink: anchorInk, step: 3, lc: r.worstLc, archetype: 'linearTriStop', params: quietParams };

  // Step 4: the safe fallback. Provably unreachable with the current banks, and
  // asserted as such, but it exists so this function can never return unreadable
  // text no matter what somebody adds to the banks later.
  const safe = buildPalette('bone-ink', 'anchor', stream('SAFE_FALLBACK'));
  const safeModel = ARCHETYPES.linearTriStop.build(safe, SAFE_PARAMS);
  const safeR = passes(safe.ink, safeModel);
  return {
    palette: safe,
    model: safeModel,
    ink: safe.ink,
    step: 4,
    lc: safeR.worstLc,
    archetype: 'linearTriStop',
    params: SAFE_PARAMS,
  };
}

// --- planning ----------------------------------------------------------------

/** Shortest angular distance, duplicated here to avoid a circular import. */
const hueGap = (a: number, b: number): number => {
  const d = Math.abs(((a % 360) + 360) % 360 - (((b % 360) + 360) % 360));
  return d > 180 ? 360 - d : d;
};

/**
 * Plan the first `n` variants of one source.
 *
 * Decks are built per source, so two sources do not march in lockstep, and the
 * font and archetype decks are keyed BY THE DRAWN FAMILY. That nesting is what
 * decorrelates the pairs: two independent decks of 14 and 10 would still repeat
 * the (family, font) combination far sooner than 140. It also means each deck
 * holds only admissible items, so an inadmissible combination is unrepresentable
 * rather than merely filtered out.
 */
export function planSource(
  sourceId: string,
  n: number,
  recipeVersion = 1,
  forceFamily?: FamilyKey,
): VariantPlan[] {
  const paletteDeck = new Deck(FAMILY_KEYS, shuffleLabel('palette', sourceId));
  // One deck for the whole video's text, because every hook now says the same
  // thing in a different way and they all run in the back half.
  const retentionDeck = new Deck(RETENTION_IDS, shuffleLabel('retention', sourceId));
  const ctaDeck = new Deck(CTA_LAYOUTS, shuffleLabel('cta', sourceId));
  // The reveal and the offer rotate independently of each other, so ten reveals
  // against eight offers give eighty distinct end cards rather than ten.
  const revealDeck = new Deck(CTA_REVEAL_IDS, shuffleLabel('reveal', sourceId));
  const offerDeck = new Deck(CTA_OFFER_IDS, shuffleLabel('offer', sourceId));

  const fontDecks = new Map<FamilyKey, Deck<FontKey>>();
  const archDecks = new Map<FamilyKey, Deck<ArchetypeKey>>();
  const harmDecks = new Map<FamilyKey, Deck<HarmonyKey>>();

  const fontDeck = (f: FamilyKey) => {
    if (!fontDecks.has(f)) {
      fontDecks.set(f, new Deck(admissibleFonts(PALETTE_FAMILIES[f].temperaments), shuffleLabel('font', sourceId, f)));
    }
    return fontDecks.get(f) as Deck<FontKey>;
  };
  const archDeck = (f: FamilyKey) => {
    if (!archDecks.has(f)) {
      archDecks.set(f, new Deck(admissibleArchetypes(PALETTE_FAMILIES[f].mode), shuffleLabel('arch', sourceId, f)));
    }
    return archDecks.get(f) as Deck<ArchetypeKey>;
  };
  const harmDeck = (f: FamilyKey) => {
    if (!harmDecks.has(f)) {
      harmDecks.set(f, new Deck(PALETTE_FAMILIES[f].harmonies, shuffleLabel('harm', sourceId, f)));
    }
    return harmDecks.get(f) as Deck<HarmonyKey>;
  };

  const out: VariantPlan[] = [];
  for (let i = 0; i < n; i++) {
    const prev = out[i - 1];
    const seed = seedFor(sourceId, i, recipeVersion);

    // Adjacency constraint. Two consecutive variants of one source get posted
    // hours apart to the same audience, so they must not share a family, and
    // their canvas hues must be a real distance apart.
    //
    // forceFamily (the creator pipeline's per-account color) wins over the
    // deck: each account renders ONE variant of each master, so adjacency is
    // between DIFFERENT accounts' videos and does not apply. The deck still
    // advances identically either way, keeping every other seeded draw (font,
    // archetype, hooks) byte-stable whether or not a family is forced.
    const drawn = paletteDeck.take(
      (f) =>
        !prev ||
        (f !== prev.family && hueGap(PALETTE_FAMILIES[f].canvas.H, prev.palette.canvas.H) >= 30),
    );
    const fam = forceFamily && FAMILY_KEYS.includes(forceFamily) ? forceFamily : drawn;
    const harmony = harmDeck(fam).take();
    const font = fontDeck(fam).take((f) => !prev || f !== prev.font);
    const arch = archDeck(fam).take((a) => !prev || a !== prev.archetype);

    const palette0 = buildPalette(fam, harmony, channel(seed, 'palette'));
    const params = ARCHETYPES[arch].params(channel(seed, 'archetype'));
    const resolved = resolveText(palette0, arch, params);

    // The reveal wants to look different from the offer under it, so it reaches
    // for the accent. Which accent depends on the mode, and either way it has to
    // clear the same floor as any other end card text.
    const wanted =
      resolved.palette.mode === 'light'
        ? resolved.palette.accentInk ?? resolved.ink
        : resolved.palette.accentFill;
    const revealInk = gateText(wanted, sampleAt(resolved.model, CTA_POINTS), TEXT_ROLES.ctaBody)
      .pass
      ? wanted
      : resolved.ink;

    const minDelta = Math.min(
      ...sampleAt(resolved.model, RING_POINTS).map((h) => Math.abs(hexToOklch(h).L - BEZEL_L)),
    );

    const recipe = deriveRecipe(seed, sourceId);
    // Every hook is a retention line. Nothing in the body ever says it is AI;
    // that is the end card's job and it is the whole reason these exist.
    const hookIds: string[] = [];
    for (let k = 0; k < recipe.hookCount; k++) {
      // Never the same line twice in ONE video. A long clip takes eight of the
      // twenty-four, so the deck can wrap mid-video and its reshuffle would
      // otherwise be free to deal back a line this video has already shown.
      // That is the one repeat a viewer is guaranteed to notice, because they
      // see both within seconds of each other.
      hookIds.push(retentionDeck.take((id) => !hookIds.includes(id)));
    }

    out.push({
      sourceId,
      variantIndex: i,
      seed,
      recipe,
      family: fam,
      harmony,
      palette: resolved.palette,
      ink: resolved.ink,
      gateStep: resolved.step,
      hookLc: resolved.lc,
      archetype: resolved.archetype,
      archetypeParams: resolved.params,
      backgroundCss: toCss(resolved.model),
      grainAlpha: resolved.model.grainAlpha,
      rimAlpha: deriveRimAlpha(minDelta),
      hookPlate: colorAt(resolved.model, PLATE_POINT),
      font,
      hookIds,
      ctaLayout: ctaDeck.take(),
      revealId: revealDeck.take(),
      revealInk,
      offerId: offerDeck.take(),
      // Quantised to 15px steps so the nudge is a real difference rather than a
      // sub-pixel one, and bounded so the block cannot leave CTA_TEXT_AREA, which
      // is the region the contrast gate actually measured.
      ctaOffsetY: (Math.floor(channel(seed, 'cta')() * 9) - 4) * 15,
    });
  }
  return out;
}

/**
 * One variant, from nothing but its address.
 *
 * See the header note: the prefix is recomputed rather than shared, which is
 * what makes every render worker independent.
 */
export function planVariant(
  sourceId: string,
  i: number,
  recipeVersion = 1,
  forceFamily?: FamilyKey,
): VariantPlan {
  return planSource(sourceId, i + 1, recipeVersion, forceFamily)[i];
}

/** The composited background under the end card text, for the stricter gate. */
export function ctaSamples(plan: VariantPlan): string[] {
  const model = ARCHETYPES[plan.archetype].build(plan.palette, plan.archetypeParams);
  return sampleAt(model, CTA_POINTS);
}

/** One background colour, for anything that needs a single representative value. */
export function backgroundAt(plan: VariantPlan, x: number, y: number): string {
  return colorAt(ARCHETYPES[plan.archetype].build(plan.palette, plan.archetypeParams), { x, y });
}
