// The gate that decides whether an archetype is allowed to exist.
//
// palettes.test.ts checks the ink against the three gradient stops. This file
// checks it against the COMPOSITED background: the actual pixel under the text,
// glows and vignettes included. That is the check that means something.

import { describe, expect, it } from 'vitest';
import {
  admissibleArchetypes,
  ARCHETYPE_KEYS,
  ARCHETYPES,
  colorAt,
  GRAIN,
  sampleAt,
  toCss,
  type ArchetypeKey,
} from './archetypes';
import {
  BEZEL_L,
  buildPalette,
  deriveRimAlpha,
  family,
  FAMILY_KEYS,
  type FamilyKey,
} from './palettes';
import { stream } from './seed';
import { gateText, TEXT_ROLES } from './contrast';
import { hexToOklch } from './oklch';
import {
  annulusPoints,
  CANVAS,
  HOOK_SAFE_AREA,
  PHONE,
  sampleGrid,
  type Point,
} from './geometry';

const HOOK_POINTS = sampleGrid(HOOK_SAFE_AREA, 9, 5);
const WHOLE_CANVAS = sampleGrid({ x: 0, y: 0, w: CANVAS.w, h: CANVAS.h }, 17, 29);
const SEEDS = 40;

/** Every (family, harmony, admissible archetype, seed) the system can emit. */
function everyBackground() {
  const out: {
    key: FamilyKey;
    arch: ArchetypeKey;
    seed: number;
    model: ReturnType<(typeof ARCHETYPES)[ArchetypeKey]['build']>;
    ink: string;
  }[] = [];
  for (const key of FAMILY_KEYS) {
    const f = family(key);
    for (const harmony of f.harmonies) {
      for (const arch of admissibleArchetypes(f.mode)) {
        for (let s = 0; s < SEEDS; s++) {
          const p = buildPalette(key, harmony, stream(`bp|${key}|${harmony}|${s}`));
          const a = ARCHETYPES[arch];
          const params = a.params(stream(`ap|${key}|${arch}|${s}`));
          out.push({ key, arch, seed: s, model: a.build(p, params), ink: p.ink });
        }
      }
    }
  }
  return out;
}

const ALL = everyBackground();

describe('the archetype bank', () => {
  it('has seven archetypes, each with a mode list and a note', () => {
    expect(ARCHETYPE_KEYS).toHaveLength(7);
    for (const k of ARCHETYPE_KEYS) {
      expect(ARCHETYPES[k].key).toBe(k);
      expect(ARCHETYPES[k].modes.length).toBeGreaterThan(0);
      expect(ARCHETYPES[k].note.length).toBeGreaterThan(10);
    }
  });

  it('keeps bandStack off dark families, where a hard band reads as a broken render', () => {
    expect(admissibleArchetypes('light')).toContain('bandStack');
    expect(admissibleArchetypes('dark')).not.toContain('bandStack');
  });

  it('leaves every family with at least four archetypes to choose from', () => {
    expect(admissibleArchetypes('dark').length).toBeGreaterThanOrEqual(4);
    expect(admissibleArchetypes('light').length).toBeGreaterThanOrEqual(4);
  });

  it('generates a decent spread of models, not one model repeated', () => {
    const css = new Set(ALL.filter((a) => a.arch === 'meshDual').map((a) => toCss(a.model)));
    expect(css.size).toBeGreaterThan(100);
  });
});

