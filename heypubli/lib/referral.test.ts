import { describe, it, expect } from "vitest";
import {
  generateReferralTag,
  isValidReferralTag,
  buildReferralLink,
  REFERRAL_TAG_ALPHABET,
} from "./referral";

describe("generateReferralTag", () => {
  it("returns an 8-char tag by default", () => {
    expect(generateReferralTag()).toHaveLength(8);
  });

  it("only uses the unambiguous alphabet (no 0/1/i/l/o)", () => {
    const allowed = new Set(REFERRAL_TAG_ALPHABET.split(""));
    for (let i = 0; i < 200; i++) {
      for (const ch of generateReferralTag()) expect(allowed.has(ch)).toBe(true);
    }
    // the ambiguous characters must never appear in the alphabet
    for (const bad of ["0", "1", "i", "l", "o"]) {
      expect(REFERRAL_TAG_ALPHABET.includes(bad)).toBe(false);
    }
  });

  it("is deterministic given an injected RNG", () => {
    const tag = generateReferralTag(() => 0);
    expect(tag).toBe(REFERRAL_TAG_ALPHABET[0].repeat(8));
  });

  it("honours a custom length", () => {
    expect(generateReferralTag(Math.random, 12)).toHaveLength(12);
  });
});

describe("isValidReferralTag", () => {
  it("accepts a freshly generated tag", () => {
    expect(isValidReferralTag(generateReferralTag())).toBe(true);
  });

  it("accepts readable lowercase/number/hyphen custom tags", () => {
    expect(isValidReferralTag("ana-silva")).toBe(true);
    expect(isValidReferralTag("promo2026")).toBe(true);
  });

  it("rejects junk and unsafe input", () => {
    expect(isValidReferralTag("")).toBe(false);
    expect(isValidReferralTag("ab")).toBe(false); // too short
    expect(isValidReferralTag("HELLO")).toBe(false); // uppercase
    expect(isValidReferralTag("a b")).toBe(false); // space
    expect(isValidReferralTag("a/b")).toBe(false); // slash
    expect(isValidReferralTag("x".repeat(40))).toBe(false); // too long
  });
});

describe("buildReferralLink", () => {
  it("appends sck to a clean base URL", () => {
    expect(buildReferralLink("https://www.scanplates.com/", "abc12345")).toBe(
      "https://www.scanplates.com/?sck=abc12345",
    );
  });

  it("preserves existing query params", () => {
    expect(
      buildReferralLink("https://www.scanplates.com/?utm_source=ig", "abc12345"),
    ).toBe("https://www.scanplates.com/?utm_source=ig&sck=abc12345");
  });

  it("overwrites a pre-existing sck", () => {
    expect(buildReferralLink("https://www.scanplates.com/?sck=old", "new12345")).toBe(
      "https://www.scanplates.com/?sck=new12345",
    );
  });
});
