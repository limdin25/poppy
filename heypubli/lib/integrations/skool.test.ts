import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSkoolInvite } from "./skool";

// Measured against the real endpoint on 2026-08-06, because Skool's own help text
// does not say any of this:
//   - GET returns 405 Method Not Allowed. It is POST.
//   - POST {url}?email=<encoded> returns 200 with an EMPTY body.
//   - The invite email lands within seconds, from noreply@skool.com, subject
//     "Lim Din invited you to join AI influencer Flywheel".
//   - The response never contains the invite link, so we cannot deliver the join
//     link ourselves and the email round trip is unavoidable.

const URL_ENV = "SKOOL_INVITE_WEBHOOK_URL";
const REAL =
  "https://api2.skool.com/groups/ai-influencer-flywheel-5612/webhooks/deadbeef";

describe("sendSkoolInvite", () => {
  const original = process.env[URL_ENV];

  beforeEach(() => {
    process.env[URL_ENV] = REAL;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env[URL_ENV];
    else process.env[URL_ENV] = original;
  });

  it("POSTs, because a GET is refused with 405", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendSkoolInvite("bob@example.com");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
  });

  it("puts the email in the query string, url encoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendSkoolInvite("bob+tag@example.com");

    const [url] = fetchMock.mock.calls[0];
    // A raw "+" in a query string decodes to a space, which would invite the
    // wrong address, or nobody.
    expect(String(url)).toContain("email=bob%2Btag%40example.com");
  });

  it("reports success on a 200 with an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    await expect(sendSkoolInvite("bob@example.com")).resolves.toEqual({ ok: true });
  });

  it("reports the status on a failure, so the retry has something to log", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const res = await sendSkoolInvite("bob@example.com");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("500");
  });

  it("refuses when the webhook is not configured, rather than throwing", async () => {
    delete process.env[URL_ENV];
    const res = await sendSkoolInvite("bob@example.com");
    expect(res).toEqual({ ok: false, error: "skool invite webhook not configured" });
  });

  it("refuses a webhook url that is not Skool", async () => {
    // The URL is a bearer secret: anyone holding it can invite themselves into
    // the group. If it is ever misconfigured we must not post a lead's email
    // address to whatever host is in the variable.
    process.env[URL_ENV] = "https://evil.test/hook";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendSkoolInvite("bob@example.com");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an empty email instead of inviting nobody and calling it sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendSkoolInvite("   ");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
