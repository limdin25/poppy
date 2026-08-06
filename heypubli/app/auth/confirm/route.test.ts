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
    expect(html).toContain("Sign in to HeyPubli");
  });

  it("escapes HTML in query params to prevent injection", async () => {
    const res = await GET(makeGet('?token_hash=a"><script>x</script>&type=magiclink'));
    const html = await res.text();
    expect(html).not.toContain("<script>x</script>");
  });

  it("carries a safe relative `next` into the form", async () => {
    const res = await GET(makeGet("?token_hash=abc&type=magiclink&next=/settings"));
    const html = await res.text();
    expect(html).toContain('value="/settings"');
  });

  it("redirects to login with the error when token is missing", async () => {
    const res = await GET(makeGet(""));

    expect(res.headers.get("location")).toContain("/login?erro=");
    expect(decodeURIComponent(res.headers.get("location")!)).toContain(
      "Invalid or expired link",
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

  // Hugo, 2026-08-04: "when I enter with hugodesouzax@gmail.com it takes me to
  // admin directly, but I want to be like a normal user with the option to
  // admin inside." An admin reaches /admin from the sidebar item, which the
  // creator layout renders when profiles.is_admin.
  it("sends admins to the creator dashboard too, not straight to /admin", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: "admin1" } },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: { is_admin: true } });

    const res = await POST(makePost({ token_hash: "abc123", type: "magiclink" }));

    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("honors a safe relative `next` path", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });

    const res = await POST(
      makePost({ token_hash: "abc123", type: "magiclink", next: "/settings" }),
    );

    expect(res.headers.get("location")).toBe("http://localhost:3000/settings");
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

  it("redirects to login with the error when verification fails", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "expired" },
    });

    const res = await POST(makePost({ token_hash: "stale", type: "magiclink" }));

    expect(decodeURIComponent(res.headers.get("location")!)).toContain(
      "Invalid or expired link",
    );
  });

  it("redirects to login when token fields are missing", async () => {
    const res = await POST(makePost({}));

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/login?erro=");
  });
});
