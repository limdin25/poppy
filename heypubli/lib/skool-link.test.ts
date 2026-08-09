import { describe, it, expect } from "vitest";
import {
  cleanSkoolAffiliateUrl,
  readSkoolAffiliateUrl,
  skoolLinkCounts,
  skoolReferralCode,
} from "./skool-link";

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

// 09 Aug 2026. Four creators had saved a skool.com link with NO referral code
// in it, and every check we owned called them finished. Shoaib copied the wrong
// button: "share my profile" gives skool.com/@their-name?g=our-community, which
// carries nothing that credits them. He then put that same page in his bio, so
// the bio check matched itself and the roster printed "YES, their link and
// sentence are live". Being a skool.com address was never the test. Carrying
// their code is the test, because the code is the only part that pays them.
describe("skoolReferralCode", () => {
  it("reads the code out of a real invite link", () => {
    expect(
      skoolReferralCode(
        "https://www.skool.com/ai-influencer-flywheel-5612/about?ref=6c1dcd96d6604076a2f5f886191c8cc1",
      ),
    ).toBe("6c1dcd96d6604076a2f5f886191c8cc1");
  });

  it("is null for the Skool profile page, the wrong button (Shoaib, Prem, Shahbaz)", () => {
    expect(
      skoolReferralCode("https://www.skool.com/@shoaib-aftab-3382?g=ai-influencer-flywheel-5612"),
    ).toBeNull();
  });

  it("is null for the bare community page with no code on the end (Jonaid)", () => {
    expect(skoolReferralCode("https://www.skool.com/ai-influencer-flywheel-5612/about")).toBeNull();
  });

  it("accepts the other parameter names Skool has used, and ignores a stub", () => {
    expect(skoolReferralCode("https://skool.com/x?r=abc123")).toBe("abc123");
    expect(skoolReferralCode("https://skool.com/x?ref=ab")).toBeNull();
    expect(skoolReferralCode(null)).toBeNull();
  });
});

describe("readSkoolAffiliateUrl", () => {
  it("passes a real invite link and hands back the code", () => {
    const r = readSkoolAffiliateUrl(
      "  www.skool.com/ai-influencer-flywheel-5612/about?ref=4db81b83ef37414cba8e11e971593406  ",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toBe(
      "https://www.skool.com/ai-influencer-flywheel-5612/about?ref=4db81b83ef37414cba8e11e971593406",
    );
    expect(r.code).toBe("4db81b83ef37414cba8e11e971593406");
  });

  it("tells a profile-page paste apart from a link that is not Skool at all", () => {
    const profile = readSkoolAffiliateUrl(
      "https://www.skool.com/@shoaib-aftab-3382?g=ai-influencer-flywheel-5612",
    );
    expect(profile.ok).toBe(false);
    if (profile.ok) return;
    expect(profile.fault).toBe("no_ref_code");
    // Kept, so the message can show them what they actually sent.
    expect(profile.url).toContain("@shoaib-aftab-3382");

    const elsewhere = readSkoolAffiliateUrl("https://instagram.com/me");
    expect(elsewhere.ok).toBe(false);
    if (elsewhere.ok) return;
    expect(elsewhere.fault).toBe("not_skool");
  });

  it("skoolLinkCounts is the one rule the steps, the roster and the brain share", () => {
    expect(skoolLinkCounts("https://skool.com/x/about?ref=abc123")).toBe(true);
    expect(skoolLinkCounts("https://www.skool.com/@someone?g=community")).toBe(false);
    expect(skoolLinkCounts(null)).toBe(false);
  });
});
