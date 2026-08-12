// What the deal engine says ABOUT a property, in words: which strategy, how
// far below market it is, and what condition it is in.
//
// Sibling of brrr-offer.ts and bound by the same rule: pure functions, no
// imports, no environment, so the BROWSER can import it directly and the server
// can import the same copy. Two readers of the same field is how they drift.
//
// THE RULE THIS FILE EXISTS TO PROTECT
//
// Every value here is READ, never derived. The strategy, the BMV band and the
// condition band are the deal engine's own conclusions and there is no way to
// recompute them from what reaches this repo:
//
//   BMV = 1 - (purchase / TMV)     and     TMV = GDV - refurb
//
// The refurb figure never crosses into Elsie, so any BMV worked out here would
// be measured against the wrong denominator. It would look completely
// reasonable and be wrong, and Pedro reads these numbers down a live phone line
// to an estate agent. So when the engine has not said it, this file says
// nothing. Absent is a safe answer; a plausible guess is not.
//
// Everything is nullable on purpose. The engine that fills these fields is
// being wired up on the scraper box, and until it lands every property arrives
// without them. That is the normal state, not an error.

/** Anything with a deal blob on it: brrr_properties rows, RPC rows, listings. */
export interface DealSubject {
  deal?: Record<string, unknown> | null;
}

/** How deep to look for a key inside the deal blob.
 *
 *  valuation.py nests its answer (deal.cmv, deal.offer, deal.gdv, deal.stack)
 *  and the older browser flow flattened it, so both shapes are live in the
 *  table today. Rather than guess which level the new engine will write to,
 *  this looks for the KEY by name, breadth first, top level first. The key
 *  names come from the plan and are specific enough that a collision is not
 *  realistic; arrays are skipped so a comp row can never answer for the deal.
 */
const MAX_DEPTH = 3;

/** The first non-empty string stored under `key`, anywhere in the deal blob. */
export function pluckString(
  deal: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!deal || typeof deal !== 'object') return null;
  let level: Record<string, unknown>[] = [deal];
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth += 1) {
    const next: Record<string, unknown>[] = [];
    for (const node of level) {
      const v = node[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      for (const child of Object.values(node)) {
        // Plain objects only. An array here would let one comparable row or one
        // audit check answer a question about the whole deal.
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          next.push(child as Record<string, unknown>);
        }
      }
    }
    level = next;
  }
  return null;
}

