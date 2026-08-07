// The test that decides whether a family is allowed to exist.
//
// Point of order on what "worst case" means here: the gate is run against the
// jittered gradient EXTREMES, not against the nominal canvas. A family that only
// passes at its anchor is not safe, because no rendered variant uses the anchor.

import { describe, expect, it } from 'vitest';
import {
  antiMud,
  buildPalette,
  deriveRimAlpha,
  DEFAULT_JITTER,
  FAMILY_KEYS,
  family,
  inOliveBand,
  ON_ACCENT_HEX,
  paletteExtremes,
  PALETTE_FAMILIES,
  type FamilyKey,
  type HarmonyKey,
} from './palettes';
import { stream } from './seed';
import { apcaLc, gateText, TEXT_ROLES, wcagRatio } from './contrast';
import { deltaE, hexToOklch, hueDistance, inGamut, toHex } from './oklch';

const SEEDS = 400;

/** Every (family, harmony, seed) combination the system can actually emit. */
function everyPalette() {
  const out: { key: FamilyKey; harmony: HarmonyKey; seed: number; p: ReturnType<typeof buildPalette> }[] = [];
  for (const key of FAMILY_KEYS) {
    for (const harmony of family(key).harmonies) {
      for (let s = 0; s < SEEDS; s++) {
        out.push({ key, harmony, seed: s, p: buildPalette(key, harmony, stream(`t|${key}|${harmony}|${s}`)) });
      }
    }
  }
  return out;
}

const ALL = everyPalette();

describe('the family bank', () => {
  it('has 14 families and every key matches its record key', () => {
    expect(FAMILY_KEYS).toHaveLength(14);
    for (const k of FAMILY_KEYS) expect(PALETTE_FAMILIES[k].key).toBe(k);
  });

  it('keeps every pair of families visibly apart', () => {
    // Either a real hue difference or a real lightness difference. This is what
    // stops ink-signal and cobalt-glass reading as the same video.
    for (let i = 0; i < FAMILY_KEYS.length; i++) {
      for (let j = i + 1; j < FAMILY_KEYS.length; j++) {
        const a = family(FAMILY_KEYS[i]).canvas;
        const b = family(FAMILY_KEYS[j]).canvas;
        const apart = hueDistance(a.H, b.H) >= 25 || Math.abs(a.L - b.L) >= 0.18;
        expect(apart, `${FAMILY_KEYS[i]} vs ${FAMILY_KEYS[j]}`).toBe(true);
      }
    }
  });

  it('derives the hue jitter bound from the family separation', () => {
    // 25 degrees apart minus 6 of jitter on each side still leaves 13. If
    // someone widens canvas.H past 12 this stops being true.
    expect(DEFAULT_JITTER.canvas.H * 2).toBeLessThan(25 - 12);
  });

  it('gives every family at least one harmony, temperament and note', () => {
    for (const k of FAMILY_KEYS) {
      const f = family(k);
      expect(f.harmonies.length, k).toBeGreaterThan(0);
      expect(f.temperaments.length, k).toBeGreaterThan(0);
      expect(f.note.length, k).toBeGreaterThan(10);
    }
  });

  it('points deepDelta down and liftDelta up on every family', () => {
    for (const k of FAMILY_KEYS) {
      expect(family(k).deepDelta, k).toBeLessThan(0);
      expect(family(k).liftDelta, k).toBeGreaterThan(0);
    }
  });

  it('throws on an unknown family rather than returning a silent default', () => {
    expect(() => family('taupe-disaster')).toThrow();
  });
});

describe('the contrast gate holds at the gradient extremes', () => {
  it('passes the hook floor for every family, harmony and seed', () => {
    const failures: string[] = [];
    for (const { key, harmony, seed, p } of ALL) {
      const r = gateText(p.ink, paletteExtremes(p), TEXT_ROLES.hook);
      if (!r.pass) {
        failures.push(
          `${key}/${harmony}/seed${seed}: ink ${p.ink} on ${r.worstAgainst} ` +
            `Lc ${r.worstLc.toFixed(1)} WCAG ${r.worstWcag.toFixed(2)}`,
        );
      }
    }
    expect(failures.slice(0, 8).join('\n')).toBe('');
  });

  it('passes the stricter end card body floor too', () => {
    const failures: string[] = [];
    for (const { key, harmony, seed, p } of ALL) {
      const r = gateText(p.ink, paletteExtremes(p), TEXT_ROLES.ctaBody);
      if (!r.pass) {
        failures.push(`${key}/${harmony}/seed${seed}: Lc ${r.worstLc.toFixed(1)}`);
      }
    }
    expect(failures.slice(0, 8).join('\n')).toBe('');
  });

  it('keeps ON_ACCENT_HEX readable on every accent pill the system can emit', () => {
    const failures: string[] = [];
    for (const { key, harmony, p } of ALL) {
      const lc = apcaLc(ON_ACCENT_HEX, p.accentFill);
      const wc = wcagRatio(ON_ACCENT_HEX, p.accentFill);
      if (lc < TEXT_ROLES.onAccent.minLc || wc < TEXT_ROLES.onAccent.minWcag) {
        failures.push(`${key}/${harmony}: ${p.accentFill} Lc ${lc.toFixed(1)} WCAG ${wc.toFixed(2)}`);
      }
    }
    expect(failures.slice(0, 8).join('\n')).toBe('');
  });

  it('FAILS on a deliberately broken family, so the gate is not vacuous', () => {
    // The negative control. Without this, a bug in gateText or paletteExtremes
    // makes every assertion above pass while checking nothing at all.
    const p = buildPalette('bone-ink', 'anchor', stream('neg'));
    const broken = { ...p, ink: toHex(p.canvasLift) };
    expect(gateText(broken.ink, paletteExtremes(broken), TEXT_ROLES.hook).pass).toBe(false);
  });
});

