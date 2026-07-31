import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "./resend";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM", "NextPubli <no-reply@nextpubli.com>");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendEmail", () => {
  it("POSTs to the Resend API with auth header and payload", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "email-1" }) });

    const ok = await sendEmail({
      to: "hugo@example.com",
      subject: "Nova conta conectada",
      html: "<p>Oi</p>",
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer re_test_key" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(["hugo@example.com"]);
    expect(body.from).toBe("NextPubli <no-reply@nextpubli.com>");
    expect(body.subject).toBe("Nova conta conectada");
  });

  it("returns false without throwing when the API key is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const ok = await sendEmail({ to: "a@b.com", subject: "x", html: "y" });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false without throwing when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const ok = await sendEmail({ to: "a@b.com", subject: "x", html: "y" });
    expect(ok).toBe(false);
  });

  it("returns false on a non-2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => "bad" });
    const ok = await sendEmail({ to: "a@b.com", subject: "x", html: "y" });
    expect(ok).toBe(false);
  });
});
