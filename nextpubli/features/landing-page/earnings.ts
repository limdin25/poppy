/* The one sum the calculator is allowed to do. Every output on the landing page derives
   from these constants and the visitor's own slider values, so nothing on screen is an
   earnings claim we made up. */

export const SUBSCRIPTION_PRICE_USD = 108;
export const COMMISSION_RATE = 0.4;
export const COMMISSION_PER_SALE_USD = SUBSCRIPTION_PRICE_USD * COMMISSION_RATE;

export const POSTS_PER_DAY = 2;
export const VIDEOS_PER_MONTH = POSTS_PER_DAY * 30;

/** conversionPct is a percentage, e.g. 0.2 means 0.2% of viewers subscribe. */
export function salesPerMonth(viewsPerVideo: number, conversionPct: number): number {
  return viewsPerVideo * VIDEOS_PER_MONTH * (conversionPct / 100);
}

export function monthlyCommission(
  viewsPerVideo: number,
  conversionPct: number,
): number {
  return salesPerMonth(viewsPerVideo, conversionPct) * COMMISSION_PER_SALE_USD;
}

/** Cumulative earnings by month with reach held flat: no invented growth, it stacks
    anyway. Month 1 is one month of commission, month 12 is twelve. */
export function cumulativeByMonth(
  viewsPerVideo: number,
  conversionPct: number,
  months: number,
): number[] {
  const monthly = monthlyCommission(viewsPerVideo, conversionPct);
  return Array.from({ length: months }, (_, i) => monthly * (i + 1));
}
