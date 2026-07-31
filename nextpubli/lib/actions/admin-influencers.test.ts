import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const createUser = vi.fn();
const profileUpdateEq = vi.fn();
const profileUpdate = vi.fn(() => ({ eq: profileUpdateEq }));

// requireAdmin() — server client: getUser + profiles.is_admin.
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser } },
    from: () => ({ update: profileUpdate }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createInfluencer, setInfluencerSuspended } from "./admin";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const k of Object.keys(obj)) f.set(k, obj[k]);
  return f;
}

describe("createInfluencer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin1" } } });
  });

  it("rejects a missing name or an invalid email (no user created)", async () => {
    expect(await createInfluencer(fd({ first_name: "", email: "x@y.com" }))).toEqual({
      error: expect.any(String),
    });
    expect(
      await createInfluencer(fd({ first_name: "Ana", email: "notanemail" })),
    ).toEqual({
      error: expect.any(String),
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates an auth user flagged admin_manual and returns success", async () => {
    createUser.mockResolvedValue({ data: { user: { id: "new1" } }, error: null });
    const r = await createInfluencer(
      fd({ first_name: "Ana", last_name: "Silva", email: "Ana@X.com" }),
    );
    expect(r).toEqual({ success: true });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ana@x.com", // normalized lowercase
        email_confirm: true,
        user_metadata: expect.objectContaining({
          first_name: "Ana",
          registration_method: "admin_manual",
        }),
      }),
    );
  });

  it("attaches the WhatsApp to the new profile when provided", async () => {
    createUser.mockResolvedValue({ data: { user: { id: "new1" } }, error: null });
    await createInfluencer(
      fd({ first_name: "Ana", email: "ana@x.com", whatsapp: "11999998888" }),
    );
    expect(profileUpdate).toHaveBeenCalledWith({ whatsapp: "11999998888" });
  });

  it("surfaces a createUser error (e.g. duplicate email)", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });
    expect(
      await createInfluencer(fd({ first_name: "Ana", email: "dupe@x.com" })),
    ).toEqual({
      error: "User already registered",
    });
  });
});

describe("setInfluencerSuspended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin1" } } });
    profileUpdateEq.mockResolvedValue({ error: null });
  });

  it("suspends: stamps suspended_at with a timestamp", async () => {
    const r = await setInfluencerSuspended("inf-1", true);
    expect(r).toEqual({ success: true });
    expect(profileUpdate).toHaveBeenCalledWith({ suspended_at: expect.any(String) });
    expect(profileUpdateEq).toHaveBeenCalledWith("id", "inf-1");
  });

  it("reactivates: clears suspended_at back to null", async () => {
    const r = await setInfluencerSuspended("inf-1", false);
    expect(r).toEqual({ success: true });
    expect(profileUpdate).toHaveBeenCalledWith({ suspended_at: null });
  });

  it("surfaces a database error in PT-BR shape", async () => {
    profileUpdateEq.mockResolvedValue({ error: { message: "boom" } });
    const r = await setInfluencerSuspended("inf-1", true);
    expect(r).toEqual({ error: "boom" });
  });
});
