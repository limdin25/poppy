// A house with no postcode cannot find builders, and Pedro keeps hitting it.
//
// Fartown, Pudsey, 2026-09-10: address on file was "127, Fartown, Pudsey, West
// Yorkshire" with no LS28 8LT. Find builders refused, the red banner fired, and
// Pedro had to paste the full postcode over WhatsApp. The heal must:
//
//   1. Append a postcode without inventing one (geocode or a typed one).
//   2. Leave an address that already has a postcode alone.
//   3. Run before scrape so the same press that used to fail can succeed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { outcodeOf } from '../api/lib/brrr-deal-facts';
import {
  postcodeFromGeocodeComponents,
  withPostcode,
  looksLikeUkPostcode,
} from '../api/lib/property-postcode';

const ROUTE = readFileSync('api/crm/find-builders.ts', 'utf8');
const PAGE = readFileSync('src/features/crm/pages/FindBuildersPage.tsx', 'utf8');
const VIEW = readFileSync('api/lib/viewing-houses.ts', 'utf8');

describe('appending a postcode to a bare street address', () => {
  it('adds LS28 8LT to Fartown without inventing a house number', () => {
    expect(withPostcode('127, Fartown, Pudsey, West Yorkshire', 'LS28 8LT'))
      .toBe('127, Fartown, Pudsey, West Yorkshire, LS28 8LT');
    expect(outcodeOf(withPostcode('Fartown, Pudsey, West Yorkshire', 'LS28 8LT')))
      .toBe('LS28');
  });

  it('leaves an address that already has a postcode alone', () => {
    expect(withPostcode('40, Bensham Road, Darlington, DL1 3DG', 'DL1 3DG'))
      .toBe('40, Bensham Road, Darlington, DL1 3DG');
    expect(withPostcode('Pitt Street, Edgeley, Stockport, SK3 9EH', 'SK3 9EH'))
      .toBe('Pitt Street, Edgeley, Stockport, SK3 9EH');
  });

  it('normalises a typed postcode before appending', () => {
    expect(withPostcode('Fartown, Pudsey', 'ls288lt'))
      .toBe('Fartown, Pudsey, LS28 8LT');
    expect(looksLikeUkPostcode('LS28 8LT')).toBe(true);
    expect(looksLikeUkPostcode('ls288lt')).toBe(true);
    expect(looksLikeUkPostcode('not a postcode')).toBe(false);
  });
});

describe('reading a postcode out of a Google geocode result', () => {
  it('takes the postal_code component and nothing else', () => {
    expect(postcodeFromGeocodeComponents([
      { long_name: 'Pudsey', types: ['postal_town', 'political'] },
      { long_name: 'LS28 8LT', types: ['postal_code'] },
      { long_name: 'United Kingdom', types: ['country', 'political'] },
    ])).toBe('LS28 8LT');
    expect(postcodeFromGeocodeComponents([
      { long_name: 'Pudsey', types: ['postal_town'] },
    ])).toBeNull();
  });
});

describe('Find builders heals a missing postcode before giving up', () => {
  it('the scrape path tries to fill the postcode before refusing', () => {
    expect(ROUTE).toMatch(/ensurePropertyPostcode/);
    const scrape = ROUTE.slice(ROUTE.indexOf('async function runScrape'));
    expect(scrape.indexOf('ensurePropertyPostcode'))
      .toBeLessThan(scrape.indexOf('no postcode we can read'));
  });

  it('the shared viewing list heals too, so the picker outcode is real', () => {
    expect(VIEW).toMatch(/ensurePropertyPostcode|ensurePostcodesForHouses/);
  });

  it('Pedro can type a postcode on the page when geocode cannot help', () => {
    expect(PAGE).toMatch(/find-builders-set-postcode|set_postcode/);
    expect(ROUTE).toMatch(/action === 'set_postcode'/);
  });
});
