// The builder scrape: who gets onto the roster and how.
//
// The geography half (components=country:GB, radius-bounded Nearby Search) is
// pinned by reading the source, the same way tests/uk-places.test.ts pins the
// SERP rules: the whole point of docs/VIDEO_SERP_TRUTH.md is that region=uk
// looks right and does nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  normaliseUkPhone, isUkMobile, filterBuilderCandidates, planRosterChanges,
  WIDENING_RADII_M, DEFAULT_RADIUS_M,
  type PlaceCandidate, type ScrapedBuilder,
} from '../api/lib/builder-scrape.js';

const SRC = readFileSync('api/lib/builder-scrape.ts', 'utf8');

const cand = (over: Partial<PlaceCandidate>): PlaceCandidate => ({
  placeId: 'p1', name: 'A Builder', vicinity: 'Somewhere', types: ['general_contractor'],
  businessStatus: 'OPERATIONAL', rating: 4.5, reviews: 40, ...over,
});

const scraped = (phone: string, over: Partial<ScrapedBuilder> = {}): ScrapedBuilder => ({
  name: 'A Builder', phoneE164: phone, address: '1 High St', placeId: `p-${phone}`,
  rating: 4.5, reviews: 40, ...over,
});

describe('normaliseUkPhone', () => {
  it('normalises the shapes Google actually returns', () => {
    expect(normaliseUkPhone('07123 456789')).toBe('+447123456789');
    expect(normaliseUkPhone('+44 7123 456789')).toBe('+447123456789');
    expect(normaliseUkPhone('0044 7123 456789')).toBe('+447123456789');
    expect(normaliseUkPhone('(01204) 555 555')).toBe('+441204555555');
  });
  it('refuses foreign and malformed numbers instead of guessing', () => {
    expect(normaliseUkPhone('+1 416 555 0199')).toBeNull();
    expect(normaliseUkPhone('12345')).toBeNull();
    expect(normaliseUkPhone('')).toBeNull();
    expect(normaliseUkPhone(null)).toBeNull();
  });
  it('landlines are kept on the roster, but only mobiles are WhatsApp-able', () => {
    expect(isUkMobile('+447123456789')).toBe(true);
    expect(isUkMobile('+441204555555')).toBe(false);
    expect(isUkMobile(null)).toBe(false);
  });
});

describe('filterBuilderCandidates', () => {
  it('drops shops, merchants and closed businesses, keeps real builders', () => {
    const rows = [
      cand({ name: 'Smith Building Ltd' }),
      cand({ name: 'Pets at Home', types: ['pet_store', 'store'] }),
      cand({ name: 'Screwfix Bolton', types: ['hardware_store', 'store'] }),
      cand({ name: 'Jewson Builders Merchant' }),
      cand({ name: 'Gone Ltd', businessStatus: 'CLOSED_PERMANENTLY' }),
    ];
    expect(filterBuilderCandidates(rows).map((r) => r.name)).toEqual(['Smith Building Ltd']);
  });
  it('ranks best-reviewed first, the OPPOSITE of the lead-gen scraper', () => {
    const rows = [
      cand({ name: 'Small Outfit', reviews: 5 }),
      cand({ name: 'Established Builder', reviews: 220 }),
      cand({ name: 'Mid Builder', reviews: 60 }),
    ];
    expect(filterBuilderCandidates(rows).map((r) => r.name))
      .toEqual(['Established Builder', 'Mid Builder', 'Small Outfit']);
    // A 220-review builder passing IS the proof there is no review ceiling:
    // max-reviews belongs to the video funnel's hunt for weak businesses.
    expect(SRC).not.toMatch(/max[-_]?reviews/i);
  });
  it('a missing business_status is kept (details differ across regions)', () => {
    expect(filterBuilderCandidates([cand({ businessStatus: null })])).toHaveLength(1);
  });
});

