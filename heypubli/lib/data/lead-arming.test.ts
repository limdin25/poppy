import { describe, expect, it } from "vitest";
import { decideArm } from "./lead-arming";

const NOW = new Date("2026-08-07T14:00:00Z");

describe("decideArm", () => {
  it("blocks a do-not-text contact outright", () => {
    expect(
      decideArm({ ok: true, do_not_text: true, last_inbound_at: null }, NOW),
    ).toEqual({ action: "block" });
  });

  it("hands a LIVE conversation (inbound within 24h) to the inbox, no drip", () => {
    const d = decideArm(
      { ok: true, do_not_text: false, last_inbound_at: "2026-08-07T09:00:00Z" },
      NOW,
    );
    expect(d.action).toBe("engage");
  });

  it("arms the drip when the only inbound is older than 24h, the thread is dead", () => {
    const d = decideArm(
      { ok: true, do_not_text: false, last_inbound_at: "2026-08-01T09:00:00Z" },
      NOW,
    );
    expect(d.action).toBe("arm");
  });

  it("arms the drip for a contact who never wrote to us", () => {
    expect(decideArm({ ok: true, do_not_text: false, last_inbound_at: null }, NOW).action).toBe(
      "arm",
    );
  });

  it("fails OPEN into arming when the CRM is unreachable", () => {
    const d = decideArm({ ok: false }, NOW);
    if (d.action !== "arm") throw new Error("expected arm");
    expect(d.degraded).toBe(true);
  });

  it("arms IMMEDIATELY, no grace. Hugo: as soon as they come we message them", () => {
    const d = decideArm({ ok: true, do_not_text: false, last_inbound_at: null }, NOW);
    if (d.action !== "arm") throw new Error("expected arm");
    expect(d.nextAt.getTime()).toBe(NOW.getTime());
  });
});
