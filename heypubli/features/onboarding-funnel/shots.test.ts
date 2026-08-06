import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SHOTS } from "./shots";

// The manifest and the public folder must never drift: a src that points at a
// missing file would render a broken image on the one page a brand-new creator
// has to trust.
describe("funnel shots", () => {
  it("every declared src exists under public/", () => {
    for (const shot of Object.values(SHOTS)) {
      if (!shot.src) continue;
      const file = join(process.cwd(), "public", shot.src);
      expect(existsSync(file), `${shot.id}: ${shot.src} missing from public/`).toBe(true);
    }
  });

  it("every shot teaches the step in words even without its picture", () => {
    for (const shot of Object.values(SHOTS)) {
      expect(shot.fallback.length, `${shot.id} fallback too short`).toBeGreaterThan(30);
      expect(shot.caption.length, `${shot.id} caption missing`).toBeGreaterThan(10);
    }
  });

  it("uses no banned punctuation anywhere", () => {
    const all = JSON.stringify(SHOTS);
    for (const code of [0x2014, 0x2013, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026]) {
      expect(all).not.toContain(String.fromCharCode(code));
    }
  });
});
