import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { TRADE_PHOTOS, NEUTRAL_PHOTOS, tradePhotos } from '../src/core/site-demo/photos';
import { TRADE_COPY } from '../src/core/site-demo/trade-services';

const PUBLIC = join(process.cwd(), 'public', 'site');
const all = [...Object.values(TRADE_PHOTOS), NEUTRAL_PHOTOS];

// The photographs are the whole point of this version of the design, and the
// map that names them is a plain object that will happily reference a file
// nobody built. A missing file is an invisible broken image on a live sales
// page, so it is checked here rather than discovered by a lead.
describe('the photo files actually exist', () => {
  it('has every file that photos.ts references', () => {
    for (const set of all) {
      for (const photo of Object.values(set)) {
        const file = join(PUBLIC, photo.src.replace('/site/', ''));
        expect({ src: photo.src, exists: existsSync(file) }).toEqual({
          src: photo.src,
          exists: true,
        });
      }
    }
  });

  // A 400KB hero over mobile data is a lost sale. The build script enforces
  // this too, but the script is run by hand and the files are committed, so
  // the committed bytes are what actually ship.
  it('keeps every file inside the weight budget', () => {
    for (const set of all) {
      for (const photo of Object.values(set)) {
        const kb = Math.round(statSync(join(PUBLIC, photo.src.replace('/site/', ''))).size / 1024);
        expect({ src: photo.src, kb, ok: kb <= 115 }).toEqual({ src: photo.src, kb, ok: true });
      }
    }
  });
});

describe('every trade is covered', () => {
  // A trade with a service list but no photographs would fall back to the
  // neutral hero, which is a worse page than the one we could have shipped.
  it('gives every trade profile its own hero', () => {
    for (const profileKey of Object.keys(TRADE_COPY)) {
      const set = tradePhotos(profileKey);
      expect({ profileKey, hero: set.hero.src }).toEqual({
        profileKey,
        hero: `/site/${profileKey}-hero.webp`,
      });
    }
  });

  it('falls back to neutral for a trade with no profile', () => {
    expect(tradePhotos(null).hero.src).toBe('/site/neutral-hero.webp');
    expect(tradePhotos('nothing-like-this').hero.src).toBe('/site/neutral-hero.webp');
  });
});

// photos.ts and scripts/build-site-photos.mjs each hold their own copy of the
// alt text, because the script writes a manifest and the page reads the map.
// They drifted the moment they were written, so this pins them together.
describe('the map and the build script agree', () => {
  it('uses the same alt text in both places', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'build-site-photos.mjs'), 'utf8');
    for (const set of all) {
      for (const photo of Object.values(set)) {
        expect({ alt: photo.alt, inScript: script.includes(photo.alt) }).toEqual({
          alt: photo.alt,
          inScript: true,
        });
      }
    }
  });
});
