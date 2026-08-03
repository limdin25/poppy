import { describe, expect, it } from "vitest";

import { landingCopy } from "./copy";
import { COMMISSION_PER_SALE_USD, SUBSCRIPTION_PRICE_USD } from "./earnings";

const steps = landingCopy.howItWorks.steps;

describe("How it works", () => {
  it("runs four numbered steps, each with an icon", () => {
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.number)).toEqual(["01", "02", "03", "04"]);
    steps.forEach((step) => {
      expect(step.icon).toMatch(/^\/steps\/step\d\.webp$/);
      expect(step.title.length).toBeGreaterThan(0);
    });
  });

  it("balances the steps: every one carries the same number of short lines", () => {
    const counts = new Set(steps.map((s) => s.lines.length));
    expect(counts.size).toBe(1);
    expect([...counts][0]).toBe(3);
    steps.forEach((step) =>
      step.lines.forEach((line) => {
        // Short enough to read once, on a phone, in a second language.
        expect(line.length).toBeLessThanOrEqual(56);
      }),
    );
  });

  it("says whose link is in the post", () => {
    const text = steps.flatMap((s) => s.lines).join(" ");
    expect(text).toMatch(/your own affiliate link/i);
  });

  it("states the 40% and what it is worth per sale, matching the model", () => {
    const text = steps.flatMap((s) => s.lines).join(" ");
    expect(text).toContain("40%");
    expect(text).toContain(`$${COMMISSION_PER_SALE_USD.toFixed(2)}`);
    expect(text).toContain(`$${SUBSCRIPTION_PRICE_USD}`);
  });

  it("tells the visitor how the money reaches them", () => {
    const text = steps.flatMap((s) => s.lines).join(" ");
    expect(text).toMatch(/paid to the account/i);
  });
});
