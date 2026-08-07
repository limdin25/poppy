// Foundation tests. Everything in the palette system rests on these two modules,
// so they are checked against published reference values rather than against
// whatever the code happened to produce on the day it was written.

import { describe, expect, it } from 'vitest';
import {
  deltaE,
  gamutClip,
  hexToOklch,
  hueDistance,
  inGamut,
  maxChromaInSrgb,
  oklchLerp,
  toHex,
  wrapHue,
} from './oklch';
import {
  apcaContrastSigned,
  apcaLc,
  gateText,
  TEXT_ROLES,
  wcagRatio,
} from './contrast';
import { hexToRgb } from './oklch';

describe('oklch conversion', () => {
  it('round trips every hex through OKLCH within one quantisation step', () => {
    const samples = [
      '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
      '#ffff00', '#00ffff', '#ff00ff', '#0a0b0d', '#f4f0e7',
      '#1b589e', '#402168', '#adef5b', '#13191f', '#7f7f7f',
    ];
    for (const hex of samples) {
      expect(toHex(hexToOklch(hex)), `round trip of ${hex}`).toBe(hex);
    }
  });

  it('places pure white and pure black at the ends of the L axis', () => {
    expect(hexToOklch('#ffffff').L).toBeCloseTo(1, 3);
    expect(hexToOklch('#000000').L).toBeCloseTo(0, 3);
  });

  it('reports near-greys as achromatic rather than as a noisy hue', () => {
    // A hue angle derived from near-zero chroma is numerical noise, and a
    // family-separation test reading that noise would be meaningless.
    expect(hexToOklch('#7f7f7f').C).toBeLessThan(0.001);
    expect(hexToOklch('#000000').H).toBe(0);
  });

  it('agrees with Ottosson reference values for the sRGB primaries', () => {
    const red = hexToOklch('#ff0000');
    expect(red.L).toBeCloseTo(0.6279, 3);
    expect(red.C).toBeCloseTo(0.2577, 3);
    expect(red.H).toBeCloseTo(29.23, 1);

    const green = hexToOklch('#00ff00');
    expect(green.L).toBeCloseTo(0.8664, 3);

    const blue = hexToOklch('#0000ff');
    expect(blue.L).toBeCloseTo(0.452, 3);
  });
});

describe('gamut handling', () => {
  it('finds a chroma ceiling that is in gamut and whose neighbour above is not', () => {
    for (const L of [0.2, 0.35, 0.5, 0.65, 0.8, 0.92]) {
      for (const H of [20, 60, 110, 150, 200, 250, 290, 330]) {
        const max = maxChromaInSrgb(L, H);
        expect(inGamut({ L, C: max, H }), `L${L} H${H} at max`).toBe(true);
        expect(inGamut({ L, C: max + 0.01, H }), `L${L} H${H} above max`).toBe(false);
      }
    }
  });

  it('confirms the chroma ceiling swings wildly with hue, which is why a fixed jitter bound would be wrong', () => {
    // This is the measurement the whole "chroma is never a free parameter" rule
    // rests on. If this ever stops being true the rule can be revisited.
    const cyan = maxChromaInSrgb(0.6, 200);
    const pink = maxChromaInSrgb(0.6, 330);
    expect(pink / cyan).toBeGreaterThan(2);
  });

  it('preserves L and H exactly while clipping chroma', () => {
    const wanted = { L: 0.6, C: 0.35, H: 200 };
    const got = gamutClip(wanted);
    expect(got.L).toBe(0.6);
    expect(got.H).toBe(200);
    expect(got.C).toBeLessThan(wanted.C);
  });

  it('leaves 8 percent of headroom below the gamut wall', () => {
    const clipped = gamutClip({ L: 0.6, C: 1, H: 200 });
    expect(clipped.C).toBeCloseTo(maxChromaInSrgb(0.6, 200) * 0.92, 6);
  });

  it('never returns an out of gamut colour, whatever it is handed', () => {
    for (let i = 0; i < 500; i++) {
      const L = i / 500;
      const c = gamutClip({ L, C: 0.9, H: (i * 7) % 360 });
      expect(inGamut(c), `L=${L}`).toBe(true);
    }
  });
});

describe('hue arithmetic', () => {
  it('wraps negative and oversized angles', () => {
    expect(wrapHue(-10)).toBe(350);
    expect(wrapHue(370)).toBe(10);
    expect(wrapHue(0)).toBe(0);
  });

  it('measures distance the short way round', () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
  });

  it('interpolates the short way round, so navy to sky never goes through green', () => {
    const mid = oklchLerp({ L: 0.5, C: 0.1, H: 350 }, { L: 0.5, C: 0.1, H: 10 }, 0.5);
    expect(mid.H).toBeCloseTo(0, 6);
  });
});

