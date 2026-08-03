/* The earnings model behind the landing page calculator.
 *
 * Read this before changing a number. HeyPubli is pre-revenue: not one creator has been
 * paid, so there is no internal data behind any figure here. Every constant is a
 * deliberately conservative estimate from public benchmarks, and a chart makes an
 * estimate look like a measurement. That is why the visitor cannot edit any of the
 * assumptions, why the displayed figure is a clamped range rather than a point, and why
 * earnings.test.ts pins each constant to its literal value so none of them can drift
 * without a failing build.
 *
 * Replace these with real payout data as soon as the first sales land.
 */

export const SUBSCRIPTION_PRICE_USD = 108;
export const COMMISSION_RATE = 0.4;
export const COMMISSION_PER_SALE_USD = SUBSCRIPTION_PRICE_USD * COMMISSION_RATE;

export const POSTS_PER_DAY = 2;
export const VIDEOS_PER_MONTH = POSTS_PER_DAY * 30;

/** One sale per 10,000 views. Instagram reels carry no in-video link, so the real path
 *  is view -> profile visit -> bio link -> checkout on a $108 upfront annual plan. The
 *  defensible band is 1 in 10,000 on a very good day to 1 in 80,000 typically. This is
 *  the optimistic end of that band, which is why nothing else in the model flatters. */
export const SALES_PER_VIEW = 0.0001;

/** Reach saturates, it does not compound. An account posting consistently takes the easy
 *  algorithmic gains in the first few months and then flattens, so a curve that
 *  accelerates into month 12 is backwards. Half saturation at month 5, hard ceiling 3x,
 *  never actually reached inside the 12 months we draw. */
export const REACH_CAP_MULTIPLE = 3;
export const REACH_HALF_SATURATION_MONTHS = 5;

/** Extra accounts scale sublinearly: the same AI videos across several accounts overlap
 *  in audience, cannibalise each other's attribution and attract the unoriginal-content
 *  demotion. Three is the most we offer, and it is a fixed choice rather than a number
 *  box so nobody can type 25 and screenshot a fantasy. */
export const ACCOUNT_MULTIPLIERS = [1, 1.6, 2.2];
export const MAX_ACCOUNTS = ACCOUNT_MULTIPLIERS.length;

/** Nothing on this page displays more than this a month, whatever the inputs say. */
export const MAX_DISPLAYED_MONTHLY_USD = 2500;

export interface AudienceBand {
  id: string;
  label: string;
  /** Sustained views per video across 60 posts a month, NOT the account's best reel.
   *  Going from roughly 10 posts a month to 60 does not multiply total reach by six:
   *  attention is bounded and the extra posts cannibalise each other. These numbers are
   *  already discounted for that, so no separate dilution term is applied anywhere. */
  viewsPerVideo: number;
}

export const AUDIENCE_BANDS: AudienceBand[] = [
  { id: "under-1k", label: "Under 1,000", viewsPerVideo: 120 },
  { id: "1k-10k", label: "1,000 to 10,000", viewsPerVideo: 300 },
  { id: "10k-50k", label: "10,000 to 50,000", viewsPerVideo: 800 },
  { id: "50k-200k", label: "50,000 to 200,000", viewsPerVideo: 2000 },
  { id: "200k-plus", label: "Over 200,000", viewsPerVideo: 3000 },
];

/** 1.0x in month 1, about 1.75x by month 4, about 2.38x by month 12. Still rising at the
 *  right edge, so the snowball is visible without the curve turning into a rocket. */
export function reachMultiplier(month: number): number {
  const elapsed = Math.max(0, month - 1);
  return (
    1 +
    (REACH_CAP_MULTIPLE - 1) *
      (elapsed / (elapsed + REACH_HALF_SATURATION_MONTHS))
  );
}

export function accountMultiplier(accounts: number): number {
  const index = Math.min(Math.max(Math.round(accounts), 1), MAX_ACCOUNTS) - 1;
  return ACCOUNT_MULTIPLIERS[index];
}

export function monthlyViews(
  viewsPerVideo: number,
  month: number,
  accounts: number,
): number {
  return (
    viewsPerVideo *
    VIDEOS_PER_MONTH *
    reachMultiplier(month) *
    accountMultiplier(accounts)
  );
}

export function monthlySales(
  viewsPerVideo: number,
  month: number,
  accounts: number,
): number {
  return monthlyViews(viewsPerVideo, month, accounts) * SALES_PER_VIEW;
}

export function monthlyEarnings(
  viewsPerVideo: number,
  month: number,
  accounts: number,
): number {
  return monthlySales(viewsPerVideo, month, accounts) * COMMISSION_PER_SALE_USD;
}

export function monthlySeries(
  viewsPerVideo: number,
  accounts: number,
  months: number,
): number[] {
  return Array.from({ length: months }, (_, i) =>
    monthlyEarnings(viewsPerVideo, i + 1, accounts),
  );
}

export interface EarningsRange {
  low: number;
  high: number;
  /** True when the cap bit. The UI says so out loud rather than hiding it. */
  clamped: boolean;
}

/** A range, not a point. A point estimate is a prediction that has to be defended; a
 *  range states the uncertainty honestly, and it is the truthful answer to the fact that
 *  Instagram views swing enormously month to month. */
export function earningsRange(point: number): EarningsRange {
  const toTen = (n: number) => Math.round(n / 10) * 10;
  const rawLow = toTen(point * 0.5);
  const rawHigh = toTen(point * 1.5);
  return {
    low: Math.min(rawLow, MAX_DISPLAYED_MONTHLY_USD),
    high: Math.min(rawHigh, MAX_DISPLAYED_MONTHLY_USD),
    clamped: rawHigh > MAX_DISPLAYED_MONTHLY_USD,
  };
}
