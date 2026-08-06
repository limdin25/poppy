import { describe, it, expect, vi, beforeEach } from "vitest";

// Focused tests for the account branches of the Unipile webhook:
// hosted-auth notify (Branch 1) and account_status events (Branch 2).

const ops: { table: string; op: string; payload?: unknown }[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cfg: Record<string, any> = {};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        update: (payload: unknown) => {
          ops.push({ table, op: "update", payload });
          return b;
        },
        insert: (payload: unknown) => {
          ops.push({ table, op: "insert", payload });
          return b;
        },
        eq: () => b,
        is: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () => Promise.resolve({ data: cfg[table]?.maybeSingle ?? null }),
        single: () => Promise.resolve({ data: cfg[table]?.single ?? null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: cfg[table]?.list ?? [], error: null }),
      };
      return b;
    },
  }),
}));

const fetchAccount = vi.fn();
vi.mock("@/lib/integrations/unipile", () => ({
  fetchAccount: (...a: unknown[]) => fetchAccount(...a),
  toE164: (p: string) => (p ? `+${p.replace(/\D/g, "")}` : ""),
}));

vi.mock("@/lib/integrations/storage", () => ({
  downloadAndStoreAttachment: vi.fn(),
  detectContentType: vi.fn(),
}));

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/unipile", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

beforeEach(() => {
  ops.length = 0;
  cfg = {};
  fetchAccount.mockReset();
  vi.unstubAllEnvs();
});

describe("Branch 1 — hosted-auth notify", () => {
  it("binds the pending channel when the account REALLY exists at Unipile", async () => {
    vi.stubEnv("UNIPILE_WEBHOOK_SECRET", "");
    fetchAccount.mockResolvedValue({
      phone: "351964888769",
      type: "WHATSAPP",
      status: "OK",
    });
    cfg.channels = { maybeSingle: null };
    const { POST } = await loadRoute();

    cfg.channels = { maybeSingle: { id: "ch-1" } };
    await POST(post({ status: "CREATION_SUCCESS", account_id: "acc-9", name: "x" }));

    const update = ops.find((o) => o.table === "channels" && o.op === "update");
    expect(update?.payload).toMatchObject({ status: "connected" });
  });

  it("does NOT mark anything connected when the account is missing at Unipile", async () => {
    vi.stubEnv("UNIPILE_WEBHOOK_SECRET", "");
    fetchAccount.mockResolvedValue(null); // ghost account
    cfg.channels = { maybeSingle: { id: "pending-1" } }; // a pending row exists
    const { POST } = await loadRoute();

    await POST(post({ status: "CREATION_SUCCESS", account_id: "ghost-1", name: "x" }));

    expect(ops.filter((o) => o.table === "channels" && o.op === "update")).toHaveLength(
      0,
    );
  });
});

describe("Branch 2 — account_status events (real Unipile shape)", () => {
  it("marks the channel disconnected on AccountStatus CREDENTIALS", async () => {
    vi.stubEnv("UNIPILE_WEBHOOK_SECRET", "s3cret");
    const { POST } = await loadRoute();

    await POST(
      post(
        {
          AccountStatus: {
            account_id: "acc-1",
            account_type: "WHATSAPP",
            message: "CREDENTIALS",
          },
        },
        { "unipile-auth": "s3cret" },
      ),
    );

    const update = ops.find((o) => o.table === "channels" && o.op === "update");
    expect(update?.payload).toMatchObject({ status: "disconnected" });
  });

  it("marks the channel connected on AccountStatus RECONNECTED", async () => {
    vi.stubEnv("UNIPILE_WEBHOOK_SECRET", "s3cret");
    const { POST } = await loadRoute();

    await POST(
      post(
        {
          AccountStatus: {
            account_id: "acc-1",
            account_type: "WHATSAPP",
            message: "RECONNECTED",
          },
        },
        { "unipile-auth": "s3cret" },
      ),
    );

    const update = ops.find((o) => o.table === "channels" && o.op === "update");
    expect(update?.payload).toMatchObject({ status: "connected" });
  });

  it("rejects an AccountStatus event with a wrong auth header (no DB write)", async () => {
    vi.stubEnv("UNIPILE_WEBHOOK_SECRET", "s3cret");
    const { POST } = await loadRoute();

    await POST(
      post(
        { AccountStatus: { account_id: "acc-1", message: "CREDENTIALS" } },
        { "unipile-auth": "wrong" },
      ),
    );

    expect(ops).toHaveLength(0);
  });
});
