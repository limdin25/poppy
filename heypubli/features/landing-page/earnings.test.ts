import { describe, expect, it } from "vitest";

import {
  ACCOUNT_MULTIPLIERS,
  AUDIENCE_BANDS,
  COMMISSION_PER_SALE_USD,
  COMMISSION_RATE,
  MAX_DISPLAYED_MONTHLY_USD,
  POSTS_PER_DAY,
  REACH_CAP_MULTIPLE,
  SALES_PER_VIEW,
  SUBSCRIPTION_PRICE_USD,
  VIDEOS_PER_MONTH,
  earningsRange,
  monthlyEarnings,
  monthlySales,
  monthlySeries,
  monthlyViews,
  reachMultiplier,
} from "@/lib/earnings";

/* These are not ordinary unit tests. Every constant below is an earnings claim on a page
   that paid Meta traffic lands on, so each one is pinned to its exact value: a silent
   nudge from 0.0001 to 0.001 multiplies every number on the site by ten and nothing in
   the UI would show it. Changing a number here should mean deliberately changing a test. */
describe("locked constants", () => {
  it("prices the product and the commission exactly", () => {
    expect(SUBSCRIPTION_PRICE_USD).toBe(108);
    expect(COMMISSION_RATE).toBe(0.4);
    expect(COMMISSION_PER_SALE_USD).toBeCloseTo(43.2, 5);
  });

  it("posts twice a day, sixty a month", () => {
    expect(POSTS_PER_DAY).toBe(2);
    expect(VIDEOS_PER_MONTH).toBe(60);
  });

  it("assumes one sale per ten thousand views and nothing rosier", () => {
    expect(SALES_PER_VIEW).toBe(0.0001);
  });

  it("caps reach growth at three times the start", () => {
    expect(REACH_CAP_MULTIPLE).toBe(3);
  });

  it("never displays more than $2,500 a month", () => {
    expect(MAX_DISPLAYED_MONTHLY_USD).toBe(2500);
  });

  it("scales extra accounts sublinearly and offers at most three", () => {
    expect(ACCOUNT_MULTIPLIERS).toEqual([1, 1.6, 2.2]);
  });

  it("keeps the view bands at the agreed dilution-adjusted numbers", () => {
    expect(AUDIENCE_BANDS.map((b) => b.viewsPerVideo)).toEqual([120, 300, 800, 2000, 3000]);
  });
});

describe("reachMultiplier", () => {
  it("starts at 1x in month one", () => {
    expect(reachMultiplier(1)).toBeCloseTo(1, 5);
  });

  it("saturates instead of compounding, so it is front loaded", () => {
    const m4 = reachMultiplier(4);
    const m12 = reachMultiplier(12);
    expect(m4).toBeCloseTo(1.75, 2);
    expect(m12).toBeCloseTo(2.375, 2);
    // First three months add more than the last three: that is what saturating means.
    expect(reachMultiplier(4) - reachMultiplier(1)).toBeGreaterThan(
      reachMultiplier(12) - reachMultiplier(9),
    );
  });

  it("never reaches the cap inside the window we show", () => {
    expect(reachMultiplier(12)).toBeLessThan(REACH_CAP_MULTIPLE);
  });

  it("still rises at month twelve so the curve does not go flat", () => {
    expect(reachMultiplier(12)).toBeGreaterThan(reachMultiplier(11));
  });
});

describe("the money", () => {
  const mid = AUDIENCE_BANDS[1].viewsPerVideo; // 300 views, the modal visitor

  it("counts views as views per video times sixty times reach times accounts", () => {
    expect(monthlyViews(mid, 1, 1)).toBeCloseTo(18000, 5);
    expect(monthlyViews(mid, 12, 1)).toBeCloseTo(18000 * reachMultiplier(12), 5);
    expect(monthlyViews(mid, 1, 3)).toBeCloseTo(18000 * 2.2, 5);
  });

  it("turns views into sales at one in ten thousand", () => {
    expect(monthlySales(mid, 1, 1)).toBeCloseTo(1.8, 5);
  });

  it("pays $43.20 a sale", () => {
    expect(monthlyEarnings(mid, 1, 1)).toBeCloseTo(77.76, 2);
    expect(monthlyEarnings(mid, 12, 1)).toBeCloseTo(184.68, 1);
  });

  it("returns a rising twelve month series", () => {
    const series = monthlySeries(mid, 1, 12);
    expect(series).toHaveLength(12);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]).toBeGreaterThan(series[i - 1]);
    }
  });

  it("lets the smallest account show a month with under one sale", () => {
    const small = AUDIENCE_BANDS[0].viewsPerVideo;
    expect(monthlySales(small, 1, 1)).toBeLessThan(1);
    expect(monthlyEarnings(small, 1, 1)).toBeCloseTo(31.1, 1);
  });
});

describe("earningsRange", () => {
  it("spreads half to one and a half times the estimate, rounded to ten", () => {
    const r = earningsRange(184.68);
    expect(r.low).toBe(90);
    expect(r.high).toBe(280);
    expect(r.clamped).toBe(false);
  });

  it("clamps the top at $2,500 however big the inputs get", () => {
    const r = earningsRange(4063);
    expect(r.high).toBe(MAX_DISPLAYED_MONTHLY_USD);
    expect(r.clamped).toBe(true);
  });

  it("clamps the bottom too rather than showing a range above the cap", () => {
    const r = earningsRange(9000);
    expect(r.low).toBe(MAX_DISPLAYED_MONTHLY_USD);
    expect(r.high).toBe(MAX_DISPLAYED_MONTHLY_USD);
    expect(r.clamped).toBe(true);
  });

  it("no band, at any account count, can ever display more than the cap", () => {
    AUDIENCE_BANDS.forEach((band) => {
      ACCOUNT_MULTIPLIERS.forEach((_, i) => {
        for (let month = 1; month <= 12; month += 1) {
          const r = earningsRange(monthlyEarnings(band.viewsPerVideo, month, i + 1));
          expect(r.high).toBeLessThanOrEqual(MAX_DISPLAYED_MONTHLY_USD);
        }
      });
    });
  });
});
