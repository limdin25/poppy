import { describe, it, expect } from "vitest";
import {
  decideLane,
  timezoneForPhone,
  whatsappMarketingAllowed,
  withinSendingHours,
  NURTURE_PLAN,
} from "./lanes";

describe("timezoneForPhone", () => {
  it("reads the country from the dialling code", () => {
    expect(timezoneForPhone("+447863992555")).toBe("Europe/London");
    expect(timezoneForPhone("+5511987654321")).toBe("America/Sao_Paulo");
    expect(timezoneForPhone("+12125551234")).toBe("America/New_York");
    expect(timezoneForPhone("+61412345678")).toBe("Australia/Sydney");
  });

  it("prefers the longest matching code, so +353 is not read as +3", () => {
    expect(timezoneForPhone("+353871234567")).toBe("Europe/Dublin");
    expect(timezoneForPhone("+34612345678")).toBe("Europe/Madrid");
    expect(timezoneForPhone("+2348012345678")).toBe("Africa/Lagos");
    expect(timezoneForPhone("+27821234567")).toBe("Africa/Johannesburg");
  });

  it("falls back to UTC rather than guessing confidently wrong", () => {
    expect(timezoneForPhone(null)).toBe("UTC");
    expect(timezoneForPhone("")).toBe("UTC");
    expect(timezoneForPhone("+9991234567")).toBe("UTC");
  });

  it("tolerates a number stored without its plus", () => {
    expect(timezoneForPhone("447863992555")).toBe("Europe/London");
  });

  /* The bug this replaced: one hardcoded timezone for a worldwide list. At 09:00 in Sao
     Paulo it is noon in London and 04:00 in California, so the old gate opened the day
     in the middle of somebody's night. */
  it("keeps a UK and a US number out of the middle of their night", () => {
    // 08:00 UTC: 08:00 London (in hours), 00:00 in California (must not send).
    const morningUtc = new Date("2026-08-03T08:00:00Z");
    expect(withinSendingHours(morningUtc, timezoneForPhone("+447863992555"))).toBe(true);
    expect(withinSendingHours(morningUtc, timezoneForPhone("+13105551234"))).toBe(false);
  });
});

describe("decideLane", () => {
  it("inserts a brand new lead in whatever lane it arrived through", () => {
    expect(decideLane(null, "partner", false)).toEqual({
      action: "insert",
      lane: "partner",
    });
    expect(decideLane(null, "customer", false)).toEqual({
      action: "insert",
      lane: "customer",
    });
  });

  it("keeps the lane when nothing changed", () => {
    expect(decideLane("partner", "partner", false).action).toBe("keep");
  });

  // Hugo's rule. The one case the whole design exists to prevent.
  it("refuses to turn a paying customer into a free partner", () => {
    const d = decideLane("customer", "partner", false);
    expect(d.action).toBe("conflict");
  });

  it("refuses to strip partner status from a recruit who buys something", () => {
    const d = decideLane("partner", "customer", false);
    expect(d.action).toBe("conflict");
  });

  it("upgrades an organic signup who filled the Facebook form", () => {
    const d = decideLane("organic", "partner", false);
    expect(d).toEqual({ action: "upgrade", lane: "partner", reason: "system:fb_upgrade" });
  });

  // The guard on the one automatic upgrade: Skool already knows them as paying.
  it("refuses that upgrade when they are already a paid member", () => {
    const d = decideLane("organic", "partner", true);
    expect(d.action).toBe("conflict");
  });

  it("lets an organic signup become a customer by buying", () => {
    expect(decideLane("organic", "customer", false).action).toBe("upgrade");
  });

  it("ignores arrivals through a weaker door", () => {
    expect(decideLane("partner", "organic", false).action).toBe("keep");
    expect(decideLane("customer", "organic", false).action).toBe("keep");
  });
});

describe("whatsappMarketingAllowed", () => {
  // Meta does not deliver marketing templates to US numbers at all. A US lead on the
  // WhatsApp path would silently receive nothing while Twilio reports success.
  it("routes US numbers away from WhatsApp", () => {
    expect(whatsappMarketingAllowed("+12125551234")).toBe(false); // New York
    expect(whatsappMarketingAllowed("+13055551234")).toBe(false); // Miami
  });

  it("keeps Canada on WhatsApp", () => {
    expect(whatsappMarketingAllowed("+14165551234")).toBe(true); // Toronto
    expect(whatsappMarketingAllowed("+16045551234")).toBe(true); // Vancouver
  });

  it("keeps the rest of the world on WhatsApp", () => {
    expect(whatsappMarketingAllowed("+5511999998888")).toBe(true); // Brazil
    expect(whatsappMarketingAllowed("+447863992555")).toBe(true); // UK
  });
});

describe("withinSendingHours", () => {
  it("blocks the middle of the night in the lead's own timezone", () => {
    // 03:00 in Sao Paulo (UTC-3) is 06:00 UTC.
    expect(withinSendingHours(new Date("2026-08-03T06:00:00Z"), "America/Sao_Paulo")).toBe(
      false,
    );
  });

  it("allows the afternoon in the lead's own timezone", () => {
    // 15:00 in Sao Paulo is 18:00 UTC.
    expect(withinSendingHours(new Date("2026-08-03T18:00:00Z"), "America/Sao_Paulo")).toBe(
      true,
    );
  });

  it("fails open on daytime UTC when the timezone is garbage", () => {
    expect(withinSendingHours(new Date("2026-08-03T12:00:00Z"), "Not/AZone")).toBe(true);
    expect(withinSendingHours(new Date("2026-08-03T03:00:00Z"), "Not/AZone")).toBe(false);
  });
});

describe("NURTURE_PLAN", () => {
  it("is at most three WhatsApp touches, with email breaking the rhythm", () => {
    const wa = NURTURE_PLAN.filter((s) => s.channel === "whatsapp");
    expect(wa.length).toBeLessThanOrEqual(3);
    expect(NURTURE_PLAN.some((s) => s.channel === "email")).toBe(true);
  });

  it("steps are ordered and unique", () => {
    const steps = NURTURE_PLAN.map((s) => s.step);
    expect(steps).toEqual([...new Set(steps)].sort((a, b) => a - b));
  });
});
