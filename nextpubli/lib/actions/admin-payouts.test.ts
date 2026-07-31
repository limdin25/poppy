import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
let adminCfg: Record<string, Record<string, unknown>> = {};
let calls: { table: string; op: string }[] = [];

// requireAdmin() uses the server client: getUser + profiles.is_admin.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: { is_admin: true } }) }),
      }),
    }),
  }),
}));

// The mutations run on the service-role client.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let op = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        update: () => {
          op = "update";
          calls.push({ table, op });
          return b;
        },
        eq: () => b,
        select: () => b,
        then: (resolve: (v: unknown) => void) =>
          resolve(adminCfg[table]?.[op] ?? { data: [] }),
      };
      return b;
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { markPayoutPaid, cancelPayout } from "./admin";

describe("markPayoutPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminCfg = {};
    calls = [];
    getUser.mockResolvedValue({ data: { user: { id: "admin1" } } });
  });

  it("succeeds when a 'requested' payout is updated", async () => {
    adminCfg = { payouts: { update: { data: [{ id: "po1" }] } } };
    expect(await markPayoutPaid("po1")).toEqual({ success: true });
  });

  it("reports 'já processado' when no row matched (already paid/cancelled)", async () => {
    adminCfg = { payouts: { update: { data: [] } } };
    expect(await markPayoutPaid("po1")).toEqual({
      error: expect.stringMatching(/já processado/),
    });
  });
});

describe("cancelPayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminCfg = {};
    calls = [];
    getUser.mockResolvedValue({ data: { user: { id: "admin1" } } });
  });

  it("cancels a 'requested' payout AND releases its sales", async () => {
    adminCfg = { payouts: { update: { data: [{ id: "po1" }] } } };
    expect(await cancelPayout("po1")).toEqual({ success: true });
    // sales were released only after the cancel succeeded
    expect(calls).toContainEqual({ table: "hotmart_sales", op: "update" });
  });

  it("does NOT release sales when the payout wasn't 'requested' (e.g. already paid)", async () => {
    adminCfg = { payouts: { update: { data: [] } } };
    expect(await cancelPayout("po1")).toEqual({
      error: expect.stringMatching(/já processado/),
    });
    // critical: a paid payout's sales must NOT be freed (would enable double-pay)
    expect(calls).not.toContainEqual({ table: "hotmart_sales", op: "update" });
  });
});
