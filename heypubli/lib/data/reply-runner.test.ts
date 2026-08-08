import { describe, expect, it } from "vitest";
import {
  formDetails,
  settleDelayMs,
  shouldAwaitLeadImport,
  splitThread,
  stillOwnsThread,
  unsendablePhone,
  LEAD_IMPORT_GRACE_MS,
  SETTLE_MIN_MS,
  SETTLE_SPREAD_MS,
} from "./reply-runner";
import type { ThreadMessage } from "@/lib/integrations/whatsapp";

const msg = (
  id: string,
  direction: "inbound" | "outbound",
  body: string,
  at: string,
  status = direction === "inbound" ? "received" : "delivered",
): ThreadMessage => ({ id, direction, body, status, created_at: at });

const NOW = new Date("2026-08-07T14:00:00Z");

describe("splitThread", () => {
  it("collects only what they said AFTER our last real outbound", () => {
    const t = splitThread(
      [
        msg("1", "outbound", "welcome", "2026-08-07T10:00:00Z"),
        msg("2", "inbound", "old question", "2026-08-07T10:05:00Z"),
        msg("3", "outbound", "old answer", "2026-08-07T10:10:00Z"),
        msg("4", "inbound", "is it free?", "2026-08-07T11:00:00Z"),
        msg("5", "inbound", "hello?", "2026-08-07T11:30:00Z"),
      ],
      NOW,
    );
    expect(t.said).toEqual(["is it free?", "hello?"]);
    expect(t.lastInboundId).toBe("5");
    expect(t.repliedSinceWeWrote).toBe(true);
  });

  it("ignores DRAFTS entirely: the other brain's unsent suggestions never count as ours", () => {
    const t = splitThread(
      [
        msg("1", "outbound", "welcome", "2026-08-07T10:00:00Z"),
        msg("2", "inbound", "question", "2026-08-07T11:00:00Z"),
        msg("3", "outbound", "a draft nobody approved", "2026-08-07T11:01:00Z", "draft"),
      ],
      NOW,
    );
    expect(t.said).toEqual(["question"]);
    expect(t.alreadySent).toEqual(["welcome"]);
  });

  it("keeps every outbound body in alreadySent so links are never re-sent", () => {
    const t = splitThread(
      [
        msg("1", "outbound", "video: heypubli.com/watch?u=abc", "2026-08-07T10:00:00Z"),
        msg("2", "outbound", "signup: heypubli.com/signup", "2026-08-07T10:30:00Z"),
        msg("3", "inbound", "done", "2026-08-07T11:00:00Z"),
      ],
      NOW,
    );
    expect(t.alreadySent).toHaveLength(2);
  });

  it("window is open only when the last inbound is inside 24h", () => {
    const open = splitThread([msg("1", "inbound", "hi", "2026-08-07T13:00:00Z")], NOW);
    expect(open.windowOpen).toBe(true);
    const shut = splitThread([msg("1", "inbound", "hi", "2026-08-05T13:00:00Z")], NOW);
    expect(shut.windowOpen).toBe(false);
  });

  it("an empty or outbound-last thread yields no said and no lastInboundId", () => {
    expect(splitThread([], NOW).said).toEqual([]);
    const t = splitThread(
      [
        msg("1", "inbound", "hi", "2026-08-07T10:00:00Z"),
        msg("2", "outbound", "answered", "2026-08-07T10:05:00Z"),
      ],
      NOW,
    );
    expect(t.said).toEqual([]);
    expect(t.repliedSinceWeWrote).toBe(false);
  });

  it("skips empty inbound bodies (a bare image arrives as an empty body)", () => {
    const t = splitThread(
      [
        msg("1", "outbound", "help", "2026-08-07T10:00:00Z"),
        msg("2", "inbound", "", "2026-08-07T11:00:00Z"),
      ],
      NOW,
    );
    expect(t.said).toEqual([]);
    // But the inbound still counts as a reply and still anchors idempotency.
    expect(t.lastInboundId).toBe("2");
    expect(t.repliedSinceWeWrote).toBe(true);
  });

  it("flags a picture sent after our last message: it is the screenshot we asked for", () => {
    const withMedia: ThreadMessage = {
      ...msg("2", "inbound", "", "2026-08-07T11:00:00Z"),
      media_count: 1,
    };
    const t = splitThread([msg("1", "outbound", "send a screenshot", "2026-08-07T10:00:00Z"), withMedia], NOW);
    expect(t.saidHasMedia).toBe(true);
    // A picture BEFORE our last message does not count.
    const t2 = splitThread([withMedia, msg("3", "outbound", "got it", "2026-08-07T11:30:00Z")], NOW);
    expect(t2.saidHasMedia).toBe(false);
  });
});

