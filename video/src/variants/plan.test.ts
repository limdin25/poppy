// The test that decides whether the system can genuinely make thousands of
// different videos, or only claims to.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { planSource, planVariant } from './plan';
import { ctaSamples } from './plan';
import { gateText, TEXT_ROLES } from './contrast';
import { FAMILY_KEYS, PALETTE_FAMILIES } from './palettes';
import { admissibleFonts, fitHook, FONT_BANK, FONT_KEYS, metrics, sizeForCap } from './fonts';
import {
  ALL_HOOKS,
  CTA_OFFERS,
  CTA_OFFER_IDS,
  CTA_REVEALS,
  CTA_REVEAL_IDS,
  RETENTION_BANK,
  RETENTION_IDS,
  offer,
  reveal,
} from './hooks';
import { CTA_CAP_PX, HOOK_CAP_PX, TYPE_SCALE_MAX, TYPE_SCALE_MIN } from './fonts';
import {
  AMBIENCE_COUNT,
  AMBIENCE_GAIN_MAX,
  AMBIENCE_GAIN_MIN,
  AMBIENCE_SECONDS,
  CHANNELS,
  DROP_FLOOR,
  DROP_FRACTION_MAX,
  DROP_FRACTION_MIN,
  DROP_JITTER,
  DROP_SNAP,
  MAX_GRADE,
  MAX_ZOOM,
  MIN_HOOK_WINDOW,
  MIN_PHONE_FRAMES,
  OPEN_ZOOM_DRIFT,
  OPEN_ZOOM_MAX,
  OPEN_ZOOM_MIN,
  RECIPE_VERSION,
  ambienceFile,
  clipTransform,
  gradeFilter,
  motionAt,
  restMotion,
  SOURCES as SOURCE_SPECS,
  SOURCE_IDS,
  bodyFrames,
  deriveRecipe,
  resolveSource,
  seedFor,
  totalFrames,
} from './recipe';
import { CANVAS, CTA_TEXT_AREA, HOOK_MAX_LINES, HOOK_SAFE_AREA, HOOK_TEXT_W, PHONE, SCREEN } from './geometry';
import { Deck, drawConstrained, fnv1a, shuffled, stream } from './seed';

// The real sources, not synthetic ids. A plan now depends on its clip's own
// length and its own beat map, so planning a source that does not exist is a
// genuine error rather than a harmless test convenience.
const SOURCES = SOURCE_IDS;
const N = 128;
const PLANS = SOURCES.map((s) => planSource(s, N));
const FLAT = PLANS.flat();

describe('determinism', () => {
  it('gives the same plan for the same address, every time', () => {
    for (const s of ['v1', 'v3']) {
      for (const i of [0, 1, 7, 40, 99]) {
        expect(planVariant(s, i)).toEqual(planVariant(s, i));
      }
    }
  });

  it('makes planVariant equal the same index of a longer planSource', () => {
    // This is what lets a stateless render worker reproduce any variant from
    // (sourceId, index) alone, with nothing shared between machines. If it ever
    // fails, the decks have picked up a dependency on how many were requested.
    const long = planSource('v2', 200);
    for (const i of [0, 1, 13, 60, 150]) {
      expect(planVariant('v2', i), `index ${i}`).toEqual(long[i]);
    }
  });

  it('holds the seed stable so a batch can be re-run byte for byte', () => {
    expect(seedFor('v1', 0, 1)).toBe(seedFor('v1', 0, 1));
    expect(seedFor('v1', 0, 1)).not.toBe(seedFor('v1', 1, 1));
    expect(seedFor('v1', 0, 1)).not.toBe(seedFor('v2', 0, 1));
  });

  it('invalidates everything when RECIPE_VERSION moves, and only then', () => {
    expect(seedFor('v1', 5, 1)).not.toBe(seedFor('v1', 5, 2));
  });

  it('leaves earlier variants untouched when the batch size grows', () => {
    // Raising --count from 4 to 250 must not change variants 0 to 3, or every
    // already-posted video becomes unreproducible.
    const small = planSource('v4', 4);
    const big = planSource('v4', 250);
    expect(big.slice(0, 4)).toEqual(small);
  });
});

