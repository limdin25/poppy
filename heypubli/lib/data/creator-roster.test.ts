import { describe, it, expect } from "vitest";
import {
  verdictFor,
  skoolUrlInProfile,
  syncConnectionHealth,
  VERDICT_LABEL,
  type RosterRow,
} from "./creator-roster";

// Every case below is a REAL profile, read in Hugo's own browser on 08 Aug
// 2026 during the audit that produced this file.
const COMMUNITY = "https://www.skool.com/ai-influencer-flywheel-5612/about";
const sentence = "This is AI, not a camera. See how below.";

describe("what the roster says about a real profile", () => {
  it("verified: their code is CLICKABLE in the Links box and their sentence is in the Bio box", () => {
    const saved = `${COMMUNITY}?ref=abc123def456`;
    const r = verdictFor({
      readable: true,
      savedSkoolUrl: saved,
      sentence,
      biography: sentence,
      website: saved,
    });
    expect(r.verdict).toBe("verified");
  });

  // Hugo, 08 Aug 2026: "the link on bio needs to be under url... the way the
  // link is now, is not hyperlinked." The same link, in the same profile, in
  // the wrong box. It looks done to the creator and earns them nothing.
  it("link_not_clickable: their own link typed into the bio TEXT", () => {
    const saved = `${COMMUNITY}?ref=abc123def456`;
    const r = verdictFor({
      readable: true,
      savedSkoolUrl: saved,
      sentence,
      biography: `${sentence} ${saved}`,
      website: null,
    });
    expect(r.verdict).toBe("link_not_clickable");
    expect(VERDICT_LABEL[r.verdict]).toMatch(/not clickable/);
  });

  it("link_only: the link is live but the sentence was never pasted (ROBERT, Hasty, Marry)", () => {
    const saved = `${COMMUNITY}?ref=d13fe348229c`;
    const r = verdictFor({
      readable: true,
      savedSkoolUrl: saved,
      sentence,
      biography: "Ambitious to clear personally delegated tasks",
      website: saved,
    });
    expect(r.verdict).toBe("link_only");
  });

  // THE ONE A YES/NO COUNT WOULD HAVE HIDDEN. Nzama's bio carries a Skool
  // link with a referral code that is not the one she saved with us, so her
  // page looks finished and every sale it makes credits somebody else.
  it("wrong_code: a Skool link that is not theirs", () => {
    const r = verdictFor({
      readable: true,
      savedSkoolUrl: `${COMMUNITY}?ref=3d5d0ae639c745e9b370756227008c8d`,
      sentence,
      biography: "Build ultra-realistic AI influencers in minutes.",
      website: `${COMMUNITY}?ref=5062958ebb074532b6fa96348b41db21`,
    });
    expect(r.verdict).toBe("wrong_code");
    expect(VERDICT_LABEL[r.verdict]).toMatch(/WRONG CODE/);
  });

  it("missing: we read the profile and there is nothing (Abdul Latif, empty bio)", () => {
    const r = verdictFor({
      readable: true,
      savedSkoolUrl: `${COMMUNITY}?ref=27ddbab`,
      sentence,
      biography: "",
      website: "",
    });
    expect(r.verdict).toBe("missing");
  });

  it("foreign link in the link slot still reads as missing, not verified (Prem, rollercoin)", () => {
    const r = verdictFor({
      readable: true,
      savedSkoolUrl: `${COMMUNITY}?ref=aaa111`,
      sentence,
      biography: "Mine free crypto, just play game and earn free crypto",
      website: "https://rollercoin.com/?r=kkedau8q",
    });
    expect(r.verdict).toBe("missing");
    expect(r.bioSkoolUrl).toBeNull();
  });

  // Edelyn had done it PERFECTLY and every automatic check called her not
  // done, because her Instagram connection had expired. "We cannot check" and
  // "they have not done it" must never render as the same sentence.
  it("unreadable: a broken connection is never reported as not done", () => {
    const r = verdictFor({
      readable: false,
      savedSkoolUrl: `${COMMUNITY}?ref=344bc2d0e1534fcaa6f2acd5b9a932d3`,
      sentence,
      biography: null,
      website: null,
    });
    expect(r.verdict).toBe("unreadable");
    expect(VERDICT_LABEL[r.verdict]).toMatch(/CANNOT CHECK/);
  });

  it("no_link_saved: nothing to look for yet", () => {
    const r = verdictFor({ readable: true, savedSkoolUrl: null, sentence, biography: "hi", website: null });
    expect(r.verdict).toBe("no_link_saved");
  });
});

// A dead Instagram authorisation has to reopen step 1, or the creator sits at
// 5/5 on a connection nothing can post through (Ma. Edelyn, 08 Aug 2026). But
// a revoked API KEY on our side fails every account at once, and disconnecting
// the whole roster over our own outage would be far worse than doing nothing.
describe("disconnecting an Instagram that refused us", () => {
  const row = (name: string, authDead: boolean): RosterRow =>
    ({
      profileId: `id-${name}`,
      name,
      igUsername: name,
      authDead,
      verdict: authDead ? "unreadable" : "verified",
    }) as unknown as RosterRow;

  const fakeAdmin = () => {
    const updates: string[] = [];
    const chain = () => {
      const c: Record<string, unknown> = {};
      for (const k of ["update", "eq"]) c[k] = () => c;
      (c as { then: unknown }).then = (r: (v: { error: null }) => void) => r({ error: null });
      return c;
    };
    return {
      updates,
      admin: {
        from: (t: string) => {
          updates.push(t);
          return chain();
        },
      } as unknown as Parameters<typeof syncConnectionHealth>[0],
    };
  };

  it("disconnects the one account Instagram refused", async () => {
    const { admin } = fakeAdmin();
    const res = await syncConnectionHealth(admin, [
      row("edelyn", true),
      row("a", false),
      row("b", false),
      row("c", false),
      row("d", false),
    ]);
    expect(res.disconnected).toEqual(["edelyn"]);
    expect(res.skippedAsOutage).toBe(0);
  });

  it("disconnects NOBODY when most of the roster failed at once", async () => {
    const { admin } = fakeAdmin();
    const res = await syncConnectionHealth(admin, [
      row("a", true),
      row("b", true),
      row("c", true),
      row("d", false),
    ]);
    expect(res.disconnected).toEqual([]);
    expect(res.skippedAsOutage).toBe(3);
  });
});

describe("finding a Skool link on a profile", () => {
  it("reads it from the website field or out of the bio text", () => {
    expect(skoolUrlInProfile(null, `${COMMUNITY}?ref=x1`)).toContain("ref=x1");
    expect(skoolUrlInProfile(`see www.skool.com/x/about?ref=y2 below`, null)).toContain("ref=y2");
    expect(skoolUrlInProfile("no link here", "https://rollercoin.com/?r=k")).toBeNull();
  });
});
