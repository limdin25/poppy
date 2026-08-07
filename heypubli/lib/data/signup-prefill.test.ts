import { describe, it, expect } from "vitest";
import { prefillWhatsappFromLink } from "./signup-prefill";

// Hugo, 07 Aug 2026: "how can numbers be wrong if they whatsapp us first, it
// makes no sense".
//
// He is right, and the cause is a design flaw rather than clumsy creators. The
// signup link we send over WhatsApp is a bare heypubli.com/signup. It carries
// no identity, so the page cannot know who opened it and has to ask for the
// mobile number from scratch, on a phone keyboard, when the number is sitting
// right there in the conversation they are reading the link in.
//
// Two of the first three signups typed it wrong:
//   Bhupender    +919053196105  (one digit out)
//   Discipline X +88001306661213 (country code plus the local trunk zero)
//
// So the link now carries ?w=<digits> and the box arrives already filled with
// the number they actually message us from.

describe("prefillWhatsappFromLink", () => {
  it("fills the box from the number in the link", () => {
    expect(prefillWhatsappFromLink("8801306661213")).toBe("+8801306661213");
  });

  it("accepts a leading plus that survived the URL", () => {
    expect(prefillWhatsappFromLink("+639154288063")).toBe("+639154288063");
  });

  // It runs the same normaliser as the form, so a link we build wrongly still
  // cannot put a broken number in front of a creator.
  it("corrects a trunk zero even if our own link carries one", () => {
    expect(prefillWhatsappFromLink("88001306661213")).toBe("+8801306661213");
  });

  it("ignores rubbish rather than prefilling nonsense", () => {
    expect(prefillWhatsappFromLink("abc")).toBe("");
    expect(prefillWhatsappFromLink("123")).toBe("");
    expect(prefillWhatsappFromLink(undefined)).toBe("");
    expect(prefillWhatsappFromLink("")).toBe("");
  });

  // A prefill must never be able to inject markup or a second parameter.
  it("refuses anything that is not digits", () => {
    expect(prefillWhatsappFromLink("<script>alert(1)</script>")).toBe("");
    expect(prefillWhatsappFromLink("8801306661213&x=1")).toBe("");
  });
});