describe('colour quality', () => {
  const allColours = () =>
    ALL.flatMap(({ key, p }) => [
      { key, role: 'canvas', c: p.canvas },
      { key, role: 'canvasDeep', c: p.canvasDeep },
      { key, role: 'canvasLift', c: p.canvasLift },
      { key, role: 'accent', c: p.accent },
      { key, role: 'ink', c: hexToOklch(p.ink) },
      { key, role: 'accentFill', c: hexToOklch(p.accentFill) },
    ]);

  it('emits nothing in the chroma dead zone', () => {
    const bad = allColours().filter(
      ({ c }) => c.L >= 0.4 && c.L <= 0.62 && c.C >= 0.03 && c.C <= 0.09,
    );
    expect(bad.slice(0, 5).map((b) => `${b.key}/${b.role} L${b.c.L.toFixed(3)} C${b.c.C.toFixed(3)}`)).toEqual([]);
  });

  it('emits nothing in the olive band', () => {
    const bad = allColours().filter(
      ({ c }) => c.H >= 70 && c.H <= 105 && c.C > 0.03 && c.L < 0.78,
    );
    expect(bad.slice(0, 5).map((b) => `${b.key}/${b.role} H${b.c.H.toFixed(0)} L${b.c.L.toFixed(3)}`)).toEqual([]);
  });

  it('emits no dirty extremes', () => {
    const bad = allColours().filter(({ c }) => (c.C > 0.05 && c.L < 0.16) || (c.C > 0.04 && c.L > 0.97));
    expect(bad.slice(0, 5).map((b) => `${b.key}/${b.role}`)).toEqual([]);
  });

  it('emits only in-gamut colours', () => {
    const bad = allColours().filter(({ c }) => !inGamut(c));
    expect(bad.slice(0, 5).map((b) => `${b.key}/${b.role}`)).toEqual([]);
  });

  it('round trips every emitted colour to hex without a silent clamp', () => {
    // Proves gamut clipping ran BEFORE hex conversion. If it did not, toHex
    // would clamp an RGB channel and shift lightness and hue with it.
    const bad = allColours().filter(({ c }) => deltaE(c, hexToOklch(toHex(c))) > 0.02);
    expect(bad.slice(0, 5).map((b) => `${b.key}/${b.role}`)).toEqual([]);
  });

  it('orders the gradient stops darkest to lightest, always', () => {
    for (const { key, p } of ALL) {
      expect(p.canvasDeep.L, `${key} deep vs canvas`).toBeLessThan(p.canvas.L + 1e-9);
      expect(p.canvasLift.L, `${key} lift vs canvas`).toBeGreaterThan(p.canvas.L - 1e-9);
    }
  });

  it('forces accentFill light and accentInk dark', () => {
    for (const { key, p } of ALL) {
      expect(hexToOklch(p.accentFill).L, `${key} accentFill`).toBeGreaterThanOrEqual(0.77);
      if (p.accentInk) {
        expect(hexToOklch(p.accentInk).L, `${key} accentInk`).toBeLessThanOrEqual(0.51);
      }
    }
  });

  it('gives accentInk only to light families whose accent is outside the olive band', () => {
    // A dark accent is unreadable on a dark canvas, and a dark olive is exactly
    // what MUD-2 forbids. Both exclusions are deliberate, so assert both rather
    // than just "light families get one".
    for (const { key, p } of ALL) {
      const eligible = family(key).mode === 'light' && !inOliveBand(p.accent.H);
      if (!eligible) expect(p.accentInk, key).toBeNull();
    }
    // At least one family must actually produce an accentInk, or this rule has
    // quietly disabled the feature everywhere and the assertion above is vacuous.
    expect(ALL.some(({ p }) => p.accentInk !== null)).toBe(true);
  });
});

