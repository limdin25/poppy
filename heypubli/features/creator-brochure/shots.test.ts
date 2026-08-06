import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SHOTS, type Shot } from "./shots";

describe("brochure shots", () => {
  // Widened on purpose: `satisfies` keeps every src at the literal type `null`
  // while they are all unset, and this test exists for the day they are not.
  const shots: Shot[] = Object.values(SHOTS);

  // The manifest and the public folder cannot be allowed to drift. A src
  // pointing at a file that is not there renders a broken-image icon in the
  // middle of a step, which is worse than the words-only plate it replaced.
  it("every declared picture actually exists", () => {
    const missing = shots
      .filter((s) => s.src)
      .filter((s) => !existsSync(join(process.cwd(), "public", s.src ?? "")))
      .map((s) => s.id);
    expect(missing).toEqual([]);
  });

  // The page ships today with no pictures at all, so the words have to carry
  // the whole method on their own.
  it("every shot teaches its step without the picture", () => {
    for (const shot of shots) {
      expect(shot.fallback.length).toBeGreaterThan(40);
      expect(shot.caption.length).toBeGreaterThan(10);
      expect(shot.alt.length).toBeGreaterThan(10);
    }
  });

  it("uses no punctuation Hugo banned", () => {
    const banned = ["—", "–", "‘", "’", "“", "”", "…"];
    for (const shot of shots) {
      const text = `${shot.alt} ${shot.caption} ${shot.fallback}`;
      for (const ch of banned) expect(text).not.toContain(ch);
    }
  });
});
