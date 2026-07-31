import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const createSignedUploadUrl = vi.fn();
const getPublicUrl = vi.fn();

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
    storage: {
      from: () => ({ createSignedUploadUrl, getPublicUrl }),
    },
  }),
}));

import { createMediaUploadUrl } from "./media";

describe("createMediaUploadUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin1" } } });
    createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://x/signed", token: "tok123", path: "ignored" },
      error: null,
    });
    getPublicUrl.mockReturnValue({ data: { publicUrl: "https://x/public/file.jpg" } });
  });

  it("rejects unsupported file types", async () => {
    const r = await createMediaUploadUrl("virus.exe", "application/x-msdownload");
    expect(r).toEqual({ error: expect.stringContaining("não suportado") });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns a signed upload token + public URL for a JPEG", async () => {
    const r = await createMediaUploadUrl("foto da praia.jpg", "image/jpeg");
    expect(r).toEqual({
      path: expect.stringMatching(/^post-media\/.+\.jpg$/),
      token: "tok123",
      publicUrl: "https://x/public/file.jpg",
    });
    // path passed to storage matches what we return
    const calledPath = createSignedUploadUrl.mock.calls[0][0] as string;
    expect(r && "path" in r ? r.path : "").toBe(calledPath);
  });

  it("accepts videos (mp4)", async () => {
    const r = await createMediaUploadUrl("reel.mp4", "video/mp4");
    expect(r && "path" in r ? r.path : "").toMatch(/\.mp4$/);
  });

  it("surfaces storage errors", async () => {
    createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { message: "bucket missing" },
    });
    const r = await createMediaUploadUrl("a.png", "image/png");
    expect(r).toEqual({ error: "bucket missing" });
  });
});
