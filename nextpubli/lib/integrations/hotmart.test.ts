import { describe, it, expect } from "vitest";
import { extractSck, computeCommission } from "./hotmart";

describe("extractSck", () => {
  it("reads the tag from data.purchase.tracking.source (primary)", () => {
    expect(extractSck({ purchase: { tracking: { source: "ana4k2p9" } } })).toBe(
      "ana4k2p9",
    );
  });

  it("falls back to data.purchase.sck", () => {
    expect(extractSck({ purchase: { sck: "ana4k2p9" } })).toBe("ana4k2p9");
  });

  it("falls back to data.purchase.tracking.external_code", () => {
    expect(extractSck({ purchase: { tracking: { external_code: "ext123" } } })).toBe(
      "ext123",
    );
  });

  it("falls back to top-level data.sck", () => {
    expect(extractSck({ sck: "topvalue" })).toBe("topvalue");
  });

  it("prefers tracking.source over the other locations", () => {
    expect(
      extractSck({ sck: "low", purchase: { sck: "mid", tracking: { source: "win" } } }),
    ).toBe("win");
  });

  it("trims and returns null when absent", () => {
    expect(extractSck({ purchase: { tracking: { source: "  spaced  " } } })).toBe(
      "spaced",
    );
    expect(extractSck({ purchase: { price: { value: 10 } } })).toBeNull();
    expect(extractSck({})).toBeNull();
  });
});

describe("computeCommission", () => {
  it("computes 20% of the sale, rounded to 2 decimals", () => {
    expect(computeCommission(100, 0.2)).toBe(20);
    expect(computeCommission(59.99, 0.2)).toBe(12); // 11.998 → 12.00
    expect(computeCommission(336, 0.2)).toBe(67.2);
  });

  it("honours a non-default rate", () => {
    expect(computeCommission(100, 0.3)).toBe(30);
  });

  it("guards against zero/negative inputs", () => {
    expect(computeCommission(0, 0.2)).toBe(0);
    expect(computeCommission(100, 0)).toBe(0);
    expect(computeCommission(-50, 0.2)).toBe(0);
  });
});
