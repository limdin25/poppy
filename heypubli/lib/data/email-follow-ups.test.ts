// Hugo, 08 Aug 2026: "after twenty four hours we keep following up on them via
// email, until they do it, because we have their email as well." A WhatsApp
// message costs about four cents; an email costs about nothing. So the paid
// ladder stops at four and this one carries the long tail.

import { describe, expect, it } from "vitest";
import { buildFollowUpHtml, emailGapHours, stepEmail, stopToken } from "./email-follow-ups";

describe("how often the free ladder writes", () => {
  it("is daily for the first week, then weekly, and never stops", () => {
    expect(emailGapHours(0)).toBe(24);
    expect(emailGapHours(6)).toBe(24);
    // An email a day forever is what earns a spam complaint, and heypubli.com
    // is the domain the Skool INVITES leave from: burning it would break the
    // step most of these creators are stuck on.
    expect(emailGapHours(7)).toBe(24 * 7);
    expect(emailGapHours(100)).toBe(24 * 7);
  });
});

describe("what each email says", () => {
  it("names the sender the community invite really comes from", () => {
    const e = stepEmail("community", { firstName: "Chiquita" });
    expect(e.todo.join(" ")).toMatch(/skool/i);
    expect(e.lead).toContain("Lim Din");
  });

  it("carries their own sentence and link, so the email IS the work", () => {
    const e = stepEmail("bio", {
      firstName: "Nzama",
      sentence: "Curious how this is made? The link below explains it.",
      link: "https://www.skool.com/x/about?ref=abc123",
    });
    const body = e.todo.join(" ");
    expect(body).toContain("Curious how this is made?");
    expect(body).toContain("ref=abc123");
  });

  // The same rule as every other surface: Instagram only makes a URL tappable
  // from the Links box, so a creator must never read one thing here and another
  // in WhatsApp.
  it("tells them the link goes in the Links box, not the bio text", () => {
    const e = stepEmail("bio", { firstName: "", sentence: null, link: null });
    expect(e.todo.join(" ")).toMatch(/not type the link inside the Bio text/i);
  });

  it("every step has an email and none of them carries a long dash", () => {
    for (const step of ["instagram", "community", "affiliate", "photo", "bio"] as const) {
      const e = stepEmail(step, { firstName: "Sam" });
      const all = `${e.subject} ${e.lead} ${e.todo.join(" ")}`;
      expect(e.subject.length, step).toBeGreaterThan(10);
      for (const banned of ["—", "–", "‘", "’", "“", "”", "…"]) {
        expect(all.includes(banned), `${step} contains ${banned}`).toBe(false);
      }
    }
  });
});

describe("the stop link", () => {
  it("is on every email, because the alternative is a spam complaint", () => {
    const html = buildFollowUpHtml(stepEmail("photo", { firstName: "Ali" }), "abc-123");
    expect(html).toContain("/api/email/stop?p=abc-123");
    expect(html).toMatch(/Stop these emails/i);
  });

  it("cannot be forged for somebody else's account", () => {
    expect(stopToken("abc-123")).not.toBe(stopToken("abc-124"));
    expect(stopToken("abc-123")).toBe(stopToken("abc-123"));
    expect(stopToken("abc-123")).toHaveLength(24);
  });
});
