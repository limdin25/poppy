import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVerifyOtp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSingle = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      signInWithPassword: mockSignInWithPassword,
    },
    from: () => ({
      select: () => ({
        eq: () => ({ single: mockSingle }),
      }),
    }),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));

import { verifyLoginCode, signIn } from "./auth";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("verifyLoginCode (6-digit email code)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { is_admin: false } });
  });

  it("returns a PT-BR error when the code is missing", async () => {
    const result = await verifyLoginCode(form({ email: "a@b.com", code: "" }));
    expect(result?.error).toContain("código");
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("returns a PT-BR error when the email is missing", async () => {
    const result = await verifyLoginCode(form({ email: "", code: "12345678" }));
    expect(result?.error).toBeTruthy();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("verifies the code and redirects influencers to the dashboard", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });

    await expect(
      verifyLoginCode(form({ email: "Ana@Email.com ", code: " 12345678 " })),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "ana@email.com",
      token: "12345678",
      type: "email",
    });
  });

  it("redirects admins to /admin", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: "admin1" } },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: { is_admin: true } });

    await expect(
      verifyLoginCode(form({ email: "hugo@x.com", code: "12345678" })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin");
  });

  it("returns a PT-BR error when the code is wrong or expired", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "Token has expired or is invalid" },
    });

    const result = await verifyLoginCode(form({ email: "a@b.com", code: "000000" }));
    expect(result?.error).toContain("Código inválido ou expirado");
  });
});

describe("signIn (password login)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { is_admin: true } });
  });

  it("returns a PT-BR error on wrong credentials (never raw English)", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });

    const result = await signIn(form({ email: "a@b.com", password: "x" }));
    expect(result?.error).toBe("Email ou senha incorretos.");
  });

  it("redirects admins to /admin on success", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: "admin1" } },
      error: null,
    });

    await expect(
      signIn(form({ email: "hugo@x.com", password: "secret" })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin");
  });
});
