import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerSocialNetwork,
  getAuthUrl,
  listSocialAccounts,
  getUploadUrl,
  confirmUpload,
  createPost,
  getPostStatus,
  getPendingConnection,
  finalizeConnection,
  getSocialAccountByTenant,
} from "./outstand";

const API_KEY = "sk_test_abc123";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

describe("registerSocialNetwork", () => {
  it("sends POST with network credentials and returns data", async () => {
    const spy = mockFetch({
      success: true,
      data: { id: "net_123", network: "instagram", createdAt: "2026-01-01" },
    });

    const result = await registerSocialNetwork(API_KEY, "my_app_id", "my_app_secret");

    expect(spy).toHaveBeenCalledWith(
      "https://api.outstand.so/v1/social-networks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk_test_abc123",
        }),
      }),
    );
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.network).toBe("instagram");
    expect(body.client_key).toBe("my_app_id");
    expect(body.client_secret).toBe("my_app_secret");
    expect(result.id).toBe("net_123");
  });

  it("throws on API error", async () => {
    mockFetch({ success: false, error: "Invalid credentials" }, false, 400);
    await expect(registerSocialNetwork(API_KEY, "x", "y")).rejects.toThrow();
  });
});

describe("getAuthUrl", () => {
  it("sends POST and returns auth_url", async () => {
    const spy = mockFetch({
      success: true,
      data: { auth_url: "https://outstand.so/app/api/socials/instagram/org123" },
    });

    const result = await getAuthUrl(
      API_KEY,
      "net_123",
      "https://nextpubli.com/auth/outstand/callback",
    );

    expect(spy).toHaveBeenCalledWith(
      "https://api.outstand.so/v1/social-networks/instagram/auth-url",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.redirect_uri).toBe("https://nextpubli.com/auth/outstand/callback");
    expect(result).toBe("https://outstand.so/app/api/socials/instagram/org123");
  });
});

describe("listSocialAccounts", () => {
  it("fetches accounts filtered by instagram", async () => {
    const spy = mockFetch({
      success: true,
      data: [{ id: "acc_1", network: "instagram", username: "user1", isActive: true }],
      count: 1,
    });

    const result = await listSocialAccounts(API_KEY);

    expect(spy).toHaveBeenCalledWith(
      "https://api.outstand.so/v1/social-accounts?network=instagram",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("acc_1");
  });
});

describe("getUploadUrl", () => {
  it("requests presigned upload URL", async () => {
    const spy = mockFetch({
      success: true,
      data: {
        id: "media_1",
        upload_url: "https://s3.example.com/presigned",
        expires_in: 3600,
      },
    });

    const result = await getUploadUrl(API_KEY, "photo.jpg", "image/jpeg");

    expect(spy).toHaveBeenCalledWith(
      "https://api.outstand.so/v1/media/upload",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.filename).toBe("photo.jpg");
    expect(body.content_type).toBe("image/jpeg");
    expect(result.id).toBe("media_1");
    expect(result.upload_url).toBe("https://s3.example.com/presigned");
  });
});

describe("confirmUpload", () => {
  it("confirms media upload", async () => {
    const spy = mockFetch({
      success: true,
      data: {
        id: "media_1",
        filename: "photo.jpg",
        url: "https://cdn.example.com/photo.jpg",
        status: "active",
      },
    });

    const result = await confirmUpload(API_KEY, "media_1");

    expect(spy).toHaveBeenCalledWith(
      "https://api.outstand.so/v1/media/media_1/confirm",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.url).toBe("https://cdn.example.com/photo.jpg");
  });
});

describe("createPost", () => {
  it("creates a feed post", async () => {
    const spy = mockFetch({
      success: true,
      post: {
        id: "post_1",
        publishedAt: null,
        scheduledAt: "2026-05-21T10:00:00Z",
        socialAccounts: [{ id: "acc_1", status: "scheduled" }],
      },
    });

    const result = await createPost(API_KEY, {
      content: "Hello world",
      mediaIds: ["media_1"],
      socialAccountIds: ["acc_1"],
    });

    expect(spy).toHaveBeenCalledWith(
      "https://api.outstand.so/v1/posts/",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.containers[0].content).toBe("Hello world");
    expect(body.containers[0].mediaIds).toEqual(["media_1"]);
    expect(body.accounts).toEqual(["acc_1"]);
    expect(result.id).toBe("post_1");
  });

  it("creates a story post with instagram config", async () => {
    const spy = mockFetch({
      success: true,
      post: { id: "post_2", socialAccounts: [{ id: "acc_1", status: "scheduled" }] },
    });

    await createPost(API_KEY, {
      content: "",
      mediaIds: ["media_1"],
      socialAccountIds: ["acc_1"],
      instagram: { publishAsStory: true },
    });

    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.instagram).toEqual({ publishAsStory: true });
  });

  it("creates a carousel post with multiple media", async () => {
    const spy = mockFetch({
      success: true,
      post: { id: "post_3", socialAccounts: [{ id: "acc_1", status: "scheduled" }] },
    });

    await createPost(API_KEY, {
      content: "Carousel caption",
      mediaIds: ["media_1", "media_2", "media_3"],
      socialAccountIds: ["acc_1"],
    });

    const body = JSON.parse(spy.mock.calls[0][1]!.body as string);
    expect(body.containers[0].mediaIds).toEqual(["media_1", "media_2", "media_3"]);
  });
});

