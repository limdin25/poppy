import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
// Per-table, per-operation results — set per test. The mock routes by the first
// mutating op (select/insert/update/delete) on each from() call.
let cfg: Record<string, Record<string, unknown>> = {};
let calls: { table: string; op: string; arg?: unknown }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let op = "";
      const mark = (o: string, arg?: unknown) => {
        op = o;
        calls.push({ table, op, arg });
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => {
          if (!op) mark("select");
          return b;
        },
        insert: (a: unknown) => {
          mark("insert", a);
          return b;
        },
        update: (a: unknown) => {
          mark("update", a);
          return b;
        },
        delete: () => {
          mark("delete");
          return b;
        },
        eq: () => b,
        is: () => b,
        in: () => b,
        single: () => Promise.resolve(cfg[table]?.[op] ?? { data: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve(cfg[table]?.[op] ?? { data: null }),
      };
      return b;
    },
  }),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requestPayout } from "./payouts";

// A sale old enough to be cleared (>21 days).
const clearedSale = {
  id: "s1",
  commission_amount: 12,
  status: "confirmed",
  payout_id: null,
  purchase_complete_at: null,
  sold_at: "2026-01-01T00:00:00Z",
};

describe("requestPayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cfg = {};
    calls = [];
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("refuses when the influencer has no PIX key", async () => {
    cfg = { profiles: { select: { data: { pix_key: null, pix_key_type: null } } } };
    expect(await requestPayout()).toEqual({ error: expect.stringMatching(/PIX/) });
  });

  it("refuses when there is no cleared balance", async () => {
    cfg = {
      profiles: { select: { data: { pix_key: "a@b.com", pix_key_type: "email" } } },
      hotmart_sales: { select: { data: [] } },
    };
    expect(await requestPayout()).toEqual({
      error: expect.stringMatching(/Nenhum valor/),
    });
  });

  it("creates a payout from the sales actually claimed (recomputes the total)", async () => {
    cfg = {
      profiles: { select: { data: { pix_key: "a@b.com", pix_key_type: "email" } } },
      hotmart_sales: {
        select: { data: [clearedSale] },
        update: { data: [{ commission_amount: 12 }] }, // claimed rows
      },
      payouts: { insert: { data: { id: "po1" }, error: null }, update: {} },
    };
    const r = await requestPayout();
    expect(r).toEqual({ success: true, amount: 12 });
    // total is set from the CLAIMED rows, not the pre-read estimate
    expect(calls).toContainEqual({
      table: "payouts",
      op: "update",
      arg: { commission_amount: 12, sales_count: 1 },
    });
  });

  it("rolls back (deletes the payout) when it loses the race and claims nothing", async () => {
    cfg = {
      profiles: { select: { data: { pix_key: "a@b.com", pix_key_type: "email" } } },
      hotmart_sales: {
        select: { data: [clearedSale] },
        update: { data: [] }, // another request already claimed them
      },
      payouts: { insert: { data: { id: "po1" }, error: null }, delete: {} },
    };
    const r = await requestPayout();
    expect(r).toEqual({ error: expect.stringMatching(/já tem uma solicitação/) });
    expect(calls).toContainEqual({ table: "payouts", op: "delete" });
  });
});