/** "meets criteria" / "Meets_Criteria" / " STRONG " all read the same. */
function code(v: string | null): string {
  return (v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// ── Strategy ────────────────────────────────────────────────────────────────

/** The three Hugo picked, 2026-08-11. Anything else is shown as it arrived
 *  rather than hidden, because a new strategy the engine starts emitting is
 *  information, not a fault. */
const STRATEGY_LABELS: Record<string, string> = {
  brrr: 'BRRR',
  brr: 'BRRR',
  flip: 'FLIP',
  hmo: 'HMO',
  btl: 'BTL',
};

/** Which deal this is, for the chip above the script. Null when the engine did
 *  not say, which is every property until the new engine ships. */
export function dealStrategy(subject: DealSubject): string | null {
  const raw = code(pluckString(subject.deal, 'strategy'));
  if (!raw) return null;
  if (STRATEGY_LABELS[raw]) return STRATEGY_LABELS[raw];
  // An unrecognised value is still the engine's answer. Tidy it, cap it so a
  // stray sentence cannot push the offer figures off Pedro's screen, and show
  // it. Anything longer than a label is not a strategy and is dropped.
  if (raw.length > 24) return null;
  return raw.replace(/_/g, ' ').toUpperCase();
}

// ── BMV band ────────────────────────────────────────────────────────────────

export interface BmvBand {
  /** thin | meets_criteria | strong */
  code: 'thin' | 'meets_criteria' | 'strong';
  /** What the chip says. */
  label: string;
  /** How hard to push, in words Pedro can act on mid-call. */
  note: string;
}

/** Hugo, 2026-08-11, decision 3: "Accept 15% BMV and up, labelled", so Pedro
 *  can see how hard to push. The labels carry NO percentages on purpose. The
 *  thresholds are config on the engine side and can be tuned without a deploy
 *  here, so printing a range would eventually print a wrong one. */
const BMV_BANDS: Record<string, BmvBand> = {
  thin: {
    code: 'thin',
    label: 'THIN DEAL',
    note: 'Barely worth doing. Hold near the opener and do not climb far.',
  },
  meets_criteria: {
    code: 'meets_criteria',
    label: 'MEETS CRITERIA',
    note: 'A normal deal. Climb the ladder a rung at a time.',
  },
  strong: {
    code: 'strong',
    label: 'STRONG DEAL',
    note: 'Room in this one. Worth pushing for.',
  },
};

/** How far below market this is, as a band. Null when the engine did not say.
 *
 *  Deliberately strict: only the three known bands are accepted. An unknown
 *  word here would be shown beside the offer figures as though it graded them,
 *  and a band Pedro cannot act on is worse than no band at all. */
export function dealBmvBand(subject: DealSubject): BmvBand | null {
  const raw = code(pluckString(subject.deal, 'bmv_band'));
  if (!raw) return null;
  if (raw === 'meets' || raw === 'criteria') return BMV_BANDS.meets_criteria;
  return BMV_BANDS[raw] ?? null;
}

// ── Condition ───────────────────────────────────────────────────────────────

/** The eye's condition read, as a clause that fits inside a sentence.
 *  `unknown` is missing from this map on purpose: it is the honest answer on
 *  roughly a third of properties, and "condition unknown" is not a reason to
 *  buy anything. */
const CONDITION_CLAUSES: Record<string, string> = {
  derelict: 'derelict, a full rebuild',
  full_refurb: 'needs a full refurb',
  modernisation: 'needs modernising',
  cosmetic: 'cosmetic work only',
  turnkey: 'turnkey, no work needed',
};

/** The condition band as the engine recorded it, e.g. "full_refurb". Null when
 *  absent or explicitly unknown. Used by the calibration report to see whether
 *  the refurb estimate drifts by condition. */
export function dealConditionBand(subject: DealSubject): string | null {
  const raw = code(pluckString(subject.deal, 'condition_band'));
  if (!raw || raw === 'unknown') return null;
  return raw;
}

/** The same thing in words, for the reason line. */
export function conditionClause(subject: DealSubject): string | null {
  const band = dealConditionBand(subject);
  return band ? CONDITION_CLAUSES[band] ?? null : null;
}

// ── The reason line ─────────────────────────────────────────────────────────

/**
 * One line of WHY this is a deal, for the strip above the script.
 *
 * The engine's own sentence wins if it wrote one. Otherwise it is built from
 * the condition read plus the first sold comparable, which is the shape the
 * plan asked for: "needs full refurb, 3-beds on this street sold at 100k".
 *
 * A comparable ON ITS OWN is not a reason and is never returned alone. It is
 * already one click away in the Houses tab, and the strip above a live script
 * is the wrong place to put something Pedro has to interpret. Empty string
 * means show nothing at all: no box, no dash, no "undefined".
 *
 * @param evidence the sold-comp sentences already built for this listing
 */
export function dealReasonLine(subject: DealSubject, evidence?: readonly string[]): string {
  const written = pluckString(subject.deal, 'reason') ?? pluckString(subject.deal, 'why');
  if (written) return written;

  const clause = conditionClause(subject);
  if (!clause) return '';
  const comp = (evidence ?? []).find((e) => typeof e === 'string' && e.trim());
  return comp ? `${clause}, ${comp.trim()}` : clause;
}

// ── Where it is ─────────────────────────────────────────────────────────────

const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/;
const OUTCODE_ONLY = /^[A-Z]{1,2}\d[A-Z\d]?$/;

/**
 * The outcode out of a scraped address, e.g. "LE7" from
 * "Willows End, Scraptoft Leicester, LE7 9TT".
 *
 * Scanned from the END backwards, because the postcode is always last and a
 * street name can contain anything. Returns null rather than a guess when
 * there is no postcode on the address, which is a real case: the calibration
 * report then files it under "unknown" instead of inventing an area.
 */
export function outcodeOf(address: string | null | undefined): string | null {
  const parts = String(address ?? '').split(',').map((p) => p.trim().toUpperCase());
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i];
    if (!p) continue;
    if (FULL_POSTCODE.test(p)) return p.replace(/\s+/g, '').slice(0, -3);
    if (OUTCODE_ONLY.test(p)) return p;
  }
  return null;
}
