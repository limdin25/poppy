import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inUk, isTrader, NON_TRADER, MIN_REAL_ABOVE, realCompetitors, splitByReviews } from '../api/lib/uk-places';
import { renderErrorText, canRetryRender } from '../src/features/crm/lib/funnelStages';

// 2026-07-28. Two leads sat in the video funnel behind a red card reading
// "Google didn't return enough real businesses above them to build a truthful
// search". Google had returned six for Bite Back Pest Control (Bridlington) and
// eight for AL Security Ltd (Stirling). The refusal was real; the reason was not.
//
// Underneath were three faults, all the same shape: two places in the repo each
// had their own idea of who counts as a competitor above the lead.

describe('a foreign business can never stand in a UK lead\'s search', () => {
  // Every one of these is a real formatted_address from the 727 rows returned by
  // 60 town searches on 2026-07-28. The rule judged 721 UK and 6 foreign, and
  // all 6 genuinely were.
  it('keeps UK addresses, whatever shape the postcode arrives in', () => {
    for (const a of [
      '14 Commercial St, Manchester M15 4PZ',
      '37 St George\'s Ave, Timperley, Altrincham WA15 6HF',
      'Hornsea Rd, Hull HU11, UK',            // Google appends ", UK" on some rural rows
      'All Keyed Up, Whitchurch RG28 7',      // truncated postcode, still UK
      'Unit 3 Wareham Rd, Eastfield, Scarborough YO11 3UW',
    ]) expect(inUk(a), a).toBe(true);
  });

  it('rejects the Toronto and US rows that region=uk lets through', () => {
    // `region=uk` on a Places search is a BIAS, not a filter. This is the whole
    // reason the rule exists: Scarborough is also a district of Toronto, and
    // four of seven results for "pest control in Scarborough" were Canadian.
    for (const a of [
      '399 Markham Rd, Scarborough, ON M1J 3C9, Canada',
      '80 John Tabor Trail, Scarborough, ON M1B 2V2, Canada',
      '601 Washington St, La Porte, IN 46350, USA',
      '4816 Clowes St, Stockton, CA 95210, USA',
    ]) expect(inUk(a), a).toBe(false);
  });

  it('is not a postcode-shape test, because Canadian codes look British', () => {
    // "M1J 3C9" passes any UK postcode regex you would reasonably write. The
    // country suffix is the only reliable signal, so that is what we read.
    expect(inUk('123 Kingston Rd, Scarborough, ON M1J 3C9, Canada')).toBe(false);
    expect(inUk('123 Kingston Rd, Scarborough YO11 3NN')).toBe(true);
  });

  it('treats an empty or unknown address as not-UK rather than guessing', () => {
    expect(inUk('')).toBe(false);
    expect(inUk(null)).toBe(false);
    expect(inUk(undefined)).toBe(false);
  });
});

describe('who counts as a competitor', () => {
  const rows = [
    { name: 'Viking Pest Control Ltd', address: 'Swinemoor Ln, Beverley HU17 0LT', rating: 4.8, reviews: 550 },
    { name: 'Rentokil Pest Control', address: 'Riverside Way, Leeds LS1 4EH', rating: 4.1, reviews: 900 },
    { name: 'PESTONG Pest Control', address: '399 Markham Rd, Scarborough, ON M1J 3C9, Canada', rating: 4.9, reviews: 427 },
    { name: 'Bite Back Pest Control', address: 'Bridlington YO15 3QN', rating: 5, reviews: 42 },
    { name: 'Yorkshire Coast Pest Control', address: 'Scarborough YO11 3NN', rating: 4.9, reviews: 36 },
  ];
  const isLead = (n: string) => n.toLowerCase().includes('bite back');

  it('drops the foreign row, the non-trader and the lead themselves', () => {
    const kept = realCompetitors(rows, isLead).map((r) => r.name);
    expect(kept).toEqual(['Viking Pest Control Ltd', 'Yorkshire Coast Pest Control']);
    expect(NON_TRADER.test('Rentokil Pest Control')).toBe(true);
    expect(NON_TRADER.test('Timpson Locksmiths and Safe Engineers')).toBe(true);
    expect(NON_TRADER.test('Viking Pest Control Ltd')).toBe(false);
  });
});

