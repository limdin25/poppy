import { describe, it, expect } from "vitest";
import {
  mayContactNow,
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

  // UTC was never "a neutral middle": its 09:00-20:00 window is 15:00-02:00
  // in Dhaka, and +880 was missing from the list. Unknown must be NULL so the
  // caller refuses instead of texting somebody at 2am.
  it("returns null for a country it cannot place, never a confident guess", () => {
    expect(timezoneForPhone(null)).toBeNull();
    expect(timezoneForPhone("")).toBeNull();
    expect(timezoneForPhone("+9991234567")).toBeNull();
  });

  it("knows the countries this funnel actually recruits from", () => {
    expect(timezoneForPhone("+8801675426557")).toBe("Asia/Dhaka");
    expect(timezoneForPhone("+919824840910")).toBe("Asia/Kolkata");
    expect(timezoneForPhone("+639662874294")).toBe("Asia/Manila");
    expect(timezoneForPhone("+9771234567")).toBe("Asia/Kathmandu");
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

  // FAILS CLOSED. Both fallbacks used to land on UTC hours, so a lead we could
  // not place was texted on London time.
  it("refuses to send when it cannot tell what time it is for them", () => {
    expect(withinSendingHours(new Date("2026-08-03T12:00:00Z"), "Not/AZone")).toBe(false);
    expect(withinSendingHours(new Date("2026-08-03T12:00:00Z"), null)).toBe(false);
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

// Hugo, 07 Aug 2026, watching form leads arrive at 23:00 Dhaka time: "If the
// leads are coming at this time, we can reply them any time. If they come in
// the middle of the night, we still reply them because they are awake."
//
// Quiet hours exist so WE do not start conversations at 3am. A lead who acted
// minutes ago is awake by their own evidence, and making them wait until 09:00
// for the welcome wastes the hottest minutes a lead ever has. The freshness
// window is what keeps this honest: the nurture sweep re-arms day-old strays,
// and THOSE must still wait for morning, because their owner is asleep.
describe("mayContactNow", () => {
  const night = new Date("2026-08-07T17:30:00Z"); // 23:30 in Dhaka
  const day = new Date("2026-08-07T07:30:00Z");   // 13:30 in Dhaka
  const DHAKA = "Asia/Dhaka";

  it("daytime sends are always allowed, freshness never enters into it", () => {
    expect(mayContactNow(day, DHAKA, null)).toBe(true);
    expect(mayContactNow(day, DHAKA, "2026-08-01T00:00:00Z")).toBe(true);
  });

  it("a lead who acted minutes ago may be contacted at any hour", () => {
    expect(mayContactNow(night, DHAKA, "2026-08-07T17:24:00Z")).toBe(true);
  });

  it("a stray re-armed by the sweep still waits for their morning", () => {
    expect(mayContactNow(night, DHAKA, "2026-08-05T09:00:00Z")).toBe(false);
  });

  it("no known action at night means wait, we cannot prove anyone is awake", () => {
    expect(mayContactNow(night, DHAKA, null)).toBe(false);
  });

  it("an unreadable stamp fails closed, exactly like the timezone rule above", () => {
    expect(mayContactNow(night, DHAKA, "not a date")).toBe(false);
  });

  it("a fresh action outruns an unknown timezone", () => {
    // withinSendingHours fails closed on a null timezone because without one we
    // might wake somebody. A lead who acted six minutes ago is awake wherever
    // they are, so freshness answers the exact question the timezone was a
    // proxy for. Stale plus unknown stays blocked, as the next line proves.
    expect(mayContactNow(night, null, "2026-08-07T17:24:00Z")).toBe(true);
    expect(mayContactNow(night, null, "2026-08-05T09:00:00Z")).toBe(false);
  });
});
