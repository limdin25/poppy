import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsert = vi.fn().mockReturnValue({ error: null });
// Chainable update().eq().neq()... — the route ignores the result, so each guard returns
// the same object (and awaiting it resolves to itself).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updateChain: any = {
  eq: vi.fn(() => updateChain),
  neq: vi.fn(() => updateChain),
};
const mockUpdate = vi.fn(() => updateChain);
const mockRpc = vi.fn();
const mockDupCheck = vi.fn();
const mockMatchSck = vi.fn();
const mockMatchAffiliate = vi.fn();
const mockMatchEmail = vi.fn();
const mockBrandRate = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "hotmart_sales") {
        return {
          insert: mockInsert,
          update: mockUpdate,
          select: () => ({ eq: () => ({ single: mockDupCheck }) }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: (field: string) => {
              if (field === "referral_tag") return { single: mockMatchSck };
              if (field === "hotmart_affiliate_code")
                return { single: mockMatchAffiliate };
              return { eq: () => ({ single: mockMatchEmail }) };
            },
          }),
        };
      }
      if (table === "brands") {
        return { select: () => ({ eq: () => ({ single: mockBrandRate }) }) };
      }
      return {};
    },
    rpc: mockRpc,
  }),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/webhooks/hotmart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Hotmart webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDupCheck.mockResolvedValue({ data: null });
    mockMatchSck.mockResolvedValue({ data: null });
    mockMatchAffiliate.mockResolvedValue({ data: null });
    mockMatchEmail.mockResolvedValue({ data: null });
    mockBrandRate.mockResolvedValue({ data: { commission_rate: 0.2 } });
    mockRpc.mockResolvedValue({ data: "released" });
    delete process.env.HOTMART_HOTTOK;
  });

  it("rejects invalid hottok when configured", async () => {
    process.env.HOTMART_HOTTOK = "correct-token";
    const res = await POST(
      makeRequest({ hottok: "wrong", event: "PURCHASE_APPROVED", data: {} }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts valid hottok", async () => {
    process.env.HOTMART_HOTTOK = "correct-token";
    const res = await POST(
      makeRequest({ hottok: "correct-token", event: "UNKNOWN_EVENT", data: {} }),
    );
    expect(res.status).toBe(200);
  });

  it("returns 400 when event is missing", async () => {
    const res = await POST(makeRequest({ data: {} }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when data is missing", async () => {
    const res = await POST(makeRequest({ event: "PURCHASE_APPROVED" }));
    expect(res.status).toBe(400);
  });

  it("matches by sck → referral_tag and computes 20% commission", async () => {
    mockMatchSck.mockResolvedValue({ data: { id: "profile-sck" } });

    const res = await POST(
      makeRequest({
        event: "PURCHASE_APPROVED",
        data: {
          purchase: {
            transaction: "TX-SCK",
            approved_date: 1700000000000,
            price: { value: 100 },
            tracking: { source: "ana4k2p9" },
          },
          product: { id: 999, name: "ScanPlates" },
          buyer: { email: "buyer@test.com" },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockMatchSck).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: "profile-sck",
        transaction_id: "TX-SCK",
        sale_amount: 100,
        commission_amount: 20,
        status: "confirmed",
      }),
    );
  });

  it("uses the influencer's own commission rate when set", async () => {
    mockMatchSck.mockResolvedValue({ data: { id: "profile-vip", commission_rate: 0.3 } });

    const res = await POST(
      makeRequest({
        event: "PURCHASE_APPROVED",
        data: {
          purchase: {
            transaction: "TX-VIP",
            price: { value: 100 },
            tracking: { source: "vip12345" },
          },
          product: { id: 999, name: "ScanPlates" },
          buyer: { email: "b@test.com" },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: "profile-vip",
        commission_amount: 30, // 100 × 0.30 (per-influencer rate), not brand 0.20
      }),
    );
  });

  it("falls back to affiliate_code and still computes our commission", async () => {
    mockMatchAffiliate.mockResolvedValue({ data: { id: "profile-123" } });

    const res = await POST(
      makeRequest({
        event: "PURCHASE_APPROVED",
        data: {
          purchase: { transaction: "TX-AFF", price: { value: 59.99 } },
          product: { id: 999, name: "ScanPlates Pro" },
          buyer: { email: "joao@test.com" },
          affiliates: [{ affiliate_code: "AFF-001" }],
          commissions: [{ value: 17.99, source: "AFFILIATE" }],
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: "profile-123",
        commission_amount: 12, // 59.99 × 0.20, NOT Hotmart's 17.99
      }),
    );
  });

  it("skips duplicate transactions", async () => {
    mockDupCheck.mockResolvedValue({ data: { id: "existing-sale" } });

    const res = await POST(
      makeRequest({
        event: "PURCHASE_APPROVED",
        data: {
          purchase: { transaction: "TX-DUPE", price: { value: 10 } },
          product: { name: "Test" },
          buyer: { email: "test@test.com" },
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("stamps purchase_complete_at on PURCHASE_COMPLETE for an existing sale", async () => {
    mockDupCheck.mockResolvedValue({ data: { id: "existing-sale" } });

    const res = await POST(
      makeRequest({
        event: "PURCHASE_COMPLETE",
        data: { purchase: { transaction: "TX-DONE" } },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ purchase_complete_at: expect.any(String) }),
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("flips status idempotently and delegates the payout release to the atomic RPC", async () => {
    const res = await POST(
      makeRequest({
        event: "PURCHASE_REFUNDED",
        data: { purchase: { transaction: "TX-002" } },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({ status: "refunded" });
    // .neq("status","refunded") is the idempotency guard — a replayed delivery is a no-op
    expect(updateChain.neq).toHaveBeenCalledWith("status", "refunded");
    // the unpaid-request release + decrement runs as ONE row-locked DB function, not an
    // in-app read-then-write, so it can't race a mark-paid or a duplicate refund
    expect(mockRpc).toHaveBeenCalledWith("release_refunded_sale", {
      p_transaction_id: "TX-002",
    });
  });

  it("logs a manual clawback when the RPC reports the payout was already PAID", async () => {
    mockRpc.mockResolvedValue({ data: "clawback_needed" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(
      makeRequest({
        event: "PURCHASE_REFUNDED",
        data: { purchase: { transaction: "TX-PAID" } },
      }),
    );

    expect(res.status).toBe(200);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("clawback"),
      expect.objectContaining({ transactionId: "TX-PAID" }),
    );
    logSpy.mockRestore();
  });

  it("does NOT log a clawback when the RPC reports a clean release/noop", async () => {
    mockRpc.mockResolvedValue({ data: "released" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await POST(
      makeRequest({
        event: "PURCHASE_REFUNDED",
        data: { purchase: { transaction: "TX-CLEAN" } },
      }),
    );

    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("clawback"),
      expect.anything(),
    );
    logSpy.mockRestore();
  });

  it("also releases the sale via the RPC on PURCHASE_CHARGEBACK (cancelled)", async () => {
    const res = await POST(
      makeRequest({
        event: "PURCHASE_CHARGEBACK",
        data: { purchase: { transaction: "TX-003" } },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({ status: "cancelled" });
    expect(updateChain.neq).toHaveBeenCalledWith("status", "cancelled");
    expect(mockRpc).toHaveBeenCalledWith("release_refunded_sale", {
      p_transaction_id: "TX-003",
    });
  });

  it("handles unknown events gracefully", async () => {
    const res = await POST(
      makeRequest({ event: "SUBSCRIPTION_CANCELED", data: { some: "payload" } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(true);
  });
});
