import { describe, it, expect } from "vitest";
import {
  isSaleCleared,
  availableBalance,
  pendingReleases,
  PAYOUT_HOLD_DAYS,
} from "./payouts";

const NOW = new Date("2026-06-08T00:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

const base = {
  status: "confirmed",
  payout_id: null,
  purchase_complete_at: null,
  sold_at: daysAgo(0),
};

describe("isSaleCleared", () => {
  it("clears immediately when PURCHASE_COMPLETE was received", () => {
    expect(isSaleCleared({ ...base, purchase_complete_at: daysAgo(1) }, NOW)).toBe(true);
  });

  it("clears after the 21-day hold even without COMPLETE", () => {
    expect(isSaleCleared({ ...base, sold_at: daysAgo(22) }, NOW)).toBe(true);
  });

  it("is NOT cleared before 21 days with no COMPLETE", () => {
    expect(isSaleCleared({ ...base, sold_at: daysAgo(10) }, NOW)).toBe(false);
  });

  it("is never cleared if refunded/cancelled", () => {
    expect(
      isSaleCleared({ ...base, status: "refunded", sold_at: daysAgo(30) }, NOW),
    ).toBe(false);
  });

  it("is not cleared once it's in a payout", () => {
    expect(
      isSaleCleared({ ...base, payout_id: "p1", purchase_complete_at: daysAgo(1) }, NOW),
    ).toBe(false);
  });

  it("uses a 21-day window", () => {
    expect(PAYOUT_HOLD_DAYS).toBe(21);
  });
});

describe("availableBalance", () => {
  it("sums only the cleared sales", () => {
    const sales = [
      { ...base, id: "a", commission_amount: 12, sold_at: daysAgo(30) }, // cleared (old)
      { ...base, id: "b", commission_amount: 8, purchase_complete_at: daysAgo(1) }, // cleared (complete)
      { ...base, id: "c", commission_amount: 5, sold_at: daysAgo(3) }, // held
      {
        ...base,
        id: "d",
        commission_amount: 99,
        status: "refunded",
        sold_at: daysAgo(40),
      }, // refunded
    ];
    const r = availableBalance(sales, NOW);
    expect(r.amount).toBe(20);
    expect(r.count).toBe(2);
    expect(r.saleIds.sort()).toEqual(["a", "b"]);
  });
});

describe("pendingReleases", () => {
  it("groups not-yet-cleared sales by release date (sold_at + 21 days), excluding cleared/refunded", () => {
    const sales = [
      { ...base, id: "a", commission_amount: 5, sold_at: daysAgo(5) }, // → 2026-06-24
      { ...base, id: "b", commission_amount: 7, sold_at: daysAgo(5) }, // same date as a
      { ...base, id: "c", commission_amount: 9, sold_at: daysAgo(10) }, // → 2026-06-19
      { ...base, id: "d", commission_amount: 99, sold_at: daysAgo(30) }, // cleared → excluded
      {
        ...base,
        id: "e",
        commission_amount: 50,
        status: "refunded",
        sold_at: daysAgo(2),
      }, // excluded
    ];
    expect(pendingReleases(sales, NOW)).toEqual([
      { availableOn: "2026-06-19", amount: 9, count: 1 },
      { availableOn: "2026-06-24", amount: 12, count: 2 },
    ]);
  });

  it("returns nothing when all sales are already cleared", () => {
    const sales = [{ ...base, commission_amount: 5, sold_at: daysAgo(40) }];
    expect(pendingReleases(sales, NOW)).toEqual([]);
  });
});