describe('deltaE', () => {
  it('reports zero for identical colours and something visible for a real difference', () => {
    expect(deltaE({ L: 0.5, C: 0.1, H: 200 }, { L: 0.5, C: 0.1, H: 200 })).toBe(0);
    expect(deltaE(hexToOklch('#1b589e'), hexToOklch('#402168'))).toBeGreaterThan(0.05);
  });
});

describe('APCA', () => {
  it('matches the published reference for the two extreme pairs', () => {
    // APCA-W3 0.1.9 canonical values. If these drift, the constants were edited.
    expect(apcaContrastSigned(hexToRgb('#000000'), hexToRgb('#ffffff'))).toBeCloseTo(106.04, 1);
    expect(apcaContrastSigned(hexToRgb('#ffffff'), hexToRgb('#000000'))).toBeCloseTo(-107.88, 1);
  });

  it('signs polarity: positive for dark on light, negative for light on dark', () => {
    expect(apcaContrastSigned(hexToRgb('#111111'), hexToRgb('#eeeeee'))).toBeGreaterThan(0);
    expect(apcaContrastSigned(hexToRgb('#eeeeee'), hexToRgb('#111111'))).toBeLessThan(0);
  });

  it('returns zero when text and background are the same', () => {
    expect(apcaLc('#336699', '#336699')).toBe(0);
  });

  it('rates an accent as text far worse than ink, which is why the accent is never a text colour', () => {
    // Measured, and this is the evidence for the hard rule in palettes.ts. An
    // accent used as text lands at or under the hook floor of 60 with no margin,
    // while the family's designed ink clears it by thirty points or more on the
    // same background. Citrus is the one accent that reads well as text, and even
    // it is 18 points behind its ink, so the rule stays absolute rather than
    // becoming a per-family judgement call.
    const cases: [string, string, string][] = [
      ['#da4433', '#f0e9e8', '#191212'], // vermilion accent vs ink, on bone
      ['#eabf3a', '#0b492f', '#f1f7f2'], // gold accent vs ink, on emerald
      ['#6ee4ff', '#1b589e', '#ffffff'], // cyan accent vs ink, on cobalt
      ['#adef5b', '#13191f', '#f6f9fb'], // citrus accent vs ink, on obsidian
    ];
    for (const [accent, bg, ink] of cases) {
      expect(apcaLc(ink, bg) - apcaLc(accent, bg), `${accent} on ${bg}`).toBeGreaterThan(18);
    }
    // Three of the four are at or below the floor outright.
    expect(apcaLc('#da4433', '#f0e9e8')).toBeLessThan(60); // 56.6
    expect(apcaLc('#eabf3a', '#0b492f')).toBeLessThan(62); // 61.1, scrapes it
    expect(apcaLc('#6ee4ff', '#1b589e')).toBeLessThan(63); // 62.4, scrapes it
  });

  it('confirms near-black on an accent pill clears the floor, so onAccent can be a constant', () => {
    // accentFill is always forced to L >= 0.78, which is what makes a single
    // near-black constant provably safe on every accent in the bank.
    expect(apcaLc('#0d0d0f', '#adef5b')).toBeGreaterThan(60); // 85.2
    expect(apcaLc('#0d0d0f', '#eabf3a')).toBeGreaterThan(60); // 71.8
  });
});

describe('WCAG 2.1', () => {
  it('gives exactly 21 for black on white', () => {
    expect(wcagRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
  });

  it('gives 1 for a colour against itself and is order independent', () => {
    expect(wcagRatio('#4488cc', '#4488cc')).toBeCloseTo(1, 6);
    expect(wcagRatio('#000000', '#ffffff')).toBeCloseTo(wcagRatio('#ffffff', '#000000'), 9);
  });
});

describe('gateText', () => {
  it('reports the WORST sample, not the average', () => {
    const r = gateText('#ffffff', ['#000000', '#111111', '#999999'], TEXT_ROLES.hook);
    expect(r.worstAgainst).toBe('#999999');
    expect(r.pass).toBe(false);
  });

  it('passes a genuinely readable pairing across a whole gradient', () => {
    const r = gateText('#f6f9fb', ['#13191f', '#161d24', '#101519'], TEXT_ROLES.hook);
    expect(r.pass).toBe(true);
    expect(r.worstLc).toBeGreaterThan(60);
  });

  it('holds end card body text to a higher bar than the headline', () => {
    expect(TEXT_ROLES.ctaBody.minLc).toBeGreaterThan(TEXT_ROLES.ctaHeadline.minLc);
  });

  it('throws rather than vacuously passing when handed no samples', () => {
    expect(() => gateText('#ffffff', [], TEXT_ROLES.hook)).toThrow();
  });
});