describe('the contrast gate, on the real composited background', () => {
  it('passes the hook floor for every planned variant', () => {
    const bad = FLAT.filter((p) => p.hookLc < TEXT_ROLES.hook.minLc);
    expect(
      bad.slice(0, 8).map((p) => `${p.sourceId}#${p.variantIndex} ${p.family}/${p.archetype} Lc ${p.hookLc.toFixed(1)}`),
    ).toEqual([]);
  });

  it('passes the stricter end card floor for every planned variant', () => {
    const failures: string[] = [];
    for (const p of FLAT) {
      const r = gateText(p.ink, ctaSamples(p), TEXT_ROLES.ctaBody);
      if (!r.pass) {
        failures.push(`${p.sourceId}#${p.variantIndex} ${p.family} Lc ${r.worstLc.toFixed(1)}`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it('passes that floor for the REVEAL colour too, not just the body ink', () => {
    // This caught a real bug. The reveal was drawn in palette.accentFill to set
    // it apart from the offer, and accentFill is forced LIGHT by construction
    // (L >= 0.79) precisely so a near-black reads on top of it as a pill. As a
    // text colour that is fine on the nine dark families and close to invisible
    // on the five light ones, and nothing would have reported it: the gate only
    // ever looked at plan.ink.
    const failures: string[] = [];
    for (const p of FLAT) {
      const r = gateText(p.revealInk, ctaSamples(p), TEXT_ROLES.ctaBody);
      if (!r.pass) {
        failures.push(`${p.sourceId}#${p.variantIndex} ${p.family} reveal Lc ${r.worstLc.toFixed(1)}`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it('records how rarely the accent survives as a text colour', () => {
    // Measured 10.5 percent, and the shape of that number is the point.
    //
    // Ten of the fourteen families NEVER pass: sunset-foil bottoms out at Lc
    // 47.6 and ultraviolet at 44.8, against a floor of 75. Only bone-ink (89%)
    // and obsidian-citrus (84%) manage it reliably. That is not a tuning
    // problem, it is the rule palettes.ts states in its own header and it is
    // measured, not assumed: THE ACCENT IS NOT A TEXT COLOUR. It is a fill, with
    // near-black on top of it, which is why accentFill is forced to L >= 0.79.
    //
    // So the reveal is drawn in the gated ink on roughly nine variants in ten,
    // and is set apart by size and letter-spacing instead. The tenth gets a
    // little colour for free. This assertion is a monitoring surface: if it goes
    // UP a lot, somebody has loosened a floor.
    const distinct = FLAT.filter((p) => p.revealInk !== p.ink).length;
    const rate = distinct / FLAT.length;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.3);
  });
});

describe('the gate ladder as a budget alarm', () => {
  // These are not pass/fail on the output, they are pass/fail on the DESIGN.
  // If a future palette edit pushes step 1 or 2 usage up, that family is badly
  // tuned and the suite says so instead of quietly laundering it.
  it('never reaches the safe fallback', () => {
    expect(FLAT.filter((p) => p.gateStep === 4)).toHaveLength(0);
  });

  it('keeps the archetype flattening rare, and only where it genuinely helps', () => {
    // Measured 4 in 1024, all on cobalt-glass and sea-glass, the two families
    // closest to their floors. That is the ladder doing its job rather than a
    // defect: each one lands on a plain vertical ramp that clears both floors
    // by a wide margin. Zero was the original target and it is not something a
    // bank of 14 families x 7 archetypes x jitter can honestly promise. If this
    // climbs, a family has drifted and wants retuning.
    const flattened = FLAT.filter((p) => p.gateStep === 3);
    expect(flattened.length / FLAT.length).toBeLessThan(0.01);
    // Whatever escalated must still be comfortably readable, not merely legal.
    for (const p of flattened) expect(p.hookLc, `${p.family}`).toBeGreaterThan(70);
  });

  it('rebuilds to the archetype it claims, with parameters that belong to it', () => {
    // The escalation swaps the archetype. If the plan kept the DRAWN parameters
    // alongside the SWAPPED archetype, the component would rebuild a gradient
    // with an undefined angle, and the gate would never notice because it
    // measures the model rather than the plan.
    for (const p of FLAT) {
      const expected = Object.keys(ARCHETYPES[p.archetype].params(stream('shape'))).sort();
      expect(Object.keys(p.archetypeParams).sort(), `${p.sourceId}#${p.variantIndex}`).toEqual(expected);
      expect(p.backgroundCss).not.toMatch(/NaN|undefined/);
    }
  });

  it('resolves at least 99 percent of variants on the first try', () => {
    const clean = FLAT.filter((p) => p.gateStep === 0).length;
    expect(clean / FLAT.length).toBeGreaterThanOrEqual(0.99);
  });
});

describe('non-repetition', () => {
  it('never repeats a full visual identity while the palette deck is on its first pass', () => {
    // Fourteen families, so the first fourteen variants are guaranteed distinct
    // by deck exhaustion alone. This is the window that actually matters: the
    // launch batch is four per source.
    for (const plans of PLANS) {
      const combos = plans.slice(0, 14).map((p) => `${p.family}|${p.font}|${p.archetype}|${p.harmony}`);
      expect(new Set(combos).size, `${plans[0].sourceId}`).toBe(14);
    }
  });

  it('keeps identity repeats rare over a long run, without pretending they are impossible', () => {
    // Over 128 variants a family comes round about nine times, drawing from
    // roughly 60 (font, archetype, harmony) combinations, so a collision by
    // chance is expected and asserting zero would be a lie about the bank size.
    // What matters is that repeats stay rare. The lever that moves this number
    // is more palette families, not more jitter.
    for (const plans of PLANS) {
      const combos = plans.map((p) => `${p.family}|${p.font}|${p.archetype}|${p.harmony}`);
      const distinct = new Set(combos).size;
      expect(distinct / combos.length, plans[0].sourceId).toBeGreaterThan(0.95);
    }
  });

  it('never puts two consecutive variants in the same family', () => {
    // This one is absolute. drawConstrained can always satisfy it, because the
    // deck holds fourteen families and only one is excluded.
    for (const plans of PLANS) {
      for (let i = 1; i < plans.length; i++) {
        expect(plans[i].family, `${plans[i].sourceId}#${i}`).not.toBe(plans[i - 1].family);
      }
    }
  });

  it('keeps consecutive hues apart nearly always, and relaxes rather than stalling', () => {
    // The 30 degree hue rule is best effort by construction. When the deck's
    // remaining tail holds nothing far enough away, drawConstrained takes the
    // cursor item rather than stalling or rerolling, which is a deliberate
    // bounded relaxation. It should be rare; if this number climbs, the palette
    // hues have bunched up and want spreading out.
    let relaxed = 0;
    let total = 0;
    for (const plans of PLANS) {
      for (let i = 1; i < plans.length; i++) {
        const d = Math.abs(plans[i].palette.canvas.H - plans[i - 1].palette.canvas.H);
        total += 1;
        if (Math.min(d, 360 - d) < 25) relaxed += 1;
      }
    }
    expect(relaxed / total).toBeLessThan(0.06);
  });

  it('uses every family within the first 14 variants of every source', () => {
    for (const plans of PLANS) {
      const seen = new Set(plans.slice(0, 14).map((p) => p.family));
      expect(seen.size, plans[0].sourceId).toBe(FAMILY_KEYS.length);
    }
  });

  it('spreads families evenly rather than favouring a few', () => {
    const counts = new Map<string, number>();
    for (const p of FLAT) counts.set(p.family, (counts.get(p.family) ?? 0) + 1);
    const expected = FLAT.length / FAMILY_KEYS.length;
    for (const k of FAMILY_KEYS) {
      const c = counts.get(k) ?? 0;
      expect(Math.abs(c - expected) / expected, `${k} appeared ${c} times`).toBeLessThan(0.2);
    }
  });

  it('keeps the sources genuinely independent of each other', () => {
    // If every stream were seeded off one counter, variant 0 of every source
    // would land on the same family and this would collapse to 1.
    const firsts = new Set(PLANS.map((p) => p[0].family));
    expect(firsts.size).toBe(PLANS.length);

    // Stronger, and the one that survives adding sources: no two clips may deal
    // their families in the same ORDER. Two sources posted the same week with
    // matching palette sequences look like one campaign run twice.
    const orders = PLANS.map((p) => p.slice(0, 14).map((v) => v.family).join('>'));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('reshuffles into a different order on the second pass through a deck', () => {
    // Without the epoch bump, a source running 30 variants over a 14 item bank
    // emits the identical order twice and a human spots it immediately.
    const plans = PLANS[0];
    const first = plans.slice(0, 14).map((p) => p.family);
    const second = plans.slice(14, 28).map((p) => p.family);
    expect(second).not.toEqual(first);
  });

  it('never repeats a hook within a source run until the bank is exhausted', () => {
    for (const plans of PLANS) {
      const used = plans.flatMap((p) => p.hookIds);
      const firstPass = used.slice(0, RETENTION_IDS.length);
      expect(new Set(firstPass).size, plans[0].sourceId).toBe(RETENTION_IDS.length);
    }
  });

  it('never repeats a hook WITHIN one video', () => {
    // A video shows up to eight hooks from a bank of 24. Two of them being the
    // same line reads as a bug to anybody watching, and it is the one repeat a
    // viewer is guaranteed to notice because they see both within seconds.
    for (const p of FLAT) {
      expect(new Set(p.hookIds).size, `${p.sourceId}#${p.variantIndex}`).toBe(p.hookIds.length);
    }
  });

  it('rotates the reveal and the offer independently', () => {
    // Ten reveals against eight offers is eighty distinct end cards. Drawn from
    // one deck they would march in lockstep and there would be ten.
    const pairs = new Set(FLAT.map((p) => `${p.revealId}|${p.offerId}`));
    expect(pairs.size).toBeGreaterThan(40);
    for (const plans of PLANS) {
      const reveals = plans.slice(0, CTA_REVEAL_IDS.length).map((p) => p.revealId);
      expect(new Set(reveals).size, plans[0].sourceId).toBe(CTA_REVEAL_IDS.length);
      const offers = plans.slice(0, CTA_OFFER_IDS.length).map((p) => p.offerId);
      expect(new Set(offers).size, plans[0].sourceId).toBe(CTA_OFFER_IDS.length);
    }
  });

  it('nudges the end card without letting it leave the region the gate measured', () => {
    const offsets = new Set(FLAT.map((p) => p.ctaOffsetY));
    expect(offsets.size).toBeGreaterThan(4);
    for (const p of FLAT) {
      expect(Math.abs(p.ctaOffsetY), `${p.sourceId}#${p.variantIndex}`).toBeLessThanOrEqual(60);
    }
  });
});

describe('the reveal only ever happens at the end', () => {
  it('never lets a body hook mention AI, or filming, or cameras', () => {
    // THE RULE THE WHOLE STRUCTURE RESTS ON. The viewer does not learn what they
    // are watching until the end card, and every retention line exists to get
    // them there. One hook giving it away costs the reveal, and the reveal is
    // the entire point of the video.
    const giveaways = /\b(ai|generated|generate|filmed|filming|camera|crew|actor|prompt|real|fake)\b/i;
    for (const h of ALL_HOOKS) {
      expect(giveaways.test(h.text), `hook "${h.text}" gives the reveal away`).toBe(false);
    }
    // And every hook a plan can actually emit comes from that bank.
    for (const p of FLAT) {
      for (const id of p.hookIds) expect(RETENTION_IDS).toContain(id);
    }
  });

  it('points every body hook at the END, never at something nearer', () => {
    // The text now appears AFTER the shrink, so a line like "Wait for the flip"
    // promises something the viewer watched three seconds ago. Every line has to
    // refer to the end of the video or to continuing to watch.
    const stale = /\b(flip|switch|swap|change)\b/i;
    for (const h of ALL_HOOKS) {
      expect(stale.test(h.text), `hook "${h.text}" points at the shrink, not the end`).toBe(false);
    }
  });

  it('makes every reveal actually reveal something', () => {
    for (const h of CTA_REVEALS) {
      // Either it names the technology, or it denies the footage was real.
      const says = /\b(ai|filmed|camera|generated|real|there)\b/i.test(h.text);
      expect(says, `reveal "${h.text}" does not reveal anything`).toBe(true);
    }
  });

  it('resolves every reveal and offer a plan can emit', () => {
    for (const p of FLAT) {
      expect(() => reveal(p.revealId)).not.toThrow();
      expect(() => offer(p.offerId)).not.toThrow();
    }
  });
});

describe('admissibility is structural, not filtered', () => {
  it('only ever pairs a family with a font its temperament allows', () => {
    for (const p of FLAT) {
      const ok = PALETTE_FAMILIES[p.family].temperaments.includes(FONT_BANK[p.font].temperament);
      expect(ok, `${p.family} got ${p.font}`).toBe(true);
    }
  });

  it('never puts bandStack on a dark family', () => {
    for (const p of FLAT) {
      if (p.archetype === 'bandStack') expect(PALETTE_FAMILIES[p.family].mode).toBe('light');
    }
  });

  it('only ever uses a harmony the family declares', () => {
    for (const p of FLAT) {
      expect(PALETTE_FAMILIES[p.family].harmonies).toContain(p.harmony);
    }
  });
});

describe('the honest combinatorial count', () => {
  it('reports how many genuinely distinct looks the banks support', () => {
    // This is the number to quote when somebody asks for ten thousand unique
    // videos. Jitter contributes NOTHING to it. The only lever that moves it is
    // more palette families, at roughly 50 looks each.
    let looks = 0;
    for (const k of FAMILY_KEYS) {
      const f = PALETTE_FAMILIES[k];
      const fonts = admissibleFonts(f.temperaments).length;
      const arches = f.mode === 'light' ? 7 : 6;
      looks += fonts * arches * f.harmonies.length;
    }
    // Recorded so a bank edit that shrinks variety shows up as a failing test
    // rather than as a quiet regression.
    expect(looks).toBeGreaterThanOrEqual(400);
    // A viewer meets one look, a rotation drawn from 24 retention lines, and one
    // of 80 end cards. The end card pairing is the honest second multiplier,
    // because it is the part they are guaranteed to read.
    // 16 rather than the 24 it held before, and the smaller bank is the better
    // one. A video now shows one line, occasionally two, so the bank is a
    // rotation ACROSS files rather than within one, and 16 buys sixteen videos
    // before a line comes round again. The eight that were cut were cut for
    // being wrong, not for being surplus: see the note at the head of hooks.ts.
    expect(RETENTION_BANK.length).toBeGreaterThanOrEqual(14);
    expect(CTA_REVEALS.length * CTA_OFFERS.length).toBeGreaterThanOrEqual(60);
    expect(looks * CTA_REVEALS.length * CTA_OFFERS.length).toBeGreaterThanOrEqual(30000);
  });
});

describe('everything stays inside the feed', () => {
  // Hugo spotted this in QuickTime: the hook was 48px from the top of a 1920
  // frame, about 2.5 percent, and every platform draws its own interface over
  // more than that. The first line of the one piece of text in the video was
  // being covered in the one place it has to be read.
  //
  // These are arithmetic on constants rather than measurements of output, which
  // is exactly why they are worth having: they fail the moment somebody makes
  // the phone bigger again, before anything is rendered or posted.
  const TOP_SAFE = 180;
  const BOTTOM_SAFE = 200;

  it('keeps the hook clear of the top of the frame', () => {
    expect(HOOK_SAFE_AREA.y).toBeGreaterThanOrEqual(TOP_SAFE);
  });

  it('keeps the phone clear of the bottom of the frame', () => {
    expect(CANVAS.h - (PHONE.y + PHONE.h)).toBeGreaterThanOrEqual(BOTTOM_SAFE);
  });

  it('leaves a real gap between the text and the device', () => {
    const gap = PHONE.y - (HOOK_SAFE_AREA.y + HOOK_SAFE_AREA.h);
    expect(gap).toBeGreaterThanOrEqual(30);
    expect(gap, 'the hook is floating, not sitting on the phone').toBeLessThanOrEqual(70);
  });

  it('gives the hook box enough height for the type it has to hold', () => {
    // The box has to fit the WORST case across every hook and every face, or a
    // long line silently overflows it and collides with the phone.
    let tallest = 0;
    for (const h of ALL_HOOKS) {
      for (const key of FONT_KEYS) {
        const spec = FONT_BANK[key];
        const size = sizeForCap(spec, HOOK_CAP_PX);
        const cased = spec.transform === 'uppercase' ? h.text.toUpperCase() : h.text;
        const lines = Math.ceil((cased.length * metrics(key).avgAdvanceEm * size) / HOOK_TEXT_W);
        expect(lines, `"${h.text}" wraps to ${lines} lines in ${key}`).toBeLessThanOrEqual(HOOK_MAX_LINES);
        tallest = Math.max(tallest, lines * size * spec.lineHeight);
      }
    }
    expect(tallest).toBeLessThanOrEqual(HOOK_SAFE_AREA.h);
  });

  it('never upscales the clip, at any zoom', () => {
    // A consequence of shrinking the phone that is worth holding onto. The
    // source is 720 wide and the screen is 676, so even at MAX_ZOOM there are
    // more source pixels than output pixels and the phone act is still
    // downsampling. Growing the screen past 720 / MAX_ZOOM would quietly
    // reintroduce upscaling on the majority of every video.
    const sourcePxPerOutputPx = 720 / (SCREEN.w * MAX_ZOOM);
    expect(sourcePxPerOutputPx).toBeGreaterThanOrEqual(1);
  });
});

describe('typography fits', () => {
  it('fits every hook in TWO lines on every font it can be paired with', () => {
    // Two, not three. The box is 190px tall now rather than 300, because the
    // 110px difference is what buys the hook a top margin that survives a real
    // feed. A three line hook would overflow it.
    //
    // Measured against HOOK_TEXT_W, not the full safe area: the hook sits inside
    // padding, and fitting to the outer width would let a long hook be silently
    // scaled down by the browser instead of failing here.
    const failures: string[] = [];
    for (const h of ALL_HOOKS) {
      for (const key of FONT_KEYS) {
        const spec = FONT_BANK[key];
        if (!fitHook(h.text, spec, HOOK_TEXT_W, HOOK_MAX_LINES)) {
          failures.push(`${h.id} does not fit in ${key}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('fits every end card line at the size it is actually drawn', () => {
    // The old version of this measured the end card against the HOOK's column
    // and the HOOK's cap height, and passed because fitHook is allowed to step
    // the size down until something fits. That proved only that SOME size works,
    // which is not the question. The end card renders at CTA_CAP_PX in
    // CTA_TEXT_AREA, so that is what gets measured, and the assertion is on the
    // uniform scale the block ends up needing.
    const worst: string[] = [];
    for (const o of CTA_OFFERS) {
      for (const key of FONT_KEYS) {
        const spec = FONT_BANK[key];
        const size = sizeForCap(spec, CTA_CAP_PX);
        const widest = Math.max(
          ...o.lines.map((l) => {
            const cased = spec.transform === 'uppercase' ? l.toUpperCase() : l;
            return cased.length * metrics(key).avgAdvanceEm * size;
          }),
        );
        const scale = Math.min(1, CTA_TEXT_AREA.w / widest);
        // Below this the end card reads as small print rather than as a close.
        // One greedy line shrinks the WHOLE block, because the offer renders as
        // a single text block sharing one scale.
        if (scale < 0.82) worst.push(`${o.id} in ${key} renders at ${scale.toFixed(2)}`);
      }
    }
    expect(worst).toEqual([]);
  });

  it('fits every reveal on one line at the size it is actually drawn', () => {
    // Measured at the reveal's OWN cap height, not the hook's. The reveal renders
    // at half HOOK_CAP_PX, so checking it with fitHook (which starts at the full
    // hook size and steps down) was asking a much harder question than the real
    // one and failed thirteen perfectly good combinations.
    const worst: string[] = [];
    for (const h of CTA_REVEALS) {
      for (const key of FONT_KEYS) {
        const spec = FONT_BANK[key];
        const size = sizeForCap(spec, Math.round(HOOK_CAP_PX * 0.5));
        const cased = spec.transform === 'uppercase' ? h.text.toUpperCase() : h.text;
        const w = cased.length * metrics(key).avgAdvanceEm * size;
        const scale = Math.min(1, CTA_TEXT_AREA.w / w);
        if (scale < 0.9) worst.push(`${h.id} in ${key} renders at ${scale.toFixed(2)}`);
      }
    }
    expect(worst).toEqual([]);
  });

  it('normalises size by cap height, times the optical correction', () => {
    // Cap-height normalisation is the baseline: it makes faces match in measured
    // size, which raw fontSize does not (Anton and Playfair at 96px look nothing
    // alike). capScale then corrects for PRESENCE, because a 400 italic serif at
    // the same cap height as an 800 grotesque still reads weaker. So the
    // invariant is cap = target x capScale, not cap = target.
    for (const k of FONT_KEYS) {
      const s = FONT_BANK[k];
      const cap = sizeForCap(s, 70) * metrics(s.key).capHeightEm;
      expect(cap, k).toBeCloseTo(70 * s.capScale, 0);
    }
  });

  it('only corrects the thin-stroked faces, and only upward', () => {
    for (const k of FONT_KEYS) {
      const s = FONT_BANK[k];
      expect(s.capScale, k).toBeGreaterThanOrEqual(1);
      expect(s.capScale, k).toBeLessThanOrEqual(1.25);
      // A heavy grotesque needs no help. If one acquires a correction, something
      // has been tuned by eye that should have been tuned in the metrics.
      if (s.weight >= 700 && s.temperament !== 'editorial') expect(s.capScale, k).toBe(1);
    }
  });
});

describe('per-variant type scale', () => {
  const caps = (id: string, n: number) =>
    Array.from({ length: n }, (_, i) => deriveRecipe(seedFor(id, i, RECIPE_VERSION), id));

  it('never scales UP past the caps the layout budget was derived from', () => {
    // The binding direction. HOOK_SAFE_AREA.h and the two-line guarantee were both
    // measured at HOOK_CAP_PX, so a variant above it overflows the box and lands
    // on the phone. Widening TYPE_SCALE_MAX is the mistake this catches.
    expect(TYPE_SCALE_MAX).toBeLessThanOrEqual(1);
    for (const id of SOURCE_IDS) {
      for (const r of caps(id, 400)) {
        expect(r.hookCapPx, `${id} hook cap`).toBeLessThanOrEqual(HOOK_CAP_PX);
        expect(r.ctaCapPx, `${id} cta cap`).toBeLessThanOrEqual(CTA_CAP_PX);
      }
    }
  });

  it('keeps every face clear of its own minSize across the whole range', () => {
    // The silent failure this exists for: TextBlock clamps UP to minSize, so a
    // face whose derived size falls under its floor stops varying entirely while
    // every other assertion here still passes. The scale would look implemented
    // and do nothing on that face.
    const clamped: string[] = [];
    for (const key of FONT_KEYS) {
      const spec = FONT_BANK[key];
      const smallest = sizeForCap(spec, Math.round(HOOK_CAP_PX * TYPE_SCALE_MIN));
      if (smallest < spec.minSize) {
        clamped.push(`${key} derives ${smallest} at the floor scale, under its minSize ${spec.minSize}`);
      }
    }
    expect(clamped).toEqual([]);
  });

  it('fits every hook in two lines at the LARGEST scale, which is the worst case', () => {
    // Smaller type fits more characters per line, so line count can only fall as
    // the scale drops. Checking the top of the range therefore covers all of it,
    // and this states that reasoning rather than leaving it to be rediscovered.
    const failures: string[] = [];
    for (const h of ALL_HOOKS) {
      for (const key of FONT_KEYS) {
        const big = fitHook(h.text, FONT_BANK[key], HOOK_TEXT_W, HOOK_MAX_LINES, HOOK_CAP_PX);
        const small = fitHook(
          h.text,
          FONT_BANK[key],
          HOOK_TEXT_W,
          HOOK_MAX_LINES,
          Math.round(HOOK_CAP_PX * TYPE_SCALE_MIN),
        );
        if (!big || !small) failures.push(`${h.id} in ${key}`);
        else if (small.fontSize > big.fontSize) failures.push(`${h.id} in ${key} grew as the scale fell`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('actually varies, and spans most of its range', () => {
    // Without this the whole feature can ship as a constant and nothing notices.
    const seen = new Set<number>();
    for (const id of SOURCE_IDS) for (const r of caps(id, 200)) seen.add(r.hookCapPx);
    expect(seen.size, 'the hook cap is not varying').toBeGreaterThanOrEqual(5);
    expect(Math.min(...seen)).toBeLessThanOrEqual(Math.round(HOOK_CAP_PX * TYPE_SCALE_MIN) + 1);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(HOOK_CAP_PX - 1);
  });

  it('moves the hook and the end card together, never apart', () => {
    // One scale drives both. A variant with a big hook and a small end card reads
    // as a bug, so the ratio is fixed by construction and asserted here.
    for (const id of SOURCE_IDS) {
      for (const r of caps(id, 200)) {
        const ratio = r.ctaCapPx / r.hookCapPx;
        expect(ratio, `${id} ${r.hookCapPx}/${r.ctaCapPx}`).toBeCloseTo(CTA_CAP_PX / HOOK_CAP_PX, 1);
      }
    }
  });

  it('leaves every other channel untouched, because the salt is new', () => {
    // The additive-channel guarantee from CHANNELS. Adding `type` must not shift
    // any decision that existed before it, or every previously reviewed variant
    // silently becomes a different video at the same seed.
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 60; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const again = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        expect(again.zoom).toBe(r.zoom);
        expect(again.dropFrame).toBe(r.dropFrame);
        expect(again.ambienceIndex).toBe(r.ambienceIndex);
        expect(again.hookCapPx).toBe(r.hookCapPx);
      }
    }
  });
});

describe('timing and duration', () => {
  it('keeps the head trim inside its safe window so no variant loses a word', () => {
    for (let i = 0; i < 2000; i++) {
      const t = deriveRecipe(seedFor('v3', i, 1), 'v3').trimHeadFrames;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(12);
    }
  });

  it('computes a duration of source minus trim plus the ten second end card', () => {
    for (const id of SOURCE_IDS) {
      const r = deriveRecipe(seedFor(id, 0, 1), id);
      expect(totalFrames(id, r)).toBe(resolveSource(id).frames - r.trimHeadFrames + 300);
    }
  });

  it('varies the timing between variants, in whole frames only', () => {
    // Sub-frame offsets do not exist in a rendered file. Every value here must
    // be an integer number of frames or it is a lie about what changed.
    const rs = Array.from({ length: 50 }, (_, i) => deriveRecipe(seedFor('v1', i, 1), 'v1'));
    // Named explicitly rather than swept over Object.values, because the recipe
    // also carries a zoom and two pan fractions now and those are continuous by
    // nature. Sweeping everything would either fail on them or, worse, get
    // "fixed" by rounding them and quietly delete the frame-accuracy guarantee
    // this test exists to hold.
    const timing = [
      'hookLeadFrames', 'hookStagger', 'hookCount', 'hookSwapFrame',
      'ctaLeadFrames', 'trimHeadFrames', 'dropFrame', 'dropFrames',
    ] as const;
    for (const r of rs) {
      for (const k of timing) expect(Number.isInteger(r[k]), `${k} = ${r[k]}`).toBe(true);
    }
    expect(new Set(rs.map((r) => r.dropFrames)).size).toBeGreaterThan(5);
  });

  it('drops into the phone around the middle of the clip, or on a real beat', () => {
    // Hugo's rule: the shrink is the structural midpoint, so it belongs at 40 to
    // 60 percent of whatever the clip is, not at a fixed number of seconds. Every
    // drop is either the seeded target itself or within DROP_JITTER of a detected
    // beat, and it can never wander more than DROP_SNAP outside the window.
    for (const id of SOURCE_IDS) {
      const src = resolveSource(id);
      for (let i = 0; i < 300; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const body = bodyFrames(id, r);
        const lo = Math.round(body * DROP_FRACTION_MIN);
        const hi = Math.round(body * DROP_FRACTION_MAX);
        const where = `${id}#${i} dropped at ${r.dropFrame} of ${body} (${((r.dropFrame / body) * 100).toFixed(0)}%)`;

        expect(r.dropFrame, where).toBeGreaterThanOrEqual(DROP_FLOOR);
        expect(r.dropFrame, where).toBeLessThanOrEqual(hi + DROP_SNAP + DROP_JITTER);

        const onTarget = r.dropFrame >= lo && r.dropFrame <= hi;
        const onBeat = src.beats.some(
          (b) => Math.abs(b - (r.dropFrame + r.trimHeadFrames)) <= DROP_JITTER,
        );
        expect(onTarget || onBeat, `${where}, neither on target nor near a beat`).toBe(true);
      }
    }
  });

  it('keeps the drop near the middle even after snapping to a beat', () => {
    // The snap is allowed to move the target by 1.5s, so the realised fraction
    // can sit a little outside 40-60. It must not drift far: a drop at 20 percent
    // or 80 percent is a different video, not a variation of this one.
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 300; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const f = r.dropFrame / bodyFrames(id, r);
        expect(f, `${id}#${i} drops at ${(f * 100).toFixed(0)}%`).toBeGreaterThan(0.3);
        expect(f, `${id}#${i} drops at ${(f * 100).toFixed(0)}%`).toBeLessThan(0.72);
      }
    }
  });

  it('shows nothing at all over the opening', () => {
    // The clip plays clean until the phone appears. This asserts the timing the
    // component reads, so a future edit that starts the text at frame 0 again
    // fails here rather than in a contact sheet nobody looked at closely.
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 200; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const firstText = r.dropFrame + r.dropFrames + r.hookLeadFrames;
        expect(firstText, `${id}#${i}`).toBeGreaterThan(r.dropFrame + r.dropFrames);
        expect(r.hookLeadFrames, `${id}#${i}`).toBeGreaterThan(0);
      }
    }
  });

  it('actually uses the beats rather than quietly always falling back', () => {
    // A regex that stopped matching, or an ffmpeg flag that suppressed the very
    // lines being parsed, would leave every beat list empty and this whole
    // feature would degrade to a fixed timer with nobody noticing.
    for (const spec of SOURCE_SPECS) {
      expect(spec.beats.length, `${spec.id} has no beats`).toBeGreaterThan(0);
      const sorted = [...spec.beats].sort((a, b) => a - b);
      expect(spec.beats, `${spec.id} beats are not ascending`).toEqual(sorted);
      expect(new Set(spec.beats).size, `${spec.id} has duplicate beats`).toBe(spec.beats.length);
      for (const b of spec.beats) {
        expect(b, `${spec.id} beat ${b} is outside the clip`).toBeGreaterThan(0);
        expect(b).toBeLessThan(spec.frames);
      }

      const snapped = Array.from({ length: 200 }, (_, i) => {
        const r = deriveRecipe(seedFor(spec.id, i, RECIPE_VERSION), spec.id);
        return spec.beats.some((b) => Math.abs(b - (r.dropFrame + r.trimHeadFrames)) <= DROP_JITTER);
      });
      expect(snapped.some(Boolean), `${spec.id} never snapped to a beat`).toBe(true);
    }
  });

  it('always leaves the clip long enough inside the phone to be the point', () => {
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 200; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const body = bodyFrames(id, r);
        const where = `${id}#${i}`;
        // The shrink has to finish, and finish well before the end card.
        expect(r.dropFrame + r.dropFrames, where).toBeLessThan(body);
        expect(body - r.dropFrame, where).toBeGreaterThanOrEqual(MIN_PHONE_FRAMES);
      }
    }
  });

  it('shows ONE hook, or at most two with a single swap', () => {
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 200; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const where = `${id}#${i}`;
        // Hugo's call, and the rule the copy depends on: there is ONE message,
        // so it is shown once and left alone. Rotating it diluted it and stole
        // attention from the clip.
        expect(r.hookCount, where).toBeGreaterThanOrEqual(1);
        expect(r.hookCount, where).toBeLessThanOrEqual(2);

        const textStart = r.dropFrame + r.dropFrames + r.hookLeadFrames;
        const window = bodyFrames(id, r) - textStart;
        if (r.hookCount === 1) {
          expect(r.hookSwapFrame, `${where} has no second hook but swaps`).toBe(0);
        } else {
          // A swap only happens where both lines get a real run, and never so
          // late that the second one is on screen for a moment before the cut.
          expect(window, where).toBeGreaterThanOrEqual(MIN_HOOK_WINDOW);
          expect(r.hookSwapFrame, where).toBeGreaterThan(textStart + window * 0.4);
          expect(r.hookSwapFrame, where).toBeLessThan(textStart + window * 0.7);
        }
      }
    }
  });

  it('gives the same clip the same rhythm every time it is planned', () => {
    // Hugo's rule: nail the rhythm once for a master clip and every variation of
    // it reuses that, rather than relearning per render. The beat map is read
    // from the manifest, so two calls a thousand renders apart agree.
    for (const id of SOURCE_IDS) {
      const a = deriveRecipe(seedFor(id, 7, RECIPE_VERSION), id);
      const b = deriveRecipe(seedFor(id, 7, RECIPE_VERSION), id);
      expect(a).toEqual(b);
    }
  });

  it('still varies the drop between variants of the same clip', () => {
    // Same clip, same beat map, but a thousand identically timed cuts is exactly
    // the signature the randomisation exists to avoid.
    for (const id of SOURCE_IDS) {
      const drops = new Set(
        Array.from({ length: 60 }, (_, i) => deriveRecipe(seedFor(id, i, RECIPE_VERSION), id).dropFrame),
      );
      expect(drops.size, `${id} only ever drops at ${[...drops]}`).toBeGreaterThan(3);
    }
  });

  it('never lets a zoom or pan pull the frame edge into shot, at any point in the drift', () => {
    // A pan wider than the headroom its own zoom created shows the background
    // through the side of the clip for a few frames. It is subtle, it survives
    // a contact sheet, and it is in every one of that variant's thousand files.
    // Swept across the whole drift, not just its endpoints, because the clip is
    // moving between two positions for the entire opening.
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 200; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        for (const u of [0, 0.13, 0.37, 0.5, 0.62, 0.88, 1]) {
          const m = motionAt(r, u);
          const headroomPct = ((m.zoom - 1) / 2) * 100;
          const parsed = clipTransform(m).match(/translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)/);
          expect(parsed, `${id}#${i} transform did not parse`).not.toBeNull();
          const [x, y] = [Number(parsed?.[1]), Number(parsed?.[2])];
          const where = `${id}#${i} at u=${u}`;
          // Tolerance is the rounding in clipTransform.
          expect(Math.abs(x), `${where} pans ${x}% on ${headroomPct}%`).toBeLessThanOrEqual(headroomPct + 0.0001);
          expect(Math.abs(y), `${where} pans ${y}% on ${headroomPct}%`).toBeLessThanOrEqual(headroomPct + 0.0001);
        }
      }
    }
  });

  it('makes frame one geometrically unique for every variant of a clip', () => {
    // THE OPENING TEST. Before the drift existed, the roughly one file in five
    // that rested at zoom 1.000 with no mirror had a pixel-identical opening to
    // every other such file of the same clip: the background is completely
    // hidden behind the full-bleed video, so only the hook text differed.
    // Frame one is also the most exposed moment there is, because the hook has
    // not faded in yet for the first few frames.
    for (const id of SOURCE_IDS) {
      const openings = Array.from({ length: 250 }, (_, i) =>
        clipTransform(motionAt(deriveRecipe(seedFor(id, i, RECIPE_VERSION), id), 0)),
      );
      expect(new Set(openings).size, `${id} repeats an opening frame`).toBe(openings.length);
    }
  });

  it('always leaves the opening something to drift towards', () => {
    // If the opening zoom landed on the resting zoom there would be no drift and
    // no uniqueness, which is exactly the case for the fifth of variants that
    // rest at 1.000. And it must stay above 1, or the opening pan collapses to
    // zero for want of headroom and takes half the variation with it.
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 400; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const where = `${id}#${i}`;
        expect(Math.abs(r.openZoom - r.zoom), where).toBeGreaterThanOrEqual(OPEN_ZOOM_DRIFT - 1e-9);
        expect(r.openZoom, where).toBeGreaterThanOrEqual(OPEN_ZOOM_MIN - 1e-9);
        expect(r.openZoom, where).toBeLessThanOrEqual(OPEN_ZOOM_MAX + 1e-9);
      }
    }
  });

  it('converges on the resting transform exactly, so the handover cannot jump', () => {
    // At the end of the shrink the composition swaps from the upscaled 1080 twin
    // to the untouched 720 file. They are drawing the same content at the same
    // size at that instant, which is the only reason the swap is invisible. If
    // the drift did not land exactly on the resting transform, every single file
    // would twitch at the same moment.
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 100; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        expect(clipTransform(motionAt(r, 1)), `${id}#${i}`).toBe(clipTransform(restMotion(r)));
      }
    }
  });

  it('keeps the grade invisible, and takes it off entirely for the phone act', () => {
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 200; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const where = `${id}#${i}`;
        for (const v of [r.gradeContrast, r.gradeSaturate, r.gradeBrightness]) {
          expect(Math.abs(v - 1), where).toBeLessThanOrEqual(MAX_GRADE + 1e-9);
        }
        // Brightness is held to half, because the eye reads a level shift far
        // more readily than a contrast or colour one.
        expect(Math.abs(r.gradeBrightness - 1), where).toBeLessThanOrEqual(MAX_GRADE / 2 + 1e-9);
        // 'none', not 'contrast(1) saturate(1) brightness(1)': the phone act must
        // carry no filter property at all, so its pixels are never put through a
        // colour transform in the compositor.
        expect(gradeFilter(r, 0), where).toBe('none');
        expect(gradeFilter(r, 1), where).not.toBe('none');
      }
    }
  });

  it('gives every variant a different grade', () => {
    for (const id of SOURCE_IDS) {
      const grades = Array.from({ length: 200 }, (_, i) =>
        gradeFilter(deriveRecipe(seedFor(id, i, RECIPE_VERSION), id), 1),
      );
      expect(new Set(grades).size, `${id} repeats a grade`).toBe(grades.length);
    }
  });

  it('keeps the zoom inside the measured quality budget, and sometimes at exactly 1', () => {
    // The cap is a measurement, not a preference: see MAX_ZOOM. And the bottom
    // step has to be exactly 1.000, because a continuous range would mean no
    // variant is ever pixel-exact in exchange for nothing a hash can tell apart.
    const zooms = new Set<number>();
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 400; i++) {
        const z = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id).zoom;
        expect(z, `${id}#${i}`).toBeGreaterThanOrEqual(1);
        expect(z, `${id}#${i}`).toBeLessThanOrEqual(MAX_ZOOM + 1e-9);
        zooms.add(Number(z.toFixed(6)));
      }
    }
    expect(zooms.has(1)).toBe(true);
    expect(zooms.size).toBe(5);
  });

  it('only mirrors clips whose manifest allows it', () => {
    for (const spec of SOURCE_SPECS) {
      const flips = Array.from({ length: 200 }, (_, i) =>
        deriveRecipe(seedFor(spec.id, i, RECIPE_VERSION), spec.id).flip,
      );
      // Defaults to FALSE now, so an absent flag means no mirroring. Three of
      // the four demos carry a product label or a burned-in caption and cannot
      // be mirrored at all; see the note on allowFlip in recipe.ts.
      if (!spec.allowFlip) {
        expect(flips.some(Boolean), `${spec.id} was mirrored despite allowFlip off`).toBe(false);
      } else {
        // Roughly half, and it genuinely has to vary or it is not a lever.
        const rate = flips.filter(Boolean).length / flips.length;
        expect(rate, `${spec.id} mirror rate ${rate}`).toBeGreaterThan(0.3);
        expect(rate, `${spec.id} mirror rate ${rate}`).toBeLessThan(0.7);
      }
    }
  });

  it('gives siblings genuinely different edits, not just different paint', () => {
    // THE CLUSTER TEST. A hundred accounts posting the same cut with recoloured
    // borders is the pattern that gets a network actioned as a network, and no
    // amount of palette work fixes it. So the EDIT itself has to differ: where
    // the shrink lands, how fast it moves, how it accelerates, which way round
    // the clip runs, how far into it we are. Measured on the fingerprint of the
    // edit alone, with every colour decision deliberately excluded.
    const editOf = (id: string, i: number) => {
      const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
      return [r.dropFrame, r.dropFrames, r.dropEase, r.flip, r.zoom, r.trimHeadFrames]
        .map(String)
        .join('|');
    };

    for (const id of SOURCE_IDS) {
      // Two variants of one clip may not be edited the same way back to back.
      // Consecutive is what matters: those are the two that get posted hours
      // apart to an overlapping audience.
      for (let i = 1; i < 60; i++) {
        expect(editOf(id, i), `${id}#${i} is cut identically to #${i - 1}`).not.toBe(editOf(id, i - 1));
      }

      // Across a longer run, exact repeats are allowed but must stay rare. The
      // edit space is about 7,400 combinations, so at 60 draws the birthday
      // maths predicts a couple of collisions and demanding zero would be
      // demanding luck. v3 is the clip that finds them: it has the fewest
      // detected beats, so its drop has the fewest places to land.
      const edits = Array.from({ length: 60 }, (_, i) => editOf(id, i));
      expect(new Set(edits).size / edits.length, `${id} repeats its edit too often`)
        .toBeGreaterThan(0.9);
    }

    // And the thing that actually matters: no two variants of a clip may share
    // an edit AND a look. That is the pair a human, or a matcher, would call
    // the same video.
    for (const plans of PLANS) {
      const whole = plans.map(
        (p) => `${editOf(p.sourceId, p.variantIndex)}|${p.family}|${p.font}|${p.archetype}`,
      );
      expect(new Set(whole).size, `${plans[0].sourceId} produced two identical videos`).toBe(whole.length);
    }
  });

  it('gives every single video an ambient bed, with no exceptions', () => {
    // Hugo's hard rule: every video gets a low level background layer. There is
    // no opt-out and no default-off path, so this asserts the whole range rather
    // than a flag.
    for (const id of SOURCE_IDS) {
      for (let i = 0; i < 300; i++) {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        const where = `${id}#${i}`;
        expect(r.ambienceGain, where).toBeGreaterThanOrEqual(AMBIENCE_GAIN_MIN);
        expect(r.ambienceGain, where).toBeLessThanOrEqual(AMBIENCE_GAIN_MAX);
        expect(r.ambienceIndex, where).toBeGreaterThanOrEqual(0);
        expect(r.ambienceIndex, where).toBeLessThan(AMBIENCE_COUNT);
        expect(Number.isInteger(r.ambienceIndex), where).toBe(true);

        // The bed must outlast the video. Running out would either loop, which
        // is a periodic artefact and worse than no bed, or fall silent.
        const covered = AMBIENCE_SECONDS * 30 - r.ambienceStartFrame;
        expect(covered, `${where} bed runs out`).toBeGreaterThanOrEqual(totalFrames(id, r));
        expect(r.ambienceStartFrame, where).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('gives every variant a different bed, or a different piece of one', () => {
    // Sharing a bed is fine; sharing a bed AND a start point is not, because
    // those two files then carry the identical waveform underneath them.
    //
    // Exact repeats over a long run are allowed and must stay rare, for the same
    // birthday reason as the edit test above: 20 beds against roughly 3,300 start
    // frames is about 66,000 combinations, so at 200 draws a collision is
    // expected about once every three runs. Demanding zero would be demanding
    // luck rather than testing a property.
    for (const id of SOURCE_IDS) {
      const bedOf = (i: number) => {
        const r = deriveRecipe(seedFor(id, i, RECIPE_VERSION), id);
        return `${ambienceFile(r)}@${r.ambienceStartFrame}`;
      };
      for (let i = 1; i < 80; i++) {
        expect(bedOf(i), `${id}#${i} shares a bed with #${i - 1}`).not.toBe(bedOf(i - 1));
      }
      const beds = Array.from({ length: 200 }, (_, i) => bedOf(i));
      expect(new Set(beds).size / beds.length, `${id} repeats its bed too often`)
        .toBeGreaterThan(0.98);
    }
  });

  it('has the bed pool the recipe expects, actually on disk', () => {
    // Two files holding the same count. A variant asking for bed 24 of 20 would
    // render with no bed at all and nothing else would report it.
    const script = readFileSync(join(__dirname, '..', '..', 'scripts', 'make-ambience.mjs'), 'utf8');
    expect(Number(script.match(/export const COUNT = (\d+)/)?.[1])).toBe(AMBIENCE_COUNT);
    expect(Number(script.match(/export const SECONDS = (\d+)/)?.[1])).toBe(AMBIENCE_SECONDS);

    const dir = join(__dirname, '..', '..', 'public', 'ambience');
    const have = readdirSync(dir).filter((f) => /^amb-\d\d\.m4a$/.test(f));
    expect(have.length, `only ${have.length} beds built, run scripts/make-ambience.mjs`).toBe(AMBIENCE_COUNT);
    // And every index the recipe can emit must resolve to one of them.
    for (let i = 0; i < AMBIENCE_COUNT; i++) {
      const name = ambienceFile({ ambienceIndex: i } as never).replace('ambience/', '');
      expect(have, `bed ${i} is missing`).toContain(name);
    }
  });

  it('keeps the batch renderer on the same recipe version as the plan', () => {
    // Two files, one number. If render-variants.mjs defaulted to a different
    // version, every rendered file would be seeded differently from the plan the
    // test suite just proved correct, and nothing would report it.
    const src = readFileSync(join(__dirname, '..', '..', 'scripts', 'render-variants.mjs'), 'utf8');
    const m = src.match(/arg\('recipeVersion',\s*(\d+)\)/);
    expect(m, 'could not find the recipeVersion default in render-variants.mjs').not.toBeNull();
    expect(Number(m?.[1])).toBe(RECIPE_VERSION);
  });

  it('gives every channel a distinct salt', () => {
    // Two channels sharing a salt would silently couple two decisions that are
    // supposed to be independent.
    const vals = Object.values(CHANNELS);
    expect(new Set(vals).size).toBe(vals.length);
  });
});

describe('the seed primitives', () => {
  it('hashes stably', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });

  it('shuffles deterministically and without losing items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffled(items, 'x')).toEqual(shuffled(items, 'x'));
    expect(shuffled(items, 'x').sort()).toEqual(items);
    expect(shuffled(items, 'x')).not.toEqual(shuffled(items, 'y'));
  });

  it('deals every item once before repeating any', () => {
    const d = new Deck(['a', 'b', 'c', 'd'], 'deck');
    const first = [d.take(), d.take(), d.take(), d.take()];
    expect(new Set(first).size).toBe(4);
  });

  it('moves an admissible item forward rather than skipping it', () => {
    // The forward swap is what preserves "every item used once before any
    // repeat". A skip would leave holes that never get dealt at all.
    const order = ['a', 'b', 'c', 'd'];
    const got = drawConstrained(order, 0, (x) => x === 'c');
    expect(got).toBe('c');
    expect(order[0]).toBe('c');
    expect(order.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('discards the weakly mixed first draws', () => {
    // Two labels differing by one character must not produce correlated first
    // values, which mulberry32 does without the discard.
    const a = stream('seed-a')();
    const b = stream('seed-b')();
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });

  it('refuses an empty deck rather than dealing undefined forever', () => {
    expect(() => new Deck([], 'empty')).toThrow();
  });
});

describe('codebase invariants', () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('uses no Math.random or Date.now anywhere in the pure core', () => {
    // Parallel render workers must produce identical frames. This is the rule
    // that guarantees it, and it is cheaper to scan for than to debug.
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src.includes('Math.random('), `${f} uses Math.random`).toBe(false);
      expect(src.includes('Date.now('), `${f} uses Date.now`).toBe(false);
    }
  });

  it('writes no long dashes, curly quotes or ellipsis characters', () => {
    // A standing repo rule. It matters here because this copy gets pasted into
    // SMS and captions, where one long dash drops a text from 160 characters a
    // segment to 70.
    // The pattern is written with escapes on purpose. Spelling the characters
    // out literally would put them in the very file this test scans, so the
    // guard would fail on itself.
    const banned = /[\u2013\u2014\u2018\u2019\u201c\u201d\u2026]/;
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      const hit = src.match(banned);
      expect(hit, `${f} contains ${hit?.[0]}`).toBeNull();
    }
  });

  it('keeps the pure core free of Remotion imports', () => {
    // This is what keeps the 1,000-plan sweep above running in node in under a
    // second. The moment something here imports remotion, it stops being
    // testable without a browser.
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(/from ['"]remotion['"]/.test(src), `${f} imports remotion`).toBe(false);
    }
  });
});
