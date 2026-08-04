import { describe, it, expect } from "vitest";
import { cleanSkoolAffiliateUrl } from "./skool-link";

// The link is pasted by hand from Skool, on a phone, usually with a trailing
// space and sometimes with the whole "https://" missing. It also has to be a
// Skool URL: this field is going to be read back as the thing that credits a
// creator for a sale, so a link to anywhere else is a mistake worth refusing
// while they are still looking at the form.
describe("cleanSkoolAffiliateUrl", () => {
  it("keeps a normal Skool link", () => {
    expect(
      cleanSkoolAffiliateUrl(
        "https://www.skool.com/ai-influencer-flywheel-5612/?ref=abc123",
      ),
    ).toBe("https://www.skool.com/ai-influencer-flywheel-5612/?ref=abc123");
  });

  it("trims whitespace from a paste", () => {
    expect(cleanSkoolAffiliateUrl("  https://skool.com/x?ref=a  ")).toBe(
      "https://skool.com/x?ref=a",
    );
  });

  it("adds the scheme when they pasted the bare domain", () => {
    expect(cleanSkoolAffiliateUrl("www.skool.com/x?ref=a")).toBe(
      "https://www.skool.com/x?ref=a",
    );
  });

  it("refuses a link that is not Skool", () => {
    expect(cleanSkoolAffiliateUrl("https://instagram.com/me")).toBeNull();
    // Nor a lookalike host that merely ends in the right letters.
    expect(cleanSkoolAffiliateUrl("https://notskool.com/x")).toBeNull();
    expect(cleanSkoolAffiliateUrl("https://skool.com.evil.test/x")).toBeNull();
  });

  it("refuses junk and empty input", () => {
    expect(cleanSkoolAffiliateUrl("")).toBeNull();
    expect(cleanSkoolAffiliateUrl("   ")).toBeNull();
    expect(cleanSkoolAffiliateUrl("not a url")).toBeNull();
  });

  it("upgrades http to https rather than refusing it", () => {
    expect(cleanSkoolAffiliateUrl("http://www.skool.com/x")).toBe(
      "https://www.skool.com/x",
    );
  });

  it("refuses any other scheme, javascript: above all", () => {
    expect(cleanSkoolAffiliateUrl("javascript:alert(1)")).toBeNull();
    expect(cleanSkoolAffiliateUrl("data:text/html,x")).toBeNull();
  });
});
