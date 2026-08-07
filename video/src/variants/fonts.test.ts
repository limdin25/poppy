// Guards on the font pipeline. The failure this prevents is subtle and ugly: a
// wrong metric silently reflows every hook, and nothing else in the suite would
// notice because the plan and the gate never look at glyph widths.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import lock from './fonts.lock.json';
import measured from './font-metrics.json';
import {
  admissibleFonts,
  fitHook,
  FONT_BANK,
  FONT_KEYS,
  metrics,
  sizeForCap,
} from './fonts';
import { PALETTE_FAMILIES, FAMILY_KEYS } from './palettes';

const FONT_DIR = join(__dirname, '..', '..', 'public', 'fonts');

describe('the font bank', () => {
  it('has ten faces, each keyed to itself', () => {
    expect(FONT_KEYS).toHaveLength(10);
    for (const k of FONT_KEYS) expect(FONT_BANK[k].key).toBe(k);
  });

  it('covers every temperament a palette family can ask for', () => {
    for (const fam of FAMILY_KEYS) {
      const fonts = admissibleFonts(PALETTE_FAMILIES[fam].temperaments);
      expect(fonts.length, `${fam} has no admissible font`).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every family a real choice, not a single forced face', () => {
    // If a family drops to one admissible font, its videos all share a typeface
    // and a whole axis of variation quietly disappears.
    for (const fam of FAMILY_KEYS) {
      expect(admissibleFonts(PALETTE_FAMILIES[fam].temperaments).length, fam).toBeGreaterThan(1);
    }
  });
});

describe('measured metrics', () => {
  it('has a measurement for every face in the bank', () => {
    for (const k of FONT_KEYS) {
      expect(measured, `missing measurement for ${k}`).toHaveProperty(k);
    }
  });

  it('reports plausible cap heights', () => {
    for (const k of FONT_KEYS) {
      const c = metrics(k).capHeightEm;
      expect(c, k).toBeGreaterThan(0.6);
      expect(c, k).toBeLessThan(0.95);
    }
  });

  it('records Anton as the tall-capped outlier it actually is', () => {
    // This is the specific value that was declared wrong by hand at 0.73. Anton
    // is 0.86, so deriving its size from the same cap-height target renders it
    // about 18 percent smaller than the naive guess would have. Pinned here
    // because it is the clearest evidence that measuring beats declaring.
    expect(metrics('anton').capHeightEm).toBeGreaterThan(0.84);
    expect(sizeForCap(FONT_BANK.anton, 70)).toBeLessThan(sizeForCap(FONT_BANK.playfair, 70));
  });

  it('widens the variable faces, since their advance is measured at Regular', () => {
    // Eight of ten ship variable, so the raw measurement is Regular's width for a
    // face we render at ExtraBold. The widening must push the estimate UP, which
    // is the safe direction: it rejects marginal hooks rather than overflowing.
    for (const k of FONT_KEYS) {
      const raw = (measured as Record<string, { avgAdvanceEm: number; variable: boolean }>)[k];
      if (raw.variable && FONT_BANK[k].weight > 400) {
        expect(metrics(k).avgAdvanceEm, k).toBeGreaterThan(raw.avgAdvanceEm);
      } else {
        expect(metrics(k).avgAdvanceEm, k).toBeCloseTo(raw.avgAdvanceEm, 6);
      }
    }
  });

  it('confirms Anton is the narrowest of the bold faces, which is why it fits the long hooks', () => {
    // Anton is narrower than every face in the bank except Instrument Serif,
    // which is a light italic and a different kind of thing. That condensation
    // is the whole reason Anton is here: it fits roughly a third more characters
    // per line than the grotesques, so it carries the longest hooks.
    const anton = metrics('anton').avgAdvanceEm;
    for (const k of FONT_KEYS) {
      if (k === 'anton' || k === 'instrument-serif') continue;
      expect(anton, `anton should be narrower than ${k}`).toBeLessThan(metrics(k).avgAdvanceEm);
    }
    expect(anton).toBeLessThan(metrics('sora').avgAdvanceEm * 0.8);
  });
});

describe('the downloaded files', () => {
  const have = existsSync(FONT_DIR);

  it('has a lock entry for every face', () => {
    for (const k of FONT_KEYS) {
      expect(lock, `no lock entry for ${FONT_BANK[k].file}`).toHaveProperty(FONT_BANK[k].file);
    }
  });

  it.skipIf(!have)('matches the locked hash for every file on disk', () => {
    // A font that changed underneath us reflows every hook in every video, and
    // would otherwise do it silently. Re-run scripts/fetch-fonts.mjs and commit
    // the new lock if the change is intended.
    for (const k of FONT_KEYS) {
      const file = join(FONT_DIR, FONT_BANK[k].file);
      expect(existsSync(file), `${FONT_BANK[k].file} is missing. Run scripts/fetch-fonts.mjs`).toBe(true);
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(hash, `${FONT_BANK[k].file} does not match the lock`).toBe(
        (lock as Record<string, string>)[FONT_BANK[k].file],
      );
    }
  });
});

describe('fitting', () => {
  it('never returns a size below the face minimum', () => {
    for (const k of FONT_KEYS) {
      const r = fitHook('Stop filming. Start generating.', FONT_BANK[k], 936);
      expect(r, k).not.toBeNull();
      expect(r?.fontSize, k).toBeGreaterThanOrEqual(FONT_BANK[k].minSize);
    }
  });

  it('rejects text that genuinely cannot fit, rather than shrinking forever', () => {
    const absurd = 'x'.repeat(400);
    expect(fitHook(absurd, FONT_BANK['inter-tight'], 936)).toBeNull();
  });
});
