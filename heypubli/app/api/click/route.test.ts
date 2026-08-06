import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveTag = vi.fn();
const logClick = vi.fn();

vi.mock("@/lib/data/clicks", () => ({
  resolveTag: (tag: string) => resolveTag(tag),
  logClick: (input: unknown) => logClick(input),
}));

import { GET, POST } from "./route";

function get(url: string, ua = "Mozilla/5.0"): Request {
  return new Request(url, { method: "GET", headers: { "user-agent": ua } });
}

describe("/api/click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTag.mockResolvedValue({ profileId: "profile-1", brandId: "brand-1" });
  });

  it("logs a click for a valid tag and returns a pixel", async () => {
    const res = await GET(get("http://localhost/api/click?sck=abc12345"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/gif");
    expect(resolveTag).toHaveBeenCalledWith("abc12345");
    expect(logClick).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile-1",
        referralTag: "abc12345",
        isBot: false,
      }),
    );
  });

  it("flags bot user-agents", async () => {
    await GET(get("http://localhost/api/click?sck=abc12345", "WhatsApp/2.0"));
    expect(logClick).toHaveBeenCalledWith(expect.objectContaining({ isBot: true }));
  });

  it("ignores an invalid tag without hitting the DB", async () => {
    const res = await GET(get("http://localhost/api/click?sck=a b/c"));
    expect(res.status).toBe(200);
    expect(resolveTag).not.toHaveBeenCalled();
    expect(logClick).not.toHaveBeenCalled();
  });

  it("does nothing when the tag is unknown", async () => {
    resolveTag.mockResolvedValue(null);
    await GET(get("http://localhost/api/click?sck=missing99"));
    expect(resolveTag).toHaveBeenCalled();
    expect(logClick).not.toHaveBeenCalled();
  });

  it("accepts a POST beacon with a JSON body and returns 204", async () => {
    const res = await POST(
      new Request("http://localhost/api/click", {
        method: "POST",
        headers: { "user-agent": "Mozilla/5.0" },
        body: JSON.stringify({ sck: "abc12345" }),
      }),
    );
    expect(res.status).toBe(204);
    expect(logClick).toHaveBeenCalledWith(
      expect.objectContaining({ referralTag: "abc12345" }),
    );
  });
});
