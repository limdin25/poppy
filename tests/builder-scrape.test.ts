// The builder scrape: who gets onto the roster and how.
//
// The geography half (components=country:GB, radius-bounded Nearby Search) is
// pinned by reading the source, the same way tests/uk-places.test.ts pins the
// SERP rules: the whole point of docs/VIDEO_SERP_TRUTH.md is that region=uk
// looks right and does nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  normaliseUkPhone, isUkMobile, filterBuilderCandidates, mobilesOnly, MAX_ROSTER_REVIEWS, planRosterChanges,
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
  it('ranks the SMALLEST first, which is the opposite of what it used to do', () => {
    // Reversed 2026-08-26 on two days of real calls. Every builder who agreed
    // to attend was a one-van trade (4 to 16 reviews); the big ones answered
    // with a switchboard and said they do councils, schools, the NHS, or
    // commercial only, or asked £150 up front.
    const rows = [
      cand({ name: 'Small Outfit', reviews: 5 }),
      cand({ name: 'Busier Builder', reviews: 45 }),
      cand({ name: 'Mid Builder', reviews: 20 }),
    ];
    expect(filterBuilderCandidates(rows).map((r) => r.name))
      .toEqual(['Small Outfit', 'Mid Builder', 'Busier Builder']);
  });

  it('THROWS OUT anything over fifty reviews', () => {
    // Hugo, 2026-08-26: "if they have more than a hundred reviews forget it.
    // Focus on fifty and less, no matter if they have better reviews. We want
    // the Jerry next door." The cost is recorded in the source: AJM Home
    // Improvements has 61 and said yes, so this rule loses one of the six wins.
    expect(MAX_ROSTER_REVIEWS).toBe(50);
    expect(filterBuilderCandidates([cand({ name: 'Big Builder', reviews: 220 })])).toEqual([]);
    expect(filterBuilderCandidates([cand({ name: 'Over The Line', reviews: 51 })])).toEqual([]);
    expect(filterBuilderCandidates([cand({ name: 'Just Inside', reviews: 50 })])).toHaveLength(1);
  });

  it('breaks a review tie on the better rating, so no-reviews does not always win', () => {
    const rows = [
      cand({ name: 'Unrated', reviews: 0, rating: null }),
      cand({ name: 'Good Small Trade', reviews: 0, rating: 5 }),
    ];
    expect(filterBuilderCandidates(rows).map((r) => r.name))
      .toEqual(['Good Small Trade', 'Unrated']);
  });

  describe('mobilesOnly', () => {
    // THE SHARPEST SIGNAL MEASURED: every builder who agreed to attend answered
    // a mobile (6 of 6); every builder on a landline said no (10 of 10).
    // Hugo, 2026-08-26: "not mobile first. Only mobile."
    const b = (name: string, phoneE164: string) =>
      ({ name, phoneE164, address: '', placeId: name, rating: null, reviews: null });

    it('keeps the man who answers his own phone and DROPS the switchboard', () => {
      const out = mobilesOnly([
        b('Office Ltd', '+441234567890'),
        b('One Van Trade', '+447700900123'),
        b('Another Office', '+442012345678'),
        b('Second Trade', '+447700900456'),
      ]);
      expect(out.map((x) => x.name)).toEqual(['One Van Trade', 'Second Trade']);
    });

    it('keeps the order it was given, so the review ranking survives', () => {
      const out = mobilesOnly([b('Mobile A', '+447700900001'), b('Mobile B', '+447700900002')]);
      expect(out.map((x) => x.name)).toEqual(['Mobile A', 'Mobile B']);
    });

    it('would rather return nobody than an office', () => {
      expect(mobilesOnly([b('Office Ltd', '+441234567890')])).toEqual([]);
    });
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