describe('a shop is not a tradesman, however many reviews it has', () => {
  // Live types from "pest control in Taunton" and "electricians in Crawley",
  // 2026-07-28. The shops sat at the TOP of the pest-control search on review
  // volume alone: a garden centre collects hundreds, a one-van pest controller
  // collects forty. Unfiltered, the video opens by naming a pet shop as the
  // business beating this lead.
  it('drops the pet shop, the hardware store and the garden centre', () => {
    expect(isTrader(['establishment', 'pet_store', 'point_of_interest', 'store'])).toBe(false);
    expect(isTrader(['establishment', 'home_goods_store', 'point_of_interest', 'store'])).toBe(false);
    expect(isTrader(['establishment', 'point_of_interest', 'store'])).toBe(false);
  });

  it('keeps a pest controller, who Google files as nothing in particular', () => {
    // Pest control has no Google category at all, so the rule must not require
    // a trade type. It may only ever reject.
    expect(isTrader(['establishment', 'point_of_interest'])).toBe(true);
    expect(isTrader([])).toBe(true);
    expect(isTrader(undefined)).toBe(true);
  });

  it('keeps a real trade even when a stray second category looks wrong', () => {
    // D.Jones Electrical & Maintenance is a genuine Crawley electrician tagged
    // electrician + real_estate_agency. A trade type always wins.
    expect(isTrader(['electrician', 'establishment', 'point_of_interest', 'real_estate_agency'])).toBe(true);
    expect(isTrader(['locksmith', 'establishment', 'point_of_interest'])).toBe(true);
  });

  it('filters shops out of a real pack', () => {
    const taunton = [
      { name: 'Pets at Home Taunton', address: 'Taunton TA1 2AB', rating: 4.3, reviews: 1395, types: ['pet_store', 'store'] },
      { name: 'Otter Garden Centre, Taunton', address: 'Taunton TA3 5AA', rating: 4.5, reviews: 790, types: ['store'] },
      { name: 'KO-Pest Control Somerset', address: 'Taunton TA2 6RX', rating: 5, reviews: 283, types: ['establishment', 'point_of_interest'] },
      { name: 'LW Pest control', address: 'Taunton TA1 4QR', rating: 5, reviews: 16, types: ['establishment'] },
    ];
    const kept = realCompetitors(taunton, (n) => n === 'LW Pest control').map((r) => r.name);
    expect(kept).toEqual(['KO-Pest Control Somerset']);
  });
});

describe('the nearby-town widening actually returns businesses', () => {
  // Nearby Search sends `vicinity` ("Colonial House, Swinemoor Ln, Beverley"),
  // NOT `formatted_address`, and a vicinity carries no postcode. Running those
  // rows through inUk() rejects every one of them, which silently emptied the
  // widening the first time it was written and produced a symptom identical to
  // the bug being fixed. The radius around a GB-restricted geocode is the
  // geography guarantee for these rows.
  const nearby = [
    { name: 'East Riding Pest Management', address: 'County House, Dunswell Rd, Cottingham', rating: 4.9, reviews: 58, types: ['establishment'] },
    { name: 'Rush Hour Pest Control', address: 'Cottingham Rd, Hull', rating: 5, reviews: 54, types: ['establishment'] },
  ];

  it('would reject every widened row if the address test were applied', () => {
    for (const r of nearby) expect(inUk(r.address), r.address).toBe(false);
    expect(realCompetitors(nearby, () => false)).toHaveLength(0);
  });

  it('keeps them when the caller says the radius already bounded them', () => {
    expect(realCompetitors(nearby, () => false, { radiusBounded: true })).toHaveLength(2);
  });

  it('is called that way by the API', () => {
    const api = readFileSync(resolve(__dirname, '..', 'api/leads/rank-frame.ts'), 'utf8');
    expect(api).toMatch(/nearbyPack\(anchor, radius, trade\.plural\), isLead, \{ radiusBounded: true \}/);
  });
});

