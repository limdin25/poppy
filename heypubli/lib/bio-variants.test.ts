import { describe, it, expect } from "vitest";
import {
  allBioSentences,
  bioSentence,
  lintBioSentence,
  BIO_VARIANT_CAPACITY,
  HAND_WRITTEN,
  MAX_BIO_SENTENCE,
} from "./bio-variants";

describe("bio variants", () => {
  const all = allBioSentences();

  it("produces 832 sentences", () => {
    expect(BIO_VARIANT_CAPACITY).toBe(832);
    expect(all).toHaveLength(832);
  });

  // The whole point of allocating instead of hashing. If two creators can be
  // handed the same words, the feature has not been built.
  it("every sentence is unique", () => {
    expect(new Set(all).size).toBe(all.length);
  });

  // Asserted across the FULL cross product, not a sample. Combination 512 of
  // 800 is the one nobody reads, and it is the one that runs long or says
  // something odd.
  it("every sentence passes the lint", () => {
    const bad = all.map((s, i) => [i, s, lintBioSentence(s)] as const).filter((r) => r[2]);
    expect(bad).toEqual([]);
  });

  it("every sentence fits an Instagram bio with room to spare", () => {
    const longest = all.reduce((a, b) => (a.length >= b.length ? a : b));
    expect(longest.length).toBeLessThanOrEqual(MAX_BIO_SENTENCE);
  });

  it("hands out the written lines first", () => {
    HAND_WRITTEN.forEach((line, i) => expect(bioSentence(i)).toBe(line));
    expect(bioSentence(HAND_WRITTEN.length)).not.toBe(HAND_WRITTEN[0]);
  });

  it("is stable: the same index always returns the same sentence", () => {
    expect(bioSentence(417)).toBe(bioSentence(417));
  });

  it("never throws on a nonsense index", () => {
    expect(() => bioSentence(-1)).not.toThrow();
    expect(() => bioSentence(99999)).not.toThrow();
    expect(bioSentence(BIO_VARIANT_CAPACITY)).toBe(bioSentence(0));
  });

  it("refuses the punctuation Hugo banned", () => {
    expect(lintBioSentence("AI video here — link below.")).toContain("banned character");
    expect(lintBioSentence("It is AI. Here’s how.")).toContain("banned character");
    expect(lintBioSentence("Learn AI video…")).toContain("banned character");
  });

  it("refuses a money promise but allows the word learn", () => {
    expect(lintBioSentence("Earn from AI video. Link below.")).toContain("banned word");
    expect(lintBioSentence("Learn AI video. Link below.")).toBeNull();
  });
});
