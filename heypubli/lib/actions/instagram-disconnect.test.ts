import { describe, it, expect, vi, beforeEach } from "vitest";

// "You can disconnect whenever you want from Settings, and nothing goes out
// before you connect." That sentence has been in the onboarding copy the whole
// time. On 07 Aug 2026 a lead asked how to delink and I repeated it to them.
//
// It was not true. Settings rendered a Disconnect button with no onClick at
// all, so it was decoration. The only disconnect that existed was
// disconnectInfluencerInstagram in lib/actions/admin.ts, which a creator cannot
// reach. Hugo: "if you cannot disconnect it from settings then you have to code
// that".
//
// A creator disconnecting must stop posting, which means BOTH connection tables
// have to be cleared: outstand_connections is the live one, instagram_connections
// is the legacy Meta one. Clearing only the table you happen to remember is how
// somebody keeps getting posts after asking us to stop.

const getUser = vi.fn();
const updates: { table: string; patch: Record<string, unknown>; eq: string[] }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: () => getUser() } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          const rec = { table, patch, eq: [] as string[] };
          updates.push(rec);
          const chain = {
            eq(_col: string, val: string) {
              rec.eq.push(val);
              return chain;
            },
            then: (res: (v: { error: null }) => void) => res({ error: null }),
          };
          return chain;
        },
      };
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { disconnectMyInstagram } from "./instagram-disconnect";

beforeEach(() => {
  updates.length = 0;
  getUser.mockReset();
});

describe("disconnectMyInstagram", () => {
  it("clears BOTH connection tables, not just the one you remember", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "prof-1" } } });

    const res = await disconnectMyInstagram();

    expect(res.ok).toBe(true);
    const tables = updates.map((u) => u.table).sort();
    expect(tables).toContain("outstand_connections");
    expect(tables).toContain("instagram_connections");
  });

  it("only ever touches the caller's own rows", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "prof-1" } } });

    await disconnectMyInstagram();

    // Every update must be scoped by the signed-in profile id and nothing else.
    for (const u of updates) {
      expect(u.eq).toContain("prof-1");
    }
  });

  it("marks the rows disconnected rather than deleting the history", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "prof-1" } } });

    await disconnectMyInstagram();

    for (const u of updates) {
      expect(u.patch.is_connected).toBe(false);
    }
  });

  it("refuses when nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await disconnectMyInstagram();

    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