describe("getPostStatus", () => {
  it("fetches post details with per-account status", async () => {
    mockFetch({
      success: true,
      post: {
        id: "post_1",
        publishedAt: "2026-05-21T10:01:00Z",
        socialAccounts: [
          { id: "acc_1", status: "published", platformPostId: "ig_12345" },
        ],
      },
    });

    const result = await getPostStatus(API_KEY, "post_1");

    expect(result.id).toBe("post_1");
    expect(result.socialAccounts[0].status).toBe("published");
    expect(result.socialAccounts[0].platformPostId).toBe("ig_12345");
  });
});

describe("getPendingConnection", () => {
  it("fetches pending connection details", async () => {
    mockFetch({
      success: true,
      data: {
        network: "instagram",
        availablePages: [{ id: "page_1", name: "My Account", username: "myaccount" }],
      },
    });

    const result = await getPendingConnection("session_token_abc");

    expect(result.network).toBe("instagram");
    expect(result.availablePages).toHaveLength(1);
  });
});

describe("finalizeConnection", () => {
  it("finalizes connection and returns account data", async () => {
    mockFetch({
      success: true,
      connectedAccounts: [
        { id: "acc_new", nickname: "myuser", username: "myuser", network: "instagram" },
      ],
    });

    const result = await finalizeConnection("session_token_abc", ["page_1"]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("acc_new");
    expect(result[0].username).toBe("myuser");
  });
});

describe("getSocialAccountByTenant", () => {
  it("returns the account connected for that tenant", async () => {
    const spy = mockFetch({
      success: true,
      data: [{ id: "acc_t", username: "joe", tenant_id: "T1", createdAt: "2026-01-01" }],
      count: 1,
    });

    const result = await getSocialAccountByTenant(API_KEY, "T1");

    expect(spy.mock.calls[0][0]).toContain("tenant_id=T1");
    expect(result).toEqual({ id: "acc_t", username: "joe", igUserId: null });
  });

  it("picks the account carrying OUR tenant_id, not just the newest (Outstand ignores the filter)", async () => {
    // Outstand returns the whole org. A newer, unrelated signup must NOT be picked.
    mockFetch({
      success: true,
      data: [
        {
          id: "acc_other",
          username: "someone_else",
          tenant_id: "OTHER",
          createdAt: "2026-06-10",
        },
        {
          id: "acc_mine",
          username: "me",
          tenant_id: "T1",
          network_unique_id: "ig9",
          createdAt: "2026-06-03",
        },
      ],
      count: 2,
    });

    const result = await getSocialAccountByTenant(API_KEY, "T1");
    expect(result).toEqual({ id: "acc_mine", username: "me", igUserId: "ig9" });
  });

  it("falls back to the most recent account when none carries our tenant_id", async () => {
    mockFetch({
      success: true,
      data: [{ id: "acc_x", username: "x", createdAt: "2026-01-01" }], // no tenant_id field
      count: 1,
    });
    const result = await getSocialAccountByTenant(API_KEY, "T1", 1);
    expect(result).toEqual({ id: "acc_x", username: "x", igUserId: null });
  });

  it("returns null when no account is connected for the tenant", async () => {
    mockFetch({ success: true, data: [], count: 0 });
    const result = await getSocialAccountByTenant(API_KEY, "T1", 1);
    expect(result).toBeNull();
  });
});
