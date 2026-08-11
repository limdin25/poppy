// Does this deal actually stack, and how much cash does it take?
//
// A different question from "what do I offer". The offer band
// (api/lib/brrr-offer.ts) is what Pedro says on the phone. This is what Hugo
// works out afterwards, on the admin Properties page, before deciding to buy.
//
// Ported from marketplace10 src/features/tinder/lib/gdv.ts (computeDeal), which
// is Hugo's own model and shipped with no tests. Three deliberate changes:
//
//   1. PURCHASE IS AN INPUT, not marketValue x 0.75. The original assumed the
//      purchase price equals 75% of market value. We already know the real
//      figure: it is the offer the valuation engine produced, capped below
//      asking. Feeding the model a made-up purchase price when the true one is
//      sitting in the same row would be silly.
//   2. All the assumptions live in ONE object with a date on it, instead of
//      scattered bare constants, because they are Hugo's numbers and they will
//      change.
//   3. It has tests. tests/deal-calculator.test.ts.
//
// Every figure below is pounds, and every rate is a fraction (0.05 = 5%).

/** Hugo's assumptions. Editable, and correct as of 2026-08-09. */
export const DEAL_ASSUMPTIONS = {
  solicitor: 3200,
  surveys: 1350,
  /** Stamp duty as a flat rate. The real thing is banded and there is an
   *  additional-dwelling surcharge; this is the working rule Hugo uses. */
  sdltRate: 0.05,
  /** Bridging interest, per month. */
  bridgeRate: 0.01,
  /** Bridging arrangement fee, one off. */
  arrangementFeeRate: 0.02,
  /** Loan to value on both the bridge and the refinance. */
  ltv: 0.75,
  /** Buy-to-let mortgage rate after refinancing. */
  btlRate: 0.055,
  /** Landlord insurance, per month. */
  insurancePcm: 50,
  /** Hard ceilings. Above either of these, walk away. */
  marketValueCap: 160_000,
  purchaseCeiling: 120_000,
  /** Cash available without bringing in a partner. */
  cashBudget: 25_000,
  /** How the monthly profit is split. Must total 1. */
  split: { hugo: 0.4, partner1: 0.3, partner2: 0.3 },
} as const;

export interface DealInput {
  /** What we actually pay. Defaults to the offer, not a percentage of value. */
  purchase: number;
  /** What it is worth today, from the sold comps. */
  marketValue: number;
  /** Refurb budget. */
  refurb: number;
  /** Expected rent once let. */
  rentPcm: number;
  /** How long we hold the bridge before refinancing. */
  termMonths: number;
}

export interface RefiScenario {
  label: string;
  upliftPct: number;
  /** Value after works. */
  arv: number;
  newMortgage: number;
  payoff: number;
  /** What comes back out. Negative means money left in. */
  cashBack: number;
  /** Cash back minus cash in. Positive = a full recycle and then some. */
  resultVsCashIn: number;
}

export type DealVerdict =
  | { kind: 'walk_mv'; text: string }
  | { kind: 'walk_purchase'; text: string }
  | { kind: 'needs_jv'; text: string }
  | { kind: 'ok'; text: string };

export interface DealResult {
  purchase: number;
  bridge: number;
  arrangementFee: number;
  interest: number;
  netLoan: number;
  /** The shortfall between the purchase price and what the bridge actually
   *  hands over after its fees. */
  gap: number;
  sdlt: number;
  /** Everything Hugo has to find on day one. */
  totalCash: number;
  scenarios: RefiScenario[];
  bestMortgage: number;
  monthly: {
    rent: number;
    mortgage: number;
    insurance: number;
    profit: number;
    hugoShare: number;
    partner1Share: number;
    partner2Share: number;
  };
  verdict: DealVerdict;
}

const UPLIFTS: Array<{ label: string; pct: number }> = [
  { label: 'Best case, 40% uplift', pct: 0.40 },
  { label: 'Good case, 35% uplift', pct: 0.35 },
  { label: 'Okay case, 30% uplift', pct: 0.30 },
  { label: 'Worst case, 25% uplift', pct: 0.25 },
];

export function computeDeal(input: DealInput, a = DEAL_ASSUMPTIONS): DealResult {
  const purchase = Math.max(0, input.purchase || 0);
  const marketValue = Math.max(0, input.marketValue || 0);
  const refurb = Math.max(0, input.refurb || 0);
  const rentPcm = Math.max(0, input.rentPcm || 0);
  const termMonths = Math.max(0, input.termMonths || 0);

  // The bridge is lent against what the property is WORTH, not what we pay for
  // it. Buying under market value is the whole point, so these differ, and that
  // difference is most of the reason the deal works.
  const bridge = marketValue * a.ltv;
  const arrangementFee = bridge * a.arrangementFeeRate;
  const interest = bridge * a.bridgeRate * termMonths;
  const netLoan = bridge - arrangementFee - interest;
  const gap = purchase - netLoan;
  const sdlt = purchase * a.sdltRate;
  const totalCash = gap + sdlt + a.solicitor + a.surveys;

  let bestMortgage = 0;
  const scenarios = UPLIFTS.map((s, i): RefiScenario => {
    const arv = marketValue * (1 + s.pct);
    const newMortgage = arv * a.ltv;
    const payoff = bridge + refurb;
    const cashBack = newMortgage - payoff;
    if (i === 0) bestMortgage = newMortgage;
    return {
      label: s.label,
      upliftPct: s.pct,
      arv,
      newMortgage,
      payoff,
      cashBack,
      resultVsCashIn: cashBack - totalCash,
    };
  });

  const mortgage = (bestMortgage * a.btlRate) / 12;
  const profit = rentPcm - mortgage - a.insurancePcm;

  // Order matters: the two hard ceilings are walk-aways, and a deal that fails
  // one of them is not rescued by having enough cash for it.
  let verdict: DealVerdict;
  if (marketValue > a.marketValueCap) {
    verdict = { kind: 'walk_mv', text: `Worth more than the £${a.marketValueCap.toLocaleString()} cap. Walk away.` };
  } else if (purchase > a.purchaseCeiling) {
    verdict = { kind: 'walk_purchase', text: `Purchase price is over the £${a.purchaseCeiling.toLocaleString()} ceiling. Walk away.` };
  } else if (totalCash > a.cashBudget) {
    verdict = { kind: 'needs_jv', text: `Needs more than the £${a.cashBudget.toLocaleString()} budget. This one needs a partner from day one.` };
  } else {
    verdict = { kind: 'ok', text: `Fits inside the £${a.cashBudget.toLocaleString()} budget.` };
  }

  return {
    purchase, bridge, arrangementFee, interest, netLoan, gap, sdlt, totalCash,
    scenarios, bestMortgage,
    monthly: {
      rent: rentPcm,
      mortgage,
      insurance: a.insurancePcm,
      profit,
      hugoShare: profit * a.split.hugo,
      partner1Share: profit * a.split.partner1,
      partner2Share: profit * a.split.partner2,
    },
    verdict,
  };
}

/** Money, including negatives, which matter here: a negative cashBack means
 *  money left in the deal. */
export function money(n: number): string {
  const v = Math.round(n || 0);
  return `${v < 0 ? '-£' : '£'}${Math.abs(v).toLocaleString('en-GB')}`;
}