// ------------------------------------------------------------------
// The settle pause. Hugo, 07 Aug 2026: "reply within like 30 seconds. Not one
// second, but 30 seconds, to sound natural." Varied, never fixed, never instant.
// ------------------------------------------------------------------
describe("settleDelayMs", () => {
  it("stays between 20 and 45 seconds across the whole random range", () => {
    expect(settleDelayMs(0)).toBe(SETTLE_MIN_MS);
    expect(settleDelayMs(1)).toBe(SETTLE_MIN_MS + SETTLE_SPREAD_MS);
    expect(settleDelayMs(0.5)).toBeGreaterThanOrEqual(20_000);
    expect(settleDelayMs(0.5)).toBeLessThanOrEqual(45_000);
  });

  it("never goes instant even on garbage input", () => {
    expect(settleDelayMs(Number.NaN)).toBeGreaterThanOrEqual(SETTLE_MIN_MS);
    expect(settleDelayMs(-5)).toBeGreaterThanOrEqual(SETTLE_MIN_MS);
    expect(settleDelayMs(99)).toBeLessThanOrEqual(SETTLE_MIN_MS + SETTLE_SPREAD_MS);
  });
});

// The debounce that makes it feel human: "hi" / "i saw your ad" / "how does it
// work" in three messages must get ONE reply, decided after the lead stops
// typing. Each inbound starts its own settled invocation; only the one whose
// trigger is still the newest inbound acts.
describe("stillOwnsThread", () => {
  const trigger = Date.parse("2026-08-07T14:00:00Z");

  it("acts when the triggering message is still the newest", () => {
    expect(stillOwnsThread("2026-08-07T14:00:00Z", trigger)).toBe(true);
  });

  it("stands down when a newer message arrived during the pause", () => {
    expect(stillOwnsThread("2026-08-07T14:00:25Z", trigger)).toBe(false);
  });

  it("absorbs up to 2 seconds of clock skew between webhook and message row", () => {
    expect(stillOwnsThread("2026-08-07T14:00:01.500Z", trigger)).toBe(true);
  });

  it("stands down when the thread has no inbound at all", () => {
    expect(stillOwnsThread(null, trigger)).toBe(false);
  });
});

// Angelica, 07 Aug 2026: form said +639381849356, she messaged from
// +639924711588, and the thread matched no lead for 10 invisible minutes. The
// form message itself names the lead she already is.
describe("formDetails", () => {
  it("reads the email and phone out of the Meta form opener", () => {
    const d = formDetails([
      "Hello! I filled out your form and would like to know more about your business. Phone number: +639381849356 First name: Angelica Laine Email: villapandoren@gmail.com",
    ]);
    expect(d.email).toBe("villapandoren@gmail.com");
    expect(d.phone).toBe("+639381849356");
  });

  it("copes with the fields split across messages and no plus sign", () => {
    const d = formDetails(["First name: M", "Phone number: 8277106876 Email: hshakirul4@gmail.com"]);
    expect(d.email).toBe("hshakirul4@gmail.com");
    expect(d.phone).toBe("8277106876");
  });

  it("returns nothing for ordinary chat", () => {
    const d = formDetails(["hi", "how does it work?"]);
    expect(d.email).toBeNull();
    expect(d.phone).toBeNull();
  });

  it("refuses a phone too short to be real", () => {
    expect(formDetails(["Phone number: 12345"]).phone).toBeNull();
  });
});

