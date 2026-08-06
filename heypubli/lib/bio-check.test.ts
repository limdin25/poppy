import { describe, it, expect } from "vitest";
import { hasLinkInBio } from "./bio-check";

describe("hasLinkInBio", () => {
  it("finds the tag in the clickable website field", () => {
    expect(
      hasLinkInBio({
        tag: "k7m2p4qa",
        biography: "Co-founder de algo",
        website: "https://www.scanplates.com/?sck=k7m2p4qa",
      }),
    ).toBe(true);
  });

  it("finds the tag pasted in the bio text", () => {
    expect(
      hasLinkInBio({
        tag: "k7m2p4qa",
        biography: "Meu link: scanplates.com/?sck=K7M2P4QA",
        website: null,
      }),
    ).toBe(true);
  });

  it("misses when neither bio nor website carries the tag", () => {
    expect(
      hasLinkInBio({
        tag: "k7m2p4qa",
        biography: "Playing Real Life Monopoly",
        website: "http://outrosite.com",
      }),
    ).toBe(false);
  });

  it("cannot confirm without a tag (returns null = unknown)", () => {
    expect(hasLinkInBio({ tag: null, biography: "oi", website: null })).toBeNull();
    expect(hasLinkInBio({ tag: "", biography: "oi", website: null })).toBeNull();
  });

  it("cannot confirm without any bio data (returns null = unknown)", () => {
    expect(hasLinkInBio({ tag: "k7m2p4qa", biography: null, website: null })).toBeNull();
  });
});
