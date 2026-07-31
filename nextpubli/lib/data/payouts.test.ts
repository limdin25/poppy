import { describe, it, expect, vi, beforeEach } from "vitest";

let cfg: Record<string, { data: unknown }> = {};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        is: () => b,
        order: () => b,
        then: (resolve: (v: unknown) => void) => resolve(cfg[table] ?? { data: [] }),
      };
      return b;
    },
  }),
}));

import {
  getPendingPayoutRequests,
  getPayoutSummary,
  getAvailableBalance,
} from "./payouts";

const recent = () => new Date(Date.now() - 5 * 86400000).toISOString(); // held (<21d)
const old = "2024-01-01T00:00:00Z"; // cleared

beforeEach(() => {
  cfg = {};
});

describe("getPendingPayoutRequests", () => {
  const payout = {
    id: "p1",
    profile_id: "u1",
    commission_amount: 10,
    sales_count: 1,
    status: "requested",
    pix_key: "x@y.com",
    pix_key_type: "email",
    requested_at: "2026-06-01T00:00:00Z",
    paid_at: null,
    paid_by: null,
  };

  it("attaches the influencer's name to each request", async () => {
    cfg = {
      payouts: { data: [payout] },
      profiles: { data: [{ id: "u1", first_name: "Ana", last_name: "Silva" }] },
    };
    const r = await getPendingPayoutRequests();
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("p1");
    expect(r[0].name).toBe("Ana Silva");
  });

  it("falls back to '—' when the profile is missing", async () => {
    cfg = {
      payouts: { data: [{ ...payout, profile_id: "ghost" }] },
      profiles: { data: [] },
    };
    expect((await getPendingPayoutRequests())[0].name).toBe("—");
  });
});

describe("getPayoutSummary", () => {
  it("splits cleared (available) from still-held (pending) in one query", async () => {
    cfg = {
      hotmart_sales: {
        data: [
          {
            id: "a",
            commission_amount: 10,
            status: "confirmed",
            payout_id: null,
            purchase_complete_at: null,
            sold_at: old,
          }, // cleared
          {
            id: "b",
            commission_amount: 5,
            status: "confirmed",
            payout_id: null,
            purchase_complete_at: null,
            sold_at: recent(),
          }, // held
        ],
      },
    };
    const r = await getPayoutSummary("u1");
    expect(r.available.amount).toBe(10);
    expect(r.pending).toHaveLength(1);
    expect(r.pending[0].amount).toBe(5);
  });
});

describe("getAvailableBalance", () => {
  it("returns only the cleared total", async () => {
    cfg = {
      hotmart_sales: {
        data: [
          {
            id: "a",
            commission_amount: 10,
            status: "confirmed",
            payout_id: null,
            purchase_complete_at: null,
            sold_at: old,
          },
          {
            id: "b",
            commission_amount: 5,
            status: "confirmed",
            payout_id: null,
            purchase_complete_at: null,
            sold_at: recent(),
          },
        ],
      },
    };
    expect((await getAvailableBalance("u1")).amount).toBe(10);
  });
});
