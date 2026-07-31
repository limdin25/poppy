import { describe, it, expect, vi, beforeEach } from "vitest";

// Controllable fakes shared between the mock factories and the tests.
const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  cookies: {} as Record<string, string>,
  cookieDelete: vi.fn(),
  getPostingSettingsAdmin: vi.fn(),
  getSocialAccountByTenant: vi.fn(),
  findOrCreate: vi.fn(),
  saveOutstandConnection: vi.fn(),
  notify: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      mocks.cookies[name] !== undefined ? { value: mocks.cookies[name] } : undefined,
    delete: mocks.cookieDelete,
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.user } }),
      verifyOtp: mocks.verifyOtp,
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { generateLink: mocks.generateLink } },
    // Only used by the connect branch to look up the profile name for the notification.
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { first_name: "Hugo", last_name: "100" } }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/integrations/outstand", () => ({
  getSocialAccountByTenant: mocks.getSocialAccountByTenant,
}));

vi.mock("@/lib/data/outstand", () => ({
  saveOutstandConnection: mocks.saveOutstandConnection,
  getPostingSettingsAdmin: mocks.getPostingSettingsAdmin,
}));

vi.mock("@/lib/data/auth-ig", () => ({
  findOrCreateInfluencerByOutstand: mocks.findOrCreate,
}));

vi.mock("@/lib/data/notifications", () => ({
  notifyAccountConnected: mocks.notify,
}));

import { GET } from "./route";
import { STATE_COOKIE, SIGNUP_COOKIE } from "@/lib/ig-auth-cookies";

const SIGNUP = JSON.stringify({
  first_name: "Hugo",
  last_name: "24eu",
  email: "hugo24eu@gmail.com",
  whatsapp: "11988887777",
});

function call(query = ""): Promise<Response> {
  return GET(
    new Request(`https://nextpubli.com/auth/outstand/callback${query}`),
  ) as Promise<Response>;
}

beforeEach(() => {
  mocks.user = null;
  mocks.cookies = {};
  mocks.cookieDelete.mockClear();
  mocks.getPostingSettingsAdmin.mockResolvedValue({ outstand_api_key: "key" });
  mocks.getSocialAccountByTenant.mockResolvedValue({
    id: "TqKf1",
    username: "hugorofficial",
    igUserId: "ig-1",
  });
  mocks.findOrCreate.mockReset();
  mocks.findOrCreate.mockResolvedValue({
    userId: "fresh",
    email: "hugo24eu@gmail.com",
    isNew: true,
  });
  mocks.saveOutstandConnection.mockReset();
  mocks.saveOutstandConnection.mockResolvedValue({ isNew: true });
  mocks.notify.mockResolvedValue(undefined);
  mocks.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "th" } },
    error: null,
  });
  mocks.verifyOtp.mockResolvedValue({ error: null });
});

describe("GET /auth/outstand/callback", () => {
  it("logged-in user WITH a signup form → creates a NEW account, does NOT connect to the existing one", async () => {
    mocks.user = { id: "hugo100" }; // already logged in as an existing influencer
    mocks.cookies = { [STATE_COOKIE]: "nonce1", [SIGNUP_COOKIE]: SIGNUP };

    const res = await call("?tenant_id=nonce1");

    // The signup wins: a fresh account is created with the form's email...
    expect(mocks.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ username: "hugorofficial" }),
      expect.objectContaining({ email: "hugo24eu@gmail.com" }),
    );
    // ...and we do NOT silently connect the Instagram to the logged-in account.
    expect(mocks.saveOutstandConnection).not.toHaveBeenCalled();
    // a new session is minted for the new account
    expect(mocks.verifyOtp).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://nextpubli.com/onboarding");
  });

  it("logged-in user WITHOUT signup data → connects Instagram to the existing account", async () => {
    mocks.user = { id: "hugo100" };
    mocks.cookies = { [STATE_COOKIE]: "ignored-when-connecting" };

    const res = await call();

    expect(mocks.saveOutstandConnection).toHaveBeenCalledWith(
      "hugo100",
      "TqKf1",
      "hugorofficial",
      "ig-1",
    );
    expect(mocks.findOrCreate).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(
      "https://nextpubli.com/onboarding?ig_connected=true",
    );
  });

  it("not logged in WITH a signup form → creates a new account", async () => {
    mocks.user = null;
    mocks.cookies = { [STATE_COOKIE]: "nonce1", [SIGNUP_COOKIE]: SIGNUP };

    const res = await call("?tenant_id=nonce1");

    expect(mocks.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ username: "hugorofficial" }),
      expect.objectContaining({ email: "hugo24eu@gmail.com" }),
    );
    expect(mocks.saveOutstandConnection).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://nextpubli.com/onboarding");
  });
});
