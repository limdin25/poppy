import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getInstagramAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  getInstagramProfile,
  createMediaContainer,
  checkContainerStatus,
  publishMedia,
} from "./instagram";

vi.stubEnv("INSTAGRAM_APP_ID", "test-app-id");
vi.stubEnv("INSTAGRAM_APP_SECRET", "test-app-secret");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("getInstagramAuthUrl", () => {
  it("builds correct OAuth URL with required params", () => {
    const url = getInstagramAuthUrl("https://heypubli.com/auth/instagram/callback");
    expect(url).toContain("https://api.instagram.com/oauth/authorize");
    expect(url).toContain("client_id=test-app-id");
    expect(url).toContain(
      "redirect_uri=https%3A%2F%2Fheypubli.com%2Fauth%2Finstagram%2Fcallback",
    );
    expect(url).toContain(
      "scope=instagram_business_basic%2Cinstagram_business_content_publish",
    );
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=");
  });
});

describe("exchangeCodeForToken", () => {
  it("exchanges code for short-lived token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "short-token", user_id: "12345" }),
    });

    const result = await exchangeCodeForToken(
      "auth-code",
      "https://heypubli.com/callback",
    );
    expect(result).toEqual({ access_token: "short-token", user_id: "12345" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.instagram.com/oauth/access_token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error_message: "Invalid code" }),
    });

    await expect(
      exchangeCodeForToken("bad-code", "https://heypubli.com/callback"),
    ).rejects.toThrow("Invalid code");
  });
});

describe("exchangeForLongLivedToken", () => {
  it("exchanges short-lived for long-lived token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "long-token", expires_in: 5184000 }),
    });

    const result = await exchangeForLongLivedToken("short-token");
    expect(result).toEqual({ access_token: "long-token", expires_in: 5184000 });
  });
});

describe("refreshLongLivedToken", () => {
  it("refreshes an expiring token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "new-token", expires_in: 5184000 }),
    });

    const result = await refreshLongLivedToken("old-token");
    expect(result).toEqual({ access_token: "new-token", expires_in: 5184000 });
  });
});

describe("getInstagramProfile", () => {
  it("fetches profile data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        user_id: "12345",
        username: "influencer",
        account_type: "BUSINESS",
        media_count: 42,
      }),
    });

    const result = await getInstagramProfile("token");
    expect(result.username).toBe("influencer");
    expect(result.media_count).toBe(42);
  });
});

describe("createMediaContainer", () => {
  it("creates a feed image container", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "container-123" }),
    });

    const result = await createMediaContainer({
      igUserId: "12345",
      token: "token",
      imageUrl: "https://example.com/image.jpg",
      caption: "Test post",
    });
    expect(result.id).toBe("container-123");
  });

  it("creates a stories container", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "story-456" }),
    });

    const result = await createMediaContainer({
      igUserId: "12345",
      token: "token",
      imageUrl: "https://example.com/story.jpg",
      mediaType: "STORIES",
    });
    expect(result.id).toBe("story-456");
  });
});

describe("checkContainerStatus", () => {
  it("returns container status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status_code: "FINISHED" }),
    });

    const result = await checkContainerStatus("container-123", "token");
    expect(result.status_code).toBe("FINISHED");
  });
});

describe("publishMedia", () => {
  it("publishes a container and returns media id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "media-789" }),
    });

    const result = await publishMedia("12345", "container-123", "token");
    expect(result.id).toBe("media-789");
  });

  it("throws on publish error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: "Rate limit exceeded" } }),
    });

    await expect(publishMedia("12345", "container-123", "token")).rejects.toThrow(
      "Rate limit exceeded",
    );
  });
});
