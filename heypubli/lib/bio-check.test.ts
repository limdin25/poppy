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

  // Hugo, 08 Aug 2026: "the way the link is now, is not hyperlinked." A URL
  // typed into the Bio box is grey text nobody can tap, so it is not a pass.
  it("REFUSES a tag that is only typed in the bio text", () => {
    expect(
      hasLinkInBio({
        tag: "k7m2p4qa",
        biography: "Meu link: scanplates.com/?sck=K7M2P4QA",
        website: null,
      }),
    ).toBe(false);
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
    expect(ev).toEqual({ link: true, linkInText: false, sentence: true });
    expect(bioVerified(ev)).toBe(true);
  });

  // The whole reason this file exists twice over. 08 Aug 2026: creators were
  // pasting the URL into the Bio box, where Instagram never links it, and we
  // were calling that done.
  it("a link typed in the BIO TEXT is not clickable, so it does not pass", () => {
    const ev = checkBio({
      tag: "27ddbab",
      sentence,
      biography: `${sentence} skool.com/x/about?ref=27ddbab`,
      website: "",
    });
    expect(ev.link).toBe(false);
    expect(ev.linkInText).toBe(true);
    expect(ev.sentence).toBe(true);
    expect(bioVerified(ev)).toBe(false);
  });

  it("the same link in the Links field passes, wherever the bio text is", () => {
    const ev = checkBio({
      tag: "27ddbab",
      sentence,
      biography: sentence,
      website: "skool.com/x/about?ref=27ddbab",
    });
    expect(ev.link).toBe(true);
    expect(ev.linkInText).toBe(false);
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
