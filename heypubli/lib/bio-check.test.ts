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

// 08 Aug 2026: a creator with a completely EMPTY Instagram self-declared the
// bio step and the machine told him his link was live. checkBio judges what a
// genuinely-read profile really contains, and an empty profile is an answer.
import { checkBio, bioVerified } from "./bio-check";

describe("checkBio", () => {
  const sentence = "Every clip here is AI made. See how below.";

  it("passes only when BOTH the link and the sentence are really there", () => {
    const ev = checkBio({
      tag: "27ddbab",
      sentence,
      biography: "Every clip here is AI made.   See how below.",
      website: "https://skool.com/x/about?ref=27DDBAB",
    });
    expect(ev).toEqual({ link: true, sentence: true });
    expect(bioVerified(ev)).toBe(true);
  });

  it("an empty profile is NOT unknown, it is not-there", () => {
    const ev = checkBio({ tag: "27ddbab", sentence, biography: "", website: "" });
    expect(ev.link).toBe(false);
    expect(ev.sentence).toBe(false);
    expect(bioVerified(ev)).toBe(false);
  });

  it("half-done stays unverified and says which half", () => {
    const ev = checkBio({ tag: "27ddbab", sentence, biography: sentence, website: "" });
    expect(ev.sentence).toBe(true);
    expect(ev.link).toBe(false);
    expect(bioVerified(ev)).toBe(false);
  });

  it("survives Instagram rewrapping and zero-width characters", () => {
    const ev = checkBio({
      tag: null,
      sentence,
      biography: "Every clip here is\nAI made. See how​ below.",
      website: null,
    });
    expect(ev.sentence).toBe(true);
    expect(ev.link).toBeNull();
  });
});