describe('only a business with more reviews may sit above the lead', () => {
  // The baked voiceover says "the only reason they're up there is more
  // reviews", and GoogleScrollV prints ({row.reviews}) beside every name. A row
  // above the lead showing a smaller number contradicts the narration on screen,
  // in the lead's own market, next to names they recognise.
  const rows = [
    { name: 'Viking', address: 'Beverley HU17 0LT', rating: 4.8, reviews: 550 },
    { name: 'Yorkshire Coast', address: 'Scarborough YO11 3NN', rating: 4.9, reviews: 36 },
    { name: 'Pest-Techs', address: 'Scarborough YO11 3SF', rating: 4.7, reviews: 34 },
    { name: 'East Coast', address: 'Scarborough YO11 3UW', rating: 5, reviews: 11 },
  ];

  it('splits Bite Back\'s real Bridlington pack exactly as Google reported it', () => {
    const { above, below } = splitByReviews(rows, 42);
    expect(above.map((r) => r.name)).toEqual(['Viking']);
    expect(below.map((r) => r.name)).toEqual(['Yorkshire Coast', 'Pest-Techs', 'East Coast']);
    // 1 real business above, and the video needs 3. This is the refusal that
    // reached the board as "Google didn't return enough real businesses".
    expect(above.length).toBeLessThan(MIN_REAL_ABOVE);
  });

  it('never places a lower-reviewed business above the lead', () => {
    const { above } = splitByReviews(rows, 42);
    for (const r of above) expect(r.reviews!).toBeGreaterThan(42);
  });

  it('claims nothing beats a lead whose review count we do not know', () => {
    const { above, below } = splitByReviews(rows, null);
    expect(above).toHaveLength(4);
    expect(below).toHaveLength(0);
  });
});

describe('the .mjs twin the scraper imports stays in step', () => {
  // The scraper is a plain Node script and cannot import the TypeScript module,
  // so the rules live twice. Two copies of a rule WILL drift, and drift between
  // exactly these two files is what caused the bug.
  const ts = readFileSync(resolve(__dirname, '..', 'api/lib/uk-places.ts'), 'utf8');
  const mjs = readFileSync(resolve(__dirname, '..', 'scripts/lib/uk-places.mjs'), 'utf8');

  const nonTraderOf = (src: string) => src.match(/NON_TRADER\s*=\s*\n?\s*(\/.+\/i)/)?.[1];

  it('uses the same non-trader list on both sides', () => {
    expect(nonTraderOf(mjs)).toBeTruthy();
    expect(nonTraderOf(mjs)).toBe(nonTraderOf(ts));
  });

  it('uses the same minimum on both sides', () => {
    expect(mjs).toMatch(new RegExp(`MIN_REAL_ABOVE\\s*=\\s*${MIN_REAL_ABOVE}\\b`));
  });

  it('uses the same shop and trade category lists on both sides', () => {
    const setOf = (src: string, name: string) =>
      src.match(new RegExp(`${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`))?.[1]
        ?.match(/'[a-z_]+'/g)?.sort().join(',');
    for (const name of ['NOT_A_TRADE', 'TRADE_TYPES']) {
      expect(setOf(mjs, name), name).toBeTruthy();
      expect(setOf(mjs, name), name).toBe(setOf(ts, name));
    }
  });

  it('reads the country the same way on both sides', () => {
    for (const src of [ts, mjs]) {
      expect(src).toMatch(/,\\s\*\(UK\|United Kingdom\)\$/);
      expect(src).toMatch(/\/\\d\/\.test\(lastPart\)/);
    }
  });

  it('is wired into the scraper, not just written', () => {
    // The line-status helper was written, tested and imported by nothing for a
    // while. Assert the wiring, do not assume it.
    const scraper = readFileSync(resolve(__dirname, '..', 'scripts/scrape-trade-leads.mjs'), 'utf8');
    expect(scraper).toMatch(/from '\.\/lib\/uk-places\.mjs'/);
    expect(scraper).toMatch(/inUk\(r\.formatted_address\)/);
    expect(scraper).toMatch(/isTrader\(r\.types\)/);
  });
});