// Käçhï, 07 Aug 2026: thread "phone" +1352593476491427, a 16-digit WhatsApp
// privacy ID; the reply failed while her real number sat in the form message.
describe("unsendablePhone", () => {
  it("flags a 16-digit privacy ID", () => {
    expect(unsendablePhone("+1352593476491427")).toBe(true);
    expect(unsendablePhone("+2579038539225729")).toBe(true);
  });
  it("passes real numbers, including full-length E.164", () => {
    expect(unsendablePhone("+254704249477")).toBe(false);
    expect(unsendablePhone("+447460035763")).toBe(false);
    expect(unsendablePhone("+123456789012345")).toBe(false);
  });
});

// Jessica, 07 Aug 2026: her opener beat the sheet import by seconds and the
// reply went out with the bare, untrackable /watch link.
describe("shouldAwaitLeadImport", () => {
  const now = new Date("2026-08-07T20:01:00Z");
  const details = { email: "ajbellaflor@gmail.com", phone: "+639947567008" };

  it("waits when the form names a lead and the message is fresh", () => {
    expect(shouldAwaitLeadImport(details, "2026-08-07T20:00:30Z", now)).toBe(true);
  });

  it("answers codeless once the grace has passed, never stays silent", () => {
    const stale = new Date(now.getTime() - LEAD_IMPORT_GRACE_MS - 1000).toISOString();
    expect(shouldAwaitLeadImport(details, stale, now)).toBe(false);
  });

  it("never waits on a message with no contact details", () => {
    expect(
      shouldAwaitLeadImport({ email: null, phone: null }, "2026-08-07T20:00:30Z", now),
    ).toBe(false);
  });

  it("the grace stays under the monitor's 3-minute neverLooked alarm", () => {
    expect(LEAD_IMPORT_GRACE_MS).toBeLessThan(180_000);
  });
});

// Hugo asked for this twice: a creator who cannot describe the screen sends a
// photo of it, and every one of those was a handover. splitThread has to hand
// the runner the id of the newest picture so it can be fetched and looked at.
describe("the newest screenshot", () => {
  const msg = (over: Partial<ThreadMessage>): ThreadMessage => ({
    id: "m",
    direction: "inbound",
    body: "",
    status: "received",
    created_at: "2026-08-08T10:00:00Z",
    ...over,
  });

  it("points at the LAST picture they sent since our message", () => {
    const s = splitThread(
      [
        msg({ id: "out1", direction: "outbound", body: "send me a screenshot", created_at: "2026-08-08T09:00:00Z" }),
        msg({ id: "old", media_count: 1, created_at: "2026-08-08T09:10:00Z" }),
        msg({ id: "new", media_count: 1, created_at: "2026-08-08T09:20:00Z" }),
      ],
      new Date("2026-08-08T09:30:00Z"),
    );
    expect(s.saidHasMedia).toBe(true);
    expect(s.lastMediaId).toBe("new");
  });

  it("is null when they only sent words, so nothing is fetched", () => {
    const s = splitThread(
      [
        msg({ id: "out1", direction: "outbound", body: "hi", created_at: "2026-08-08T09:00:00Z" }),
        msg({ id: "a", body: "stuck", created_at: "2026-08-08T09:10:00Z" }),
      ],
      new Date("2026-08-08T09:30:00Z"),
    );
    expect(s.lastMediaId).toBeNull();
  });

  it("ignores a picture sent BEFORE our last message, which we already answered", () => {
    const s = splitThread(
      [
        msg({ id: "old", media_count: 1, created_at: "2026-08-08T09:00:00Z" }),
        msg({ id: "out1", direction: "outbound", body: "here is what to tap", created_at: "2026-08-08T09:05:00Z" }),
      ],
      new Date("2026-08-08T09:30:00Z"),
    );
    expect(s.lastMediaId).toBeNull();
  });
});
