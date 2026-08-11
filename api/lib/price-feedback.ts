// Turning what a branch SAID into a number the engine can be judged against.
//
// Hugo, 2026-08-11, after asking how confident the pricing really is: "yes wire
// it". The honest answer that day was that nothing had ever been validated
// against reality, and that the answer was already arriving on the phone every
// day and being thrown away. Pedro types what the branch said into "FIGURE THEY
// MENTIONED" as free text, because that is how a human takes a note mid-call:
//
//   "£140,000"      "140k"      "looking around the 140 mark"
//   "offers over 125,000"       "they'd take 95"
//
// This turns those into 140000 / 140000 / 140000 / 125000 / 95000, or into
// null when it cannot be sure. Nothing here guesses: a figure it cannot read is
// kept as text and simply never enters the calibration.
//
// Pure module, no imports, no environment: the same rule has to run on the
// server and be testable without a database. See tests/price-feedback.test.ts.

/** What the branch said, once it is a number we can compare. */
export interface SpokenPrice {
  /** The number, in pounds. Null when the text could not be read safely. */
  price: number | null;
  /** Why, when it is null. Recorded so a bad parse is visible, not silent. */
  reason?: string;
}

/**
 * A property figure inside a sentence.
 *
 * @param text     what the agent typed
 * @param asking   the asking price, used ONLY as a sanity range. Without it the
 *                 parse is stricter, because "3" could be three viewings.
 */
export function parseSpokenPrice(text: unknown, asking?: number | null): SpokenPrice {
  const raw = String(text ?? '').trim();
  if (!raw) return { price: null, reason: 'nothing said' };

  // A number is NOT a price when the words around it say it is something else.
  // Without these two lists, "89 years left on the lease" on a house asking
  // £120,000 records a vendor figure of £89,000: close enough to asking to look
  // completely reasonable, and pure poison in a dataset whose whole job is to
  // tell us whether our valuations are right. A wrong number here is worse than
  // no number, because it arrives wearing the same confidence as a real one.
  const UNIT_AFTER = /^\s*(?:years?|yrs?|months?|mons?|weeks?|days?|viewings?|offers?|beds?|bedrooms?|baths?|people|calls?|%|per\s?cent|sq\b|square|acres?|miles?|mins?|minutes?)/i;
  const NOT_A_PRICE_BEFORE = /(?:rent|charge|fee|deposit|lease|epc|band|floor|unit|flat|apartment|no\.?|number|phone|call|since|built|room)\s*$/i;

  // Every number in the sentence, with an optional k suffix. Commas inside a
  // number are kept ("140,000"), the pound sign is ignored.
  const matches = [...raw.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|K)?/g)];
  if (matches.length === 0) return { price: null, reason: 'no number in the text' };

  const candidates: number[] = [];
  for (const m of matches) {
    const at = m.index ?? 0;
    const before = raw.slice(Math.max(0, at - 24), at);
    const after = raw.slice(at + m[0].length);
    if (UNIT_AFTER.test(after)) continue;          // "89 years", "2 beds", "3 viewings"
    if (NOT_A_PRICE_BEFORE.test(before)) continue; // "ground rent 250", "Flat 22"

    const digits = m[1].replace(/,/g, '');
    let value = parseFloat(digits);
    if (!Number.isFinite(value) || value <= 0) continue;
    // "140k" and, because nobody says a house is worth one hundred and forty
    // pounds, a bare "140" as well. The cut-off is 1,000: below it the number
    // is shorthand for thousands, at or above it it is already pounds.
    if (m[2] || value < 1_000) value *= 1_000;
    candidates.push(Math.round(value));
  }
  if (candidates.length === 0) return { price: null, reason: 'no usable number' };

  // A plausible UK house price at all. Anything outside this is a lease length,
  // a service charge, a door number or a phone number.
  const plausible = candidates.filter((v) => v >= 10_000 && v <= 5_000_000);
  if (plausible.length === 0) {
    return { price: null, reason: 'the numbers do not look like a house price' };
  }

  if (asking && asking > 0) {
    // With an asking price we can be strict: a figure a branch names about THIS
    // house lands near its asking price. This is what stops "3 viewings booked,
    // 2 offers" becoming a £3,000 valuation, and it is why the asking price is
    // passed in rather than assumed.
    const near = plausible.filter((v) => v >= 0.3 * asking && v <= 3 * asking);
    if (near.length === 0) {
      return { price: null, reason: 'the figure is nowhere near the asking price' };
    }
    // The one closest to asking. A sentence like "they paid 95 in 2019, they
    // want 140" is about the 140 when the house is on at 145.
    near.sort((a, b) => Math.abs(a - asking) - Math.abs(b - asking));
    return { price: near[0] };
  }

  // No asking price to check against: only trust an unambiguous single figure.
  if (plausible.length > 1) {
    return { price: null, reason: 'several numbers and no asking price to judge by' };
  }
  return { price: plausible[0] };
}

/** One row of the calibration set: what we said, against what they said. */
export interface CalibrationRow {
  said_price: number | null;
  asking_price: number | null;
  cmv: number | null;
  cmv_confidence: string | null;
  offer_max: number | null;
}

export interface Calibration {
  /** How many usable data points went into this. */
  n: number;
  /** Median of (what they said / what we said it is worth). 1.0 = perfect.
   *  Above 1 means the engine is valuing BELOW what the market is asking of
   *  us, below 1 means the engine is optimistic. */
  vsCmv: number | null;
  /** Median of (what they said / the asking price). How far branches actually
   *  come down from the advert, which is the number that decides whether the
   *  whole strategy has room in it. */
  vsAsking: number | null;
  /** How often their figure was at or below our walk-away price, so the deal
   *  was doable on our own maths. */
  withinCeiling: number;
  /** Same, as a share of n. */
  withinCeilingPct: number | null;
  /** vsCmv split by how confident the engine claimed to be, which is the only
   *  way to find out whether "low confidence" actually means worse. */
  byConfidence: Record<string, { n: number; vsCmv: number | null }>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The whole point: does what the engine says line up with what the people
 * selling the houses say. Deliberately medians, not averages, for the same
 * reason the valuation engine uses them: one silly row must not move it.
 */
export function calibrate(rows: CalibrationRow[]): Calibration {
  const usable = rows.filter((r) => (r.said_price ?? 0) > 0);
  const cmvRatios: number[] = [];
  const askRatios: number[] = [];
  const byConf: Record<string, number[]> = {};
  let within = 0;

  for (const r of usable) {
    const said = r.said_price as number;
    if (r.cmv && r.cmv > 0) {
      const ratio = said / r.cmv;
      cmvRatios.push(ratio);
      const key = r.cmv_confidence || 'unknown';
      (byConf[key] ||= []).push(ratio);
    }
    if (r.asking_price && r.asking_price > 0) askRatios.push(said / r.asking_price);
    if (r.offer_max && r.offer_max > 0 && said <= r.offer_max) within += 1;
  }

  const byConfidence: Calibration['byConfidence'] = {};
  for (const [k, v] of Object.entries(byConf)) {
    byConfidence[k] = { n: v.length, vsCmv: median(v) };
  }

  return {
    n: usable.length,
    vsCmv: median(cmvRatios),
    vsAsking: median(askRatios),
    withinCeiling: within,
    withinCeilingPct: usable.length ? within / usable.length : null,
    byConfidence,
  };
}