describe('the API widens to nearby towns instead of inventing names', () => {
  const api = readFileSync(resolve(__dirname, '..', 'api/leads/rank-frame.ts'), 'utf8');

  it('anchors the nearby search on a UK-restricted geocode', () => {
    // components=country:GB IS a hard restriction on the Geocoding API, unlike
    // `region` on a Places search. That is what stops the widened search
    // resolving Scarborough to Ontario.
    expect(api).toMatch(/components:\s*'country:GB'/);
  });

  it('bounds the widened search by radius rather than by hope', () => {
    expect(api).toMatch(/nearbysearch/);
    expect(api).toMatch(/NEARBY_RADII/);
  });

  it('only widens with businesses that genuinely out-review the lead', () => {
    expect(api).toMatch(/\.filter\(\(r\) => \(r\.reviews \?\? 0\) > \(lead\.reviews \?\? 0\)\)/);
  });

  it('names the refusal so the render and the card cannot disagree', () => {
    expect(api).toMatch(/refusal/);
    expect(api).toMatch(/'no_results'/);
    expect(api).toMatch(/'thin_market'/);
  });
});

describe('what the agent is told, and what they are offered', () => {
  const THIN = "this lead out-reviews everyone we can reach: only 1 real businesses in Bridlington or nearby have more than Bite Back Pest Control's 42 reviews, and the video needs 3";
  const OLD = '[prep] only 1 real competitors above the lead, refusing to render a mostly-fabricated SERP';

  it('stops blaming Google for a pack Google filled', () => {
    expect(renderErrorText(THIN)).not.toMatch(/Google didn't return enough/i);
    expect(renderErrorText(THIN)).toMatch(/already has more reviews/i);
  });

  it('reads correctly for rows that failed before the fix', () => {
    // Both live failures were stored with the old wording. They must not keep
    // showing the old lie just because the text was written yesterday.
    expect(renderErrorText(OLD)).toMatch(/already has more reviews/i);
  });

  it('separates an empty search from a lead who out-reviews their area', () => {
    const none = 'no real businesses came back from Google for "pest control in Sale"';
    expect(renderErrorText(none)).toMatch(/no local businesses/i);
    expect(renderErrorText(none)).not.toMatch(/more reviews than almost every/i);
  });

  it('offers no retry for the one failure a retry cannot clear', () => {
    expect(canRetryRender(THIN)).toBe(false);
    expect(canRetryRender(OLD)).toBe(false);
    // Everything else is transient or fixable on the lead, so the button stays.
    expect(canRetryRender('net::ERR_CONNECTION_TIMED_OUT loading website')).toBe(true);
    expect(canRetryRender('no trade profile for this lead')).toBe(true);
    expect(canRetryRender('lead is missing town')).toBe(true);
    expect(canRetryRender(null)).toBe(true);
  });

  it('gates the board button on that rule', () => {
    const board = readFileSync(resolve(__dirname, '..', 'src/features/crm/pages/VideoFunnelPage.tsx'), 'utf8');
    expect(board).toMatch(/canRetryRender\(p\.render_error\)/);
  });

  it('carries no long dash', () => {
    for (const e of [THIN, OLD, 'no real businesses came back from Google', null]) {
      expect(renderErrorText(e)).not.toContain('—');
      expect(renderErrorText(e)).not.toContain('–');
    }
  });
});
