// Hugo, 08 Aug 2026: "after twenty four hours we keep following up on them via
// email, until they do it, because we have their email as well." A WhatsApp
// message costs about four cents; an email costs about nothing. So the paid
// ladder stops at four and this one carries the long tail.

import { describe, expect, it } from "vitest";
import {
  EMAILS_BEFORE_DROP,
  buildFollowUpHtml,
  dropAccount,
  emailGapHours,
  stepEmail,
  stopToken,
} from "./email-follow-ups";

describe("how often the free ladder writes, and when it ends", () => {
  it("is one a day, every day", () => {
    expect(emailGapHours(0)).toBe(24);
    expect(emailGapHours(6)).toBe(24);
  });

  // Hugo, 08 Aug 2026: "one time a day for seven days, and that's it. If they
  // don't, then we disconnect the account. You have to make that a rule."
  it("stops at seven", () => {
    expect(EMAILS_BEFORE_DROP).toBe(7);
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

describe("dropping the account at the end of the seven days", () => {
  const fakeAdmin = () => {
    const tables: string[] = [];
    const patches: Record<string, unknown>[] = [];
    const chain = () => {
      const c: Record<string, unknown> = {};
      for (const k of ["eq", "is"]) c[k] = () => c;
      c.update = (patch: Record<string, unknown>) => {
        patches.push(patch);
        return c;
      };
      (c as { then: unknown }).then = (r: (v: { error: null }) => void) => r({ error: null });
      return c;
    };
    return {
      tables,
      patches,
      admin: {
        from: (t: string) => {
          tables.push(t);
          return chain();
        },
      } as unknown as Parameters<typeof dropAccount>[0],
    };
  };

  it("stops the emails AND the paid Instagram read, in that order", async () => {
    const f = fakeAdmin();
    await dropAccount(f.admin, "abc-123", "7 daily emails unanswered on bio");
    expect(f.tables).toEqual(["profiles", "outstand_connections"]);
    expect(f.patches[0]).toMatchObject({
      dropped_reason: "7 daily emails unanswered on bio",
      dropped_at: expect.any(String),
      email_follow_ups_stopped_at: expect.any(String),
    });
    // Same instant on both, which is how reply-runner tells our drop apart from
    // somebody who pressed the unsubscribe link themselves.
    expect(f.patches[0].dropped_at).toBe(f.patches[0].email_follow_ups_stopped_at);
    expect(f.patches[1]).toEqual({ is_connected: false });
  });

  // It is a spending stop, not a punishment: nothing here suspends them, so
  // their login still works and they keep every step they finished.
  it("never suspends anybody", async () => {
    const f = fakeAdmin();
    await dropAccount(f.admin, "abc-123", "no answer");
    for (const patch of f.patches) expect(patch).not.toHaveProperty("suspended_at");
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
