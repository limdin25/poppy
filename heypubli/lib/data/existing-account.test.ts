import { describe, it, expect, vi, beforeEach } from "vitest";

// THE SIGNUP LOOP.
//
// 07 Aug 2026. Edelyn signed up at 08:33 and her Instagram connected fine. Half
// an hour later she messaged "I've tried signing up, it's not allowing me to".
// Her screenshot showed her back on the signup wizard's connect step, in the
// WhatsApp in-app browser, reading "Could not sign in with Instagram. Please
// try again."
//
// She was repeating a signup she did not need. The account already existed, the
// Instagram was already linked, and the only thing waiting for her was the
// Skool invite on /onboarding. Nothing on that error screen told her any of
// that, so the honest reading of the page was "try again", forever.
//
// Every connect failure now asks: do we already know this person? If so they
// are sent to sign in rather than told to try again.

const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => maybeSingle() }),
      }),
    }),
  }),
}));

import { accountExistsForEmail } from "./existing-account";

beforeEach(() => maybeSingle.mockReset());

describe("accountExistsForEmail", () => {
  it("says yes when a profile already exists", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "prof-1" }, error: null });
    expect(await accountExistsForEmail("edelyn@example.com")).toBe(true);
  });

  it("says no for somebody genuinely new", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await accountExistsForEmail("brand.new@example.com")).toBe(false);
  });

  // A synthetic Instagram address is never a person's real identity, so it can
  // never prove an account belongs to them.
  it("refuses synthetic Instagram addresses", async () => {
    expect(await accountExistsForEmail("ig_123@instagram.heypubli.com")).toBe(false);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("ignores empty input without hitting the database", async () => {
    expect(await accountExistsForEmail("")).toBe(false);
    expect(await accountExistsForEmail(undefined)).toBe(false);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  // Fails to FALSE. Wrongly telling a new creator they already have an account
  // is a dead end with no way out; wrongly showing the retry screen is merely
  // the old behaviour.
  it("says no when the lookup errors, never a confident yes", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "db down" } });
    expect(await accountExistsForEmail("someone@example.com")).toBe(false);
  });
});
