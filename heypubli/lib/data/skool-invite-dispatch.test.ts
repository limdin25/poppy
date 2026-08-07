import { describe, it, expect, vi, beforeEach } from "vitest";

// The whole point of this module: the creator presses "Send me the invite" and
// the email leaves NOW, not on the next five-minute cron.
//
// 07 Aug 2026, the first real creator. He pressed the button 21 seconds after
// signing up and then sat looking at an empty inbox, because dispatch only ran
// from /api/funnel/tick. His invite was still status=queued, attempts=0 more
// than two minutes later, and only went out because a human ran the cron by
// hand. That is the single most likely minute for somebody to give up.

const sendSkoolInvite = vi.fn();
vi.mock("@/lib/integrations/skool", () => ({
  sendSkoolInvite: (...args: unknown[]) => sendSkoolInvite(...args),
}));

import { canInviteFreely, dispatchInvite, MAX_INVITE_ATTEMPTS } from "./skool-invite-dispatch";

/** Minimal stand-in for the supabase admin client, recording every update. */
function fakeAdmin() {
  const updates: Record<string, unknown>[] = [];
  const client = {
    updates,
    from() {
      return {
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return {
            eq: () => ({ neq: () => Promise.resolve({}), then: undefined }),
          };
        },
      };
    },
  };
  // .eq() must be awaitable in the code path, so hand back a thenable.
  client.from = () => ({
    update(patch: Record<string, unknown>) {
      updates.push(patch);
      const result = Promise.resolve({ error: null });
      return {
        eq: () => Object.assign(Promise.resolve({ error: null }), {
          neq: () => result,
        }),
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return client;
}

const invite = {
  id: "inv-1",
  email: "creator@example.com",
  attempts: 0,
  lead_id: null,
};

beforeEach(() => {
  sendSkoolInvite.mockReset();
});

describe("dispatchInvite", () => {
  it("sends the invite immediately and marks it confirmed", async () => {
    sendSkoolInvite.mockResolvedValue({ ok: true });
    const admin = fakeAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await dispatchInvite(admin as any, invite as any);

    expect(ok).toBe(true);
    expect(sendSkoolInvite).toHaveBeenCalledWith("creator@example.com");
    const statuses = admin.updates.map((u) => u.status);
    expect(statuses).toContain("sending");
    expect(statuses).toContain("confirmed");
  });

  // A failure must go back to queued so the cron retries, never silently lost.
  it("returns a failed invite to the queue for the cron to retry", async () => {
    sendSkoolInvite.mockResolvedValue({ ok: false, error: "skool 500" });
    const admin = fakeAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await dispatchInvite(admin as any, invite as any);

    expect(ok).toBe(false);
    const last = admin.updates[admin.updates.length - 1];
    expect(last.status).toBe("queued");
    expect(last.last_error).toBe("skool 500");
  });

  it("gives up after the attempt limit instead of retrying for ever", async () => {
    sendSkoolInvite.mockResolvedValue({ ok: false, error: "nope" });
    const admin = fakeAdmin();

    await dispatchInvite(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...invite, attempts: MAX_INVITE_ATTEMPTS - 1 } as any,
    );

    const last = admin.updates[admin.updates.length - 1];
    expect(last.status).toBe("failed");
  });

  // Throwing here would take the creator's button down with it. The cron is the
  // safety net, so a wobble must degrade to "queued", not to a broken page.
  it("survives the sender throwing and leaves the row retryable", async () => {
    sendSkoolInvite.mockRejectedValue(new Error("network down"));
    const admin = fakeAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await dispatchInvite(admin as any, invite as any);

    expect(ok).toBe(false);
    const last = admin.updates[admin.updates.length - 1];
    expect(last.status).toBe("queued");
  });

  it("counts the attempt before sending, so a crash cannot loop for ever", async () => {
    sendSkoolInvite.mockResolvedValue({ ok: true });
    const admin = fakeAdmin();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchInvite(admin as any, invite as any);

    const claim = admin.updates.find((u) => u.status === "sending");
    expect(claim?.attempts).toBe(1);
  });
});

// ------------------------------------------------------------------
// Who may be handed a free place in the community.
//
// Hugo, 07 Aug 2026: "the invites should be sent first thing regardless. When
// you send the link for them to watch, already send the invite." So the invite
// no longer waits for a signup or a button press, which means the guard that
// used to sit inside the logged-in server action has to stand on its own.
// ------------------------------------------------------------------
describe("canInviteFreely", () => {
  it("invites a partner lead", () => {
    expect(canInviteFreely({ email: "Real.Person@gmail.com", lane: "partner" }))
      .toEqual({ ok: true, email: "real.person@gmail.com" });
  });

  it("invites somebody we have no lane for yet, which is most cold leads", () => {
    expect(canInviteFreely({ email: "new@gmail.com", lane: null }).ok).toBe(true);
  });

  // A free place is for a recruit. Somebody marked customer should be paying.
  it("refuses a customer", () => {
    expect(canInviteFreely({ email: "buyer@gmail.com", lane: "customer" }))
      .toEqual({ ok: false, reason: "is_customer" });
  });

  // No email means no invite, ever, and step 2 becomes impossible for them.
  it.each([["", "no_email"], [null, "no_email"], ["not-an-email", "no_email"], ["a@b", "no_email"]])(
    "refuses %s", (email, reason) => {
      expect(canInviteFreely({ email: email as string | null, lane: "partner" }))
        .toEqual({ ok: false, reason });
    },
  );

  it("refuses our own synthetic Instagram address, which cannot receive mail", () => {
    expect(canInviteFreely({ email: "ig_9@instagram.heypubli.com", lane: "partner" }))
      .toEqual({ ok: false, reason: "synthetic_email" });
  });
});

// inviteLeadByEmail could never create a lead. signup_leads.last_name is NOT
// NULL and the insert omitted it, so every brand new person got
// {ok:false, reason:"failed"} with no column named. That is precisely the people
// the feature exists for: Hugo added it after Edelyn reached step 2, found no
// invite email and spent an hour asking for one.
//
// Found on 07 Aug by trying it on ONE real lead before a batch of 28.
describe("inviteLeadByEmail can actually create a lead", () => {
  const src = () =>
    require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "skool-invite-dispatch.ts"),
      "utf8",
    );

  it("supplies last_name, which the table requires", () => {
    const s = src();
    const insert = s.slice(s.indexOf("inviteLeadByEmail"));
    expect(insert).toMatch(/last_name:/);
  });

  // The second bug in the same insert. signup_leads_source_check allows exactly
  // five values (021_funnel_lanes.sql); the code used "outreach_invite", which is
  // not one, so even with last_name fixed the row was still rejected.
  it("uses a source the check constraint actually allows", () => {
    const ALLOWED = ["fb_lead_form", "web_signup", "admin_manual", "affiliate_link", "import"];
    const s = src();
    const insert = s.slice(s.indexOf("inviteLeadByEmail"));
    const m = insert.match(/source:\s*"([a-z_]+)"/);
    expect(m).not.toBeNull();
    expect(ALLOWED).toContain(m![1]);
  });

  // Every NOT NULL column without a default has to appear, or the insert 400s.
  it("still sets the columns the row cannot be written without", () => {
    const s = src();
    const insert = s.slice(s.indexOf("inviteLeadByEmail"));
    for (const col of ["first_name:", "last_name:", "email", "lane:", "source:", "status:"]) {
      expect(insert).toContain(col);
    }
  });
});
