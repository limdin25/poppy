// What we may offer on a property, and how to print money. Pure functions, no
// imports, no side effects — so the BROWSER can import this file directly.
//
// Why it is not simply part of api/lib/brrr.ts: that module calls createClient()
// at module scope, which reads process.env and crashes under Vite. Anything the
// dialer needs has to live somewhere importable from both sides. The same trick
// is already used by src/features/crm/lib/interpolateScript.ts, which imports
// api/lib/trades.
//
// THE RULE THIS FILE EXISTS TO PROTECT
//
// The offer is a percentage of what the property is worth TODAY (its current
// market value, from same-bed sold comps), never of GDV — the value after the
// refurb — and never above the asking price.
//
// Pricing off GDV is the bug the scraper's valuation engine was rewritten to
// kill in June 2026: with a default £250/sqft it produced "offers" ABOVE the
// asking price. NFStay's tinder module still does it that way
// (marketplace10 src/features/tinder/lib/offer.ts: GDV x 0.70), which is why
// its screen shows £152,712 on a house that may be listed at £150,000. Do not
// port that maths back in.
//
// So: the scraper's valuation engine is the source of truth. deal.offer_min and
// deal.offer_max already have the cap and the confidence penalties baked in.
// The percentage fallback below only fires when a property arrives with no
// valuation attached at all.

/** The two knobs from platform_settings.brrr_settings, both percentages. */
export interface OfferPercents {
  offer_low_pct: number;
  offer_high_pct: number;
}

/** The bits of a property this maths reads. Structurally satisfied by
 *  BrrrProperty (api/lib/brrr.ts), PropertyRow (the admin page) and the rows
 *  returned by wk_property_agent_listings, so no caller needs a cast. */
export interface OfferSubject {
  asking_price?: number | string | null;
  deal?: Record<string, unknown> | null;
}

const DEFAULT_LOW_PCT = 70;
const DEFAULT_HIGH_PCT = 75;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return isFinite(n) ? n : 0;
}

/**
 * The band we are allowed to talk in: open at `min`, never pass `max`.
 *
 * Settings are optional and nullable because the admin page renders before its
 * settings fetch resolves; missing values fall back to 70/75, which is what
 * DEFAULT_BRRR_SETTINGS uses anyway.
 */
export function offerRange(
  property: OfferSubject,
  s?: Partial<OfferPercents> | null,
): { min: number; max: number } {
  const deal = property.deal || {};

  // Preferred: the valuation engine's own figures.
  //
  // TWO SHAPES, and both are real. valuation.py returns the offer NESTED, as
  // deal.offer = { open, max, ladder, ... }. The Comps page in the browser
  // used to flatten it to deal.offer_min / deal.offer_max before posting.
  // Reading only the flat keys is how 157 properties reached Pedro's screen
  // showing 70-75% of the ASKING PRICE while a real valuation sat in the row
  // underneath: nothing errored, the fallback simply took over. Found on the
  // live dialer 2026-08-10, Coniston Avenue NE31, which showed open £52,500
  // against the engine's £56,500 and, worse, a walk-away of £56,250 against a
  // true ceiling of £60,900. A silent fallback that produces a plausible
  // number is more dangerous than one that produces none.
  const nested = (deal.offer && typeof deal.offer === 'object'
    ? deal.offer as Record<string, unknown>
    : {});
  const engineMax = num(nested.max) || num(deal.offer_max) || num(deal.offer_price);
  if (engineMax > 0) {
    const engineMin = num(nested.open) || num(deal.offer_min);
    return {
      min: Math.round(engineMin > 0 ? Math.min(engineMin, engineMax) : engineMax),
      max: Math.round(engineMax),
    };
  }

  // Fallback: a percentage of asking. Both percentages are of ASKING, which is
  // itself a ceiling, so this can never exceed what the seller is asking for.
  const asking = num(property.asking_price);
  const highPct = s?.offer_high_pct ?? DEFAULT_HIGH_PCT;
  const lowPct = s?.offer_low_pct ?? DEFAULT_LOW_PCT;
  const max = Math.round(asking * highPct / 100);
  let min = Math.round(asking * lowPct / 100);
  if (!min || min > max) min = max;
  return { min, max };
}

/** Money for reading aloud. Falls back to words, not "£0" or "£NaN", because
 *  this string is spoken on live calls and put in front of agents. */
export function fmtGBP(n: unknown): string {
  const v = num(n);
  if (v <= 0) return 'an amount to be discussed';
  return `£${Math.round(v).toLocaleString('en-GB')}`;
}

/** The same money, for a table cell rather than a sentence. */
export function gbpShort(n: unknown): string {
  const v = num(n);
  if (v <= 0) return '—';
  return `£${Math.round(v).toLocaleString('en-GB')}`;
}

/**
 * The climb, as the agent hears it: "£108,000, then £114,000, then £119,500".
 *
 * The ladder comes from the valuation engine (an Ackerman-style sequence:
 * open, a third, two thirds, then a precise-looking final figure). An auction
 * has no ladder — you state a maximum and stop — so callers pass isAuction and
 * get the walk-away sentence instead.
 */
