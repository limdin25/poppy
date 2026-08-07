import { describe, expect, it } from "vitest";

import { landingCopy } from "./copy";
import { COMMISSION_PER_SALE_USD, SUBSCRIPTION_PRICE_USD } from "@/lib/earnings";

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

  it("balances the steps: each is one paragraph of a similar length", () => {
    const lengths = steps.map((s) => s.body.length);
    lengths.forEach((len) => {
      expect(len).toBeGreaterThanOrEqual(90);
      expect(len).toBeLessThanOrEqual(170);
    });
    // No column may run to nearly double another, or the row looks lopsided.
    expect(Math.max(...lengths)).toBeLessThan(Math.min(...lengths) * 1.8);
  });

  it("says whose link is in the post", () => {
    const text = steps.map((s) => s.body).join(" ");
    expect(text).toMatch(/your own affiliate link/i);
  });

  it("states the 40% and what it is worth per sale, matching the model", () => {
    const text = steps.map((s) => s.body).join(" ");
    expect(text).toContain("40%");
    expect(text).toContain(`$${COMMISSION_PER_SALE_USD.toFixed(2)}`);
    expect(text).toContain(`$${SUBSCRIPTION_PRICE_USD}`);
  });

  it("tells the visitor how the money reaches them", () => {
    const text = steps.map((s) => s.body).join(" ");
    expect(text).toMatch(/paid to the account/i);
  });

  /* NEVER promise a niche. Hugo, 07 Aug 2026: "we have to remove the niche
     option from the onboarding because we cannot niche the accounts... the
     niche is just general AI content. Lifestyle and stuff." The old copy told
     visitors "you tell us your niche" and the FAQ said content would be
     "aligned with your niche". Neither is something the product can do, and a
     lead had already been told it by hand before anyone checked. */
  it("never promises the visitor a niche, because we cannot niche accounts", () => {
    for (const step of steps) {
      expect(step.body).not.toMatch(/niche/i);
    }
  });
});