describe('the sampler agrees with the CSS construction', () => {
  it('reads a 180 degree linear gradient top to bottom', () => {
    // CSS 180deg means "to bottom", so the top of the canvas must be the FIRST
    // stop. Getting this backwards would not throw, it would silently gate the
    // wrong end of every gradient.
    const p = buildPalette('ink-signal', 'anchor', stream('dir'));
    const model = ARCHETYPES.linearTriStop.build(p, { angle: 180, midPos: 0.5 });
    const top = colorAt(model, { x: 540, y: 2 });
    const bottom = colorAt(model, { x: 540, y: CANVAS.h - 2 });
    expect(top).not.toBe(bottom);
    // deep is darker than lift, and 180deg puts deep at the top.
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16);
    expect(lum(top)).toBeLessThan(lum(bottom));
  });

  it('returns a well formed hex at every point of every model', () => {
    const bad: string[] = [];
    for (const { key, arch, model } of ALL.slice(0, 400)) {
      for (const p of WHOLE_CANVAS) {
        if (!/^#[0-9a-f]{6}$/.test(colorAt(model, p))) {
          bad.push(`${key}/${arch} at ${p.x},${p.y}`);
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it('emits CSS with no NaN, undefined or empty layer', () => {
    for (const { key, arch, model } of ALL) {
      const css = toCss(model);
      expect(css, `${key}/${arch}`).not.toMatch(/NaN|undefined|Infinity/);
      expect(css.length).toBeGreaterThan(40);
    }
  });

  it('keeps every gradient stop position inside 0 to 1 and in order', () => {
    // Collect and assert ONCE. An expect() per stop is tens of thousands of
    // calls, which is slow enough to time out when the machine is also busy
    // rendering, and it reports one failure at a time instead of all of them.
    const bad: string[] = [];
    for (const { key, arch, model } of ALL) {
      if (model.ramp.kind === 'bands') continue;
      let prev = -1;
      for (const s of model.ramp.stops) {
        if (s.pos < 0 || s.pos > 1) bad.push(`${key}/${arch} stop at ${s.pos}`);
        else if (s.pos < prev) bad.push(`${key}/${arch} out of order at ${s.pos}`);
        prev = s.pos;
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

describe('the contrast gate on the composited background', () => {
  it('passes the hook floor for every family, archetype and seed', () => {
    const failures: string[] = [];
    for (const { key, arch, seed, model, ink } of ALL) {
      const r = gateText(ink, sampleAt(model, HOOK_POINTS), TEXT_ROLES.hook);
      if (!r.pass) {
        failures.push(
          `${key}/${arch}/seed${seed}: ink ${ink} on ${r.worstAgainst} ` +
            `Lc ${r.worstLc.toFixed(1)} WCAG ${r.worstWcag.toFixed(2)}`,
        );
      }
    }
    expect(failures.slice(0, 10).join('\n')).toBe('');
  });

  it('FAILS when the ink is deliberately broken, so the check is not vacuous', () => {
    const p = buildPalette('bone-ink', 'anchor', stream('neg2'));
    const model = ARCHETYPES.linearTriStop.build(p, { angle: 180, midPos: 0.5 });
    const bad = colorAt(model, HOOK_SAFE_AREA);
    expect(gateText(bad, sampleAt(model, HOOK_POINTS), TEXT_ROLES.hook).pass).toBe(false);
  });
});

describe('composition constraints', () => {
  it('separates the phone from its surroundings, by lightness or by rim light', () => {
    // This replaced a "brightest point must not be behind the phone" rule, which
    // was the wrong question: the phone fills 68 percent of the canvas height,
    // so almost everything is behind it. What actually matters is whether the
    // background near the edge is too CLOSE to the bezel in lightness, and if it
    // is, whether the rim light is turned up enough to compensate.
    const ring = annulusPoints();
    const failures: string[] = [];
    for (const { key, arch, seed, model } of ALL) {
      const minDelta = Math.min(
        ...sampleAt(model, ring).map((h) => Math.abs(hexToOklch(h).L - BEZEL_L)),
      );
      const rim = deriveRimAlpha(minDelta);
      if (!(minDelta >= 0.18 || rim >= 0.3)) {
        failures.push(`${key}/${arch}/seed${seed}: dL ${minDelta.toFixed(3)} rim ${rim.toFixed(2)}`);
      }
    }
    expect(failures.slice(0, 10).join('\n')).toBe('');
  });

  it('keeps meshDual glows in the side margins, clear of the phone', () => {
    // The phone spans x 166 to 914, leaving 166px of margin on each side. That
    // is the only place a glow is actually visible rather than washing over the
    // device, and it is where two-point rim lighting would put it anyway.
    for (const { model, arch } of ALL) {
      if (arch !== 'meshDual') continue;
      for (const b of model.blobs) {
        const clear = b.cx < PHONE.x || b.cx > PHONE.x + PHONE.w;
        expect(clear, `glow at x ${b.cx.toFixed(0)} is behind the phone`).toBe(true);
      }
    }
  });

  it('keeps the hook band flat enough that the gate margin means something', () => {
    // If the background varied wildly across the hook, a 45 point grid could
    // step over the worst pixel. Bounding the variation is what makes sampling
    // a valid substitute for testing every pixel.
    for (const { key, arch, model } of ALL) {
      const lums = sampleAt(model, HOOK_POINTS).map(
        (h) => (parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)) / 765,
      );
      const spread = Math.max(...lums) - Math.min(...lums);
      expect(spread, `${key}/${arch}`).toBeLessThan(0.22);
    }
  });

  it('always keeps grain on, and stronger on dark families', () => {
    for (const { model } of ALL) {
      expect(model.grainAlpha).toBeGreaterThan(0);
      expect(model.grainAlpha).toBeLessThanOrEqual(GRAIN.darkAlpha);
    }
    expect(GRAIN.darkAlpha).toBeGreaterThan(GRAIN.lightAlpha);
  });

  it('bakes the grain tile once at module scope rather than per frame', () => {
    expect(GRAIN.dataUri).toContain('feTurbulence');
    expect(GRAIN.dataUri.startsWith('url("data:image/svg+xml,')).toBe(true);
  });
});

describe('determinism', () => {
  it('produces identical params for identical labels', () => {
    for (const k of ARCHETYPE_KEYS) {
      const a = ARCHETYPES[k].params(stream(`det|${k}`));
      const b = ARCHETYPES[k].params(stream(`det|${k}`));
      expect(a, k).toEqual(b);
    }
  });

  it('produces different params for different labels', () => {
    for (const k of ARCHETYPE_KEYS) {
      const a = ARCHETYPES[k].params(stream(`x|${k}`));
      const b = ARCHETYPES[k].params(stream(`y|${k}`));
      expect(a, k).not.toEqual(b);
    }
  });

  it('uses no Math.random anywhere in the module graph', () => {
    // Guarded properly by the source scan in plan.test.ts; this is the cheap
    // runtime version: two builds of the same model must be byte identical.
    const p = buildPalette('ultraviolet', 'anchor', stream('r'));
    const params = ARCHETYPES.meshDual.params(stream('r2'));
    expect(toCss(ARCHETYPES.meshDual.build(p, params))).toBe(
      toCss(ARCHETYPES.meshDual.build(p, params)),
    );
  });
});

describe('the annulus sampler', () => {
  it('places every sample outside the phone but near it', () => {
    const pts: Point[] = annulusPoints();
    expect(pts).toHaveLength(24);
    for (const p of pts) {
      const outside =
        p.x < PHONE.x || p.x > PHONE.x + PHONE.w || p.y < PHONE.y || p.y > PHONE.y + PHONE.h;
      expect(outside, `${p.x},${p.y}`).toBe(true);
    }
  });
});
