import { describe, expect, it } from "vitest";

import { landingCopy } from "@/features/landing-page/copy";

/* The trading disclosure is a legal requirement, not copy. A UK company must show its
   registered name, company number, place of registration and registered office on its
   website. This footer previously carried a Brazilian address inherited from the site
   this one was cloned from, so it is pinned rather than trusted. */
describe("statutory trading disclosure", () => {
  const address = landingCopy.footer.address;

  it("names the registered company, not just the trading name", () => {
    expect(address).toContain("ULINC UNICO GROUP LTD");
    expect(address).toMatch(/trading as HeyPubli/i);
  });

  it("gives the company number", () => {
    expect(address).toContain("11197856");
  });

  it("gives the place of registration", () => {
    expect(address).toMatch(/registered in England and Wales/i);
  });

  it("gives the registered office", () => {
    expect(address).toContain("483 Green Lanes");
    expect(address).toContain("N13 4BS");
  });

  it("carries no trace of the inherited Brazilian address", () => {
    expect(address).not.toMatch(/Rua Augusta|Ltda|Paulo|01304/i);
  });
});
