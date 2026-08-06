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

  /* The niche is asked during onboarding, which runs AFTER Instagram is connected.
     Promising it in step 01 described a flow the product does not have. */
  it("asks for the niche no earlier than the step that actually collects it", () => {
    expect(steps[0].body).not.toMatch(/niche/i);
    expect(steps[1].body).not.toMatch(/niche/i);
    expect(steps[2].body).toMatch(/niche/i);
  });
});
