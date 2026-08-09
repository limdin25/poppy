import { describe, it, expect, vi, beforeEach } from "vitest";

// The publish cron moved from every 15 minutes to every 2 (09 Aug 2026), so a
// new creator's first video goes out while they are still on the page. At 15
// minutes the run could not overlap itself: its own ceiling is 5. At 2 minutes
// it overlaps constantly, and the old code selected every due pending row with
// nothing stopping a second run from working the same one. The gap between the
// SELECT and saveOutstandPostId is a media upload, up to 90 seconds, and two
// runs inside that gap both call Outstand createPost. The creator posts the
// same video twice.

interface Call {
  patch: Record<string, unknown>;
  eq: Array<[string, unknown]>;
  or: string | null;
}
const calls: Call[] = [];
let returnedRows: Array<{ id: string }> = [];

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      return {
        update(patch: Record<string, unknown>) {
          const rec: Call = { patch, eq: [], or: null };
          calls.push(rec);
          const chain = {
            eq(col: string, val: unknown) {
              rec.eq.push([col, val]);
              return chain;
            },
            or(expr: string) {
              rec.or = expr;
              return chain;
            },
            select: () => Promise.resolve({ data: returnedRows, error: null }),
            then: (res: (v: { error: null }) => void) => res({ error: null }),
          };
          return chain;
        },
      };
    },
  }),
}));

import { claimPost, releasePostClaim } from "./posts";

beforeEach(() => {
  calls.length = 0;
  returnedRows = [];
});

describe("claimPost", () => {
  it("only claims a row that is still pending and not already held", () => {
    returnedRows = [{ id: "post-1" }];
    return claimPost("post-1").then((ok) => {
      expect(ok).toBe(true);
      const c = calls[0];
      expect(c.eq).toContainEqual(["id", "post-1"]);
      // Without this, a run would happily re-publish something already live.
      expect(c.eq).toContainEqual(["status", "pending"]);
      // Unclaimed, or claimed so long ago the holder cannot still be alive.
      expect(c.or).toMatch(/^claimed_at\.is\.null,claimed_at\.lt\./);
      expect(typeof c.patch.claimed_at).toBe("string");
    });
  });

  it("returns false when another run got there first", async () => {
    // The loser of the race sees zero rows back: Postgres re-checks the WHERE
    // against the winner's fresh claimed_at after taking the row lock.
    returnedRows = [];
    expect(await claimPost("post-1")).toBe(false);
  });

  it("the stale cutoff outlives a whole publish run", async () => {
    returnedRows = [{ id: "post-1" }];
    await claimPost("post-1");
    const cutoff = new Date(calls[0].or!.split("claimed_at.lt.")[1]).getTime();
    const ageMs = Date.now() - cutoff;
    // maxDuration on the publish route is 300s. A shorter window would let one
    // run steal a post another run is still uploading.
    expect(ageMs).toBeGreaterThan(300_000);
  });
});

describe("releasePostClaim", () => {
  it("hands the row back so the next beat resolves it", async () => {
    // Outstand being slow is not a failure. The row keeps its outstand_post_id
    // and stays pending, so re-entry takes the already-created branch; clearing
    // the claim just means two minutes instead of the full stale window.
    await releasePostClaim("post-1");
    expect(calls[0].patch).toEqual({ claimed_at: null });
    expect(calls[0].eq).toContainEqual(["id", "post-1"]);
  });
});
