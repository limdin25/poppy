import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVerifyOtp = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { verifyOtp: mockVerifyOtp },
    from: () => ({
      select: () => ({
        eq: () => ({ single: mockSingle }),
      }),
    }),
  }),
}));

import { GET, POST } from "./route";

function makeGet(query: string): Request {
  return new Request(`http://localhost:3000/auth/confirm${query}`);
}

function makePost(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost:3000/auth/confirm", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

describe("GET /auth/confirm (interstitial — must NOT consume the token)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a confirm button instead of verifying (email scanners only GET)", async () => {
    const res = await GET(makeGet("?token_hash=abc123&type=magiclink"));

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain('method="post"');
    expect(html).toContain('name="token_hash"');
    expect(html).toContain('value="abc123"');
    expect(html).toContain('name="type"');
    expect(html).toContain('value="magiclink"');
    expect(html).toContain("Entrar no NextPubli");
  });

  it("escapes HTML in query params to prevent injection", async () => {
    const res = await GET(makeGet('?token_hash=a"><script>x</script>&type=magiclink'));
    const html = await res.text();
    expect(html).not.toContain("<script>x</script>");
  });

  it("carries a safe relative `next` into the form", async () => {
    const res = await GET(makeGet("?token_hash=abc&type=magiclink&next=/configuracoes"));
    const html = await res.text();
    expect(html).toContain('value="/configuracoes"');
  });

  it("redirects to login with the PT-BR error when token is missing", async () => {
    const res = await GET(makeGet(""));

    expect(res.headers.get("location")).toContain("/login?erro=");
    expect(decodeURIComponent(res.headers.get("location")!)).toContain(
      "Link inválido ou expirado",
    );
  });
});

describe("POST /auth/confirm (actual verification)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { is_admin: false } });
  });

  it("verifies the token and sends influencers to the dashboard", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });

    const res = await POST(makePost({ token_hash: "abc123", type: "magiclink" }));

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "abc123",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("sends admins to /admin", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: "admin1" } },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: { is_admin: true } });

    const res = await POST(makePost({ token_hash: "abc123", type: "magiclink" }));

    expect(res.headers.get("location")).toBe("http://localhost:3000/admin");
  });

  it("honors a safe relative `next` path", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });

    const res = await POST(
      makePost({ token_hash: "abc123", type: "magiclink", next: "/configuracoes" }),
    );

    expect(res.headers.get("location")).toBe("http://localhost:3000/configuracoes");
  });

  it("ignores an absolute/external `next` to prevent open redirects", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });

    const res = await POST(
      makePost({ token_hash: "abc123", type: "magiclink", next: "https://evil.com" }),
    );

    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("redirects to login with the PT-BR error when verification fails", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "expired" },
    });

    const res = await POST(makePost({ token_hash: "stale", type: "magiclink" }));

    expect(decodeURIComponent(res.headers.get("location")!)).toContain(
      "Link inválido ou expirado",
    );
  });

  it("redirects to login when token fields are missing", async () => {
    const res = await POST(makePost({}));

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/login?erro=");
  });
});