describe('jitter containment', () => {
  it('never walks a family more than its bound from the anchor hue', () => {
    for (const { key, p } of ALL) {
      const anchor = family(key).canvas.H;
      expect(hueDistance(p.canvas.H, anchor), key).toBeLessThanOrEqual(DEFAULT_JITTER.canvas.H + 1e-6);
    }
  });

  it('never brings a family within 13 degrees of a neighbour anchor', () => {
    for (const { key, p } of ALL) {
      for (const other of FAMILY_KEYS) {
        if (other === key) continue;
        const a = family(other).canvas;
        // Only meaningful for families separated by hue rather than by lightness.
        if (Math.abs(family(key).canvas.L - a.L) >= 0.18) continue;
        expect(hueDistance(p.canvas.H, a.H), `${key} drifted toward ${other}`).toBeGreaterThan(12);
      }
    }
  });

  it('leaves a locked ink exactly locked', () => {
    for (const { key, p } of ALL) {
      const locked = family(key).inkLocked;
      if (locked) expect(p.ink).toBe(locked);
    }
  });

  it('moves the palette between seeds, or jitter is doing nothing', () => {
    const a = buildPalette('ultraviolet', 'anchor', stream('a'));
    const b = buildPalette('ultraviolet', 'anchor', stream('b'));
    expect(deltaE(a.canvas, b.canvas)).toBeGreaterThan(0);
  });

  it('is deterministic for the same label', () => {
    const a = buildPalette('sea-glass', 'anchor', stream('same'));
    const b = buildPalette('sea-glass', 'anchor', stream('same'));
    expect(a).toEqual(b);
  });

  it('keeps the stream position stable whether or not ink is locked', () => {
    // cobalt-glass locks its ink. If the locked branch consumed a different
    // number of draws, adding or removing a lock later would reshuffle the
    // accent of every variant of that family.
    const next = stream('position');
    buildPalette('cobalt-glass', 'anchor', next);
    const afterLocked = next();
    const next2 = stream('position');
    buildPalette('ink-signal', 'anchor', next2);
    const afterUnlocked = next2();
    expect(afterLocked).toBe(afterUnlocked);
  });
});

describe('antiMud', () => {
  it('pushes a dead-zone colour out to one side or the other', () => {
    // Low chroma commits to neutral.
    expect(antiMud({ L: 0.5, C: 0.04, H: 200 }).C).toBeLessThan(0.03);
    // High chroma commits to colour, where the gamut allows it. Magenta does.
    expect(antiMud({ L: 0.5, C: 0.08, H: 330 }).C).toBeGreaterThan(0.09);
  });

  it('falls back to neutral when the gamut cannot reach the colourful side', () => {
    // Cyan at L 0.5 tops out around chroma 0.085, so the whole reachable range
    // is inside the dead zone. Committing to neutral is the only way out, and
    // getting this wrong is what the seed sweep caught.
    const out = antiMud({ L: 0.5, C: 0.08, H: 200 });
    expect(out.C).toBeLessThan(0.03);
  });

  it('never returns a dead-zone colour, at any hue', () => {
    for (let H = 0; H < 360; H += 5) {
      for (const C of [0.035, 0.05, 0.07, 0.089]) {
        for (const L of [0.42, 0.5, 0.58]) {
          const out = antiMud({ L, C, H });
          const stuck = out.L >= 0.4 && out.L <= 0.62 && out.C >= 0.03 && out.C <= 0.09;
          expect(stuck, `H${H} C${C} L${L} -> C${out.C.toFixed(3)}`).toBe(false);
        }
      }
    }
  });

  it('lifts a khaki into gold rather than leaving it muddy', () => {
    expect(antiMud({ L: 0.5, C: 0.1, H: 85 }).L).toBeGreaterThanOrEqual(0.78);
  });

  it('spares a near-neutral in the olive hue range', () => {
    // champagne-noir's ink lives here. Its chroma is below the gate, so it must
    // not be dragged up to L 0.78 and turned into gold.
    expect(antiMud({ L: 0.18, C: 0.01, H: 85 }).L).toBeCloseTo(0.18, 6);
  });

  it('rescues dirty extremes at both ends', () => {
    expect(antiMud({ L: 0.05, C: 0.15, H: 300 }).L).toBeGreaterThanOrEqual(0.16);
    expect(antiMud({ L: 0.99, C: 0.2, H: 300 }).C).toBeLessThanOrEqual(0.04);
  });
});

describe('deriveRimAlpha', () => {
  it('is strongest when the background is closest to the bezel', () => {
    expect(deriveRimAlpha(0)).toBe(0.55);
    expect(deriveRimAlpha(0.05)).toBe(0.55);
  });

  it('is weakest when the background is far from the bezel', () => {
    expect(deriveRimAlpha(0.8)).toBe(0.1);
  });

  it('never increases as the background gets further from the bezel', () => {
    // A sign error here would put a strong white rim on a white background,
    // which reads as a rendering bug rather than a design choice.
    let prev = Infinity;
    for (let d = 0; d <= 1; d += 0.01) {
      const a = deriveRimAlpha(d);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
  });

  it('stays inside its declared range for any input', () => {
    for (const d of [-5, -0.1, 0, 0.15, 0.5, 5, 100]) {
      const a = deriveRimAlpha(d);
      expect(a).toBeGreaterThanOrEqual(0.1);
      expect(a).toBeLessThanOrEqual(0.55);
    }
  });
});
