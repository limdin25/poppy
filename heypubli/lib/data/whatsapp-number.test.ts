import { describe, it, expect } from "vitest";
import { normaliseWhatsapp } from "./whatsapp-number";

// TWO OF THE FIRST THREE REAL SIGNUPS TYPED A NUMBER WE COULD NOT REACH.
//
//   07 Aug 2026, Bhupender  : typed +919053196105, one digit out from the
//                             +919053296105 he had been messaging us from.
//   07 Aug 2026, Discipline X: typed +88001306661213, which is +880 followed by
//                             the local leading zero. Not a real number.
//
// Both were corrected by hand. The form's only rule was "at least 10 digits",
// which happily accepts both. Everything downstream, every onboarding nudge,
// then messages a stranger or nobody at all.
//
// This does not try to prove a number is alive, that needs a paid network
// lookup. It fixes the shapes people actually get wrong.

describe("normaliseWhatsapp", () => {
  // The single most common mistake in every country that writes local numbers
  // with a leading zero: keeping the zero after the country code.
  it.each([
    ["+880 01306661213", "+8801306661213"],
    ["+8801306661213", "+8801306661213"],
    ["+44 07344913470", "+447344913470"],
    ["+63 09154288063", "+639154288063"],
    ["+91 09053296105", "+919053296105"],
  ])("strips the trunk zero: %s -> %s", (input, expected) => {
    expect(normaliseWhatsapp(input).e164).toBe(expected);
  });

  it("keeps a correct number untouched", () => {
    expect(normaliseWhatsapp("+639154288063").e164).toBe("+639154288063");
    expect(normaliseWhatsapp("+639154288063").ok).toBe(true);
  });

  it("tidies spaces, dashes and brackets", () => {
    expect(normaliseWhatsapp("+880 (130) 666-1213").e164).toBe("+8801306661213");
  });

  it("adds the missing plus", () => {
    expect(normaliseWhatsapp("639154288063").e164).toBe("+639154288063");
  });

  // Length rules, per E.164: a subscriber number is never longer than 15
  // digits, and nothing real is shorter than 8.
  it.each(["+1234", "12345", "+8801306661213999999"])("rejects %s", (bad) => {
    expect(normaliseWhatsapp(bad).ok).toBe(false);
  });

  it("rejects empty and rubbish", () => {
    expect(normaliseWhatsapp("").ok).toBe(false);
    expect(normaliseWhatsapp("not a number").ok).toBe(false);
  });

  // The point of the whole exercise: tell the caller when we CHANGED something,
  // so the UI can show the corrected number back and let them confirm it rather
  // than silently storing a guess.
  it("reports when it had to correct the number", () => {
    expect(normaliseWhatsapp("+88001306661213").corrected).toBe(true);
    expect(normaliseWhatsapp("+8801306661213").corrected).toBe(false);
  });
});
