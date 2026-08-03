import { describe, expect, it } from "vitest";

import {
  COMMISSION_PER_SALE_USD,
  COMMISSION_RATE,
  POSTS_PER_DAY,
  SUBSCRIPTION_PRICE_USD,
  VIDEOS_PER_MONTH,
  cumulativeByMonth,
  monthlyCommission,
  salesPerMonth,
} from "./earnings";

describe("earnings model", () => {
  it("commission per sale is exactly 40% of the $108 yearly subscription", () => {
    expect(SUBSCRIPTION_PRICE_USD).toBe(108);
    expect(COMMISSION_RATE).toBe(0.4);
    expect(COMMISSION_PER_SALE_USD).toBeCloseTo(43.2, 5);
    expect(COMMISSION_PER_SALE_USD).toBeCloseTo(
      SUBSCRIPTION_PRICE_USD * COMMISSION_RATE,
      5,
    );
  });

  it("posting volume is two a day, sixty a month", () => {
    expect(POSTS_PER_DAY).toBe(2);
    expect(VIDEOS_PER_MONTH).toBe(60);
  });

  it("sales = views per video x videos per month x conversion", () => {
    // 1,000 views x 60 videos = 60,000 views. 0.2% of that is 120 sales.
    expect(salesPerMonth(1000, 0.2)).toBeCloseTo(120, 5);
    expect(salesPerMonth(0, 0.5)).toBe(0);
    expect(salesPerMonth(1000, 0)).toBe(0);
  });

  it("monthly commission is sales times $43.20", () => {
    expect(monthlyCommission(1000, 0.2)).toBeCloseTo(120 * 43.2, 5);
    expect(monthlyCommission(0, 0.2)).toBe(0);
  });

  it("cumulative earnings stack month on month with no invented growth", () => {
    const months = cumulativeByMonth(1000, 0.2, 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBeCloseTo(monthlyCommission(1000, 0.2), 5);
    expect(months[11]).toBeCloseTo(monthlyCommission(1000, 0.2) * 12, 5);
    for (let i = 1; i < months.length; i += 1) {
      expect(months[i]).toBeGreaterThanOrEqual(months[i - 1]);
    }
  });
});