export function ladderText(
  deal: Record<string, unknown> | null | undefined,
  band: { min: number; max: number },
  isAuction = false,
): string {
  if (isAuction) {
    return `AUCTION — your absolute maximum is ${fmtGBP(band.max)}, never go beyond it`;
  }
  // Same two shapes as offerRange: the engine nests the ladder inside `offer`,
  // the old browser flow flattened it onto the deal.
  const nested = (deal?.offer && typeof deal.offer === 'object'
    ? deal.offer as Record<string, unknown>
    : {});
  const src = Array.isArray(nested.ladder) ? nested.ladder : deal?.ladder;
  const arr = Array.isArray(src) ? (src as unknown[]) : [];
  const steps = arr.map(num).filter((n) => n > 0);
  if (steps.length > 1) return steps.map((n) => fmtGBP(n)).join(', then ');
  return `${fmtGBP(band.min)}, climbing at most to ${fmtGBP(band.max)}`;
}

/**
 * What it costs to add a bedroom, by how many the house already has.
 *
 * Hugo's own figures, 2026-08-10, for the kitchen-to-bedroom conversion plus a
 * light refurb. This is the FIRST refurb estimate in the system that varies by
 * property: valuation.py has carried one flat `"refurb": 10_000` for every
 * house since it was written, which quietly prices a 3-to-4-bed conversion the
 * same as a 1-to-2.
 *
 * `budget` is the number to plan on. `low` and `high` are the range it usually
 * lands between, shown so nobody mistakes a planning figure for a quote.
 *
 * THE TWIN: scripts/lib/bedroom_uplift.py, which is copied to the scraper on
 * the VPS and imported by valuation.py. They MUST stay identical, and
 * tests/brrr-offer.test.ts reads the twin's source and fails if the numbers
 * drift. Same arrangement as api/lib/uk-places.ts and its .mjs twin. If you
 * edit one, edit the other.
 */
// Hugo's costings, 2026-08-11, and they REPLACED a much thinner table that had
// a 2-bed conversion at £16,000. That old figure was roughly the low end of the
// kitchen move alone, with no allowance for the rest of the works, and it fed
// straight into the maximum offer: measured across the live batch, every £1 of
// refurb error moves the most we can pay by £1.05. So the engine was prepared
// to overpay by about £20,000 on a 2-bed.
//
// Four costs per row, because the two jobs are separate and only their sum is
// what you actually spend:
//   conversion  moving the kitchen and building the new bedroom
//   refurb      the light refurbishment the rest of the place needs
//   total       the two added up, before contingency
//   low/high    Hugo's SENSIBLE BUDGET, which already carries 10-15% contingency
//
// `budget` is the midpoint of that sensible range and is the number to plan on.
// CONTINGENCY IS ALREADY INSIDE IT: nothing downstream may multiply it again,
// and valuation.py no longer does. Where extra caution is wanted (a suspiciously
// cheap asking price usually means something is wrong with the building) the
// engine uses `high` rather than inventing a multiplier of its own.
export const BEDROOM_UPLIFT_REFURB = [
  { from: 1, to: 2, conversionLow: 12_000, conversionHigh: 22_000, refurbLow: 8_000, refurbHigh: 14_000, totalLow: 20_000, totalHigh: 36_000, low: 22_000, high: 41_000, budget: 31_500 },
  { from: 2, to: 3, conversionLow: 13_000, conversionHigh: 23_000, refurbLow: 11_000, refurbHigh: 18_000, totalLow: 24_000, totalHigh: 41_000, low: 26_000, high: 47_000, budget: 36_500 },
  { from: 3, to: 4, conversionLow: 14_000, conversionHigh: 25_000, refurbLow: 15_000, refurbHigh: 24_000, totalLow: 29_000, totalHigh: 49_000, low: 32_000, high: 56_000, budget: 44_000 },
  { from: 4, to: 5, conversionLow: 15_000, conversionHigh: 27_000, refurbLow: 19_000, refurbHigh: 30_000, totalLow: 34_000, totalHigh: 57_000, low: 37_000, high: 66_000, budget: 51_500 },
] as const;

export interface UpliftRefurb {
  from: number; to: number;
  conversionLow: number; conversionHigh: number;
  refurbLow: number; refurbHigh: number;
  totalLow: number; totalHigh: number;
  /** The sensible budget range, contingency INCLUDED. */
  low: number; high: number;
  /** Midpoint of that range: the number to plan on. Never multiply it again. */
  budget: number;
}

/**
 * The cost of taking this house from its current bed count to one more.
 *
 * Returns null outside 1 to 4 beds, and that matters: there is no row for a
 * studio or for a 5-bed going to 6, and inventing one by extrapolating is how
 * a plausible wrong number ends up on screen next to a real valuation. A null
 * means "we do not have a figure for this", which the UI can say honestly.
 */
export function upliftRefurb(beds: number | null | undefined): UpliftRefurb | null {
  const n = typeof beds === 'number' ? beds : parseInt(String(beds ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  return BEDROOM_UPLIFT_REFURB.find((r) => r.from === n) ?? null;
}