describe('planRosterChanges', () => {
  it('a known phone extends coverage instead of duplicating the builder', () => {
    const plan = planRosterChanges(
      [{ id: 'b1', phone: '+447123456789', coverage: ['LE7'] }],
      [scraped('+447123456789'), scraped('+447999888777', { name: 'New Builder' })],
      'WN1',
    );
    expect(plan.extendIds).toEqual(['b1']);
    expect(plan.inserts.map((b) => b.name)).toEqual(['New Builder']);
  });
  it('an already-covered outcode does not extend again', () => {
    const plan = planRosterChanges(
      [{ id: 'b1', phone: '+447123456789', coverage: ['wn1'] }],
      [scraped('+447123456789')],
      'WN1',
    );
    expect(plan.extendIds).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });
  it('caps INSERTS only and dedupes the scrape by phone', () => {
    const many = Array.from({ length: 12 }, (_, i) => scraped(`+44712345${String(6700 + i)}`));
    const plan = planRosterChanges([], [...many, many[0]], 'WN1', 8);
    expect(plan.inserts).toHaveLength(8);
  });
});

describe('the geography rules are pinned in the source', () => {
  it('geocodes with the HARD country filter and never uses region=uk', () => {
    expect(SRC).toContain("components: 'country:GB'");
    expect(SRC).toContain('nearbysearch');
    // No `region` PARAMETER ever goes to Google. The word appearing in a
    // comment explaining why is fine; a `region:` key in a params object is
    // the bug coming back.
    expect(SRC).not.toMatch(/['"]?region['"]?\s*:/);
  });
  it('reads the shared trader rules instead of re-deriving them', () => {
    expect(SRC).toMatch(/from '\.\/uk-places\.js'/);
    expect(SRC).toMatch(/isTrader/);
    expect(SRC).toMatch(/NON_TRADER/);
  });
});

// ---------------------------------------------------------------------------
// Widening, added 2026-08-22.
//
// Hugo: "if you don't find in this exact location, expand a bit further."
// A postcode with no builder inside 10km is a rural outcode, not a place with
// no builders, and the failure it caused before was silent: a viewing sat in
// the column with nobody invited and no reason given.
// ---------------------------------------------------------------------------
describe('the search widens rather than giving up', () => {
  it('goes outwards, never inwards', () => {
    const sorted = [...WIDENING_RADII_M].sort((a, b) => a - b);
    expect(WIDENING_RADII_M).toEqual(sorted);
    expect(new Set(WIDENING_RADII_M).size).toBe(WIDENING_RADII_M.length);
  });

  it('starts on the doorstep and stops before a builder is an hour away', () => {
    expect(WIDENING_RADII_M[0]).toBe(DEFAULT_RADIUS_M);
    expect(WIDENING_RADII_M[WIDENING_RADII_M.length - 1]).toBeLessThanOrEqual(40_000);
  });

  it('the first hit wins: one builder nearby beats eight far away', () => {
    // Still true, and still the default. `minCount` was added 2026-08-25 so
    // the Find builders desk can ask for thirty, but it defaults to 1, which
    // is exactly this rule: the moment one name is in hand the ladder stops
    // and no wider ring is paid for.
    expect(SRC).toMatch(/const want = Math\.max\(1, opts\.minCount \?\? 1\)/);
    expect(SRC).toMatch(/if \(byPhone\.size >= want\) break/);
  });

  it('a name found at 10km is not replaced by the same name found at 40km', () => {
    // The wider ring re-finds everything the narrow one found. First sighting
    // wins, so a builder stays at the tightest radius he appeared in and the
    // nearest names are the ones kept.
    expect(SRC).toMatch(/if \(!byPhone\.has\(b\.phoneE164\)\) byPhone\.set\(b\.phoneE164, b\)/);
  });

  it('a radius already wider than the settings start is not searched twice', () => {
    expect(SRC).toMatch(/WIDENING_RADII_M\.filter\(\(r\) => r > start\)/);
  });
});
