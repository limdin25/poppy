import { describe, it, expect } from "vitest";
import { contactSchema } from "./profile";

describe("contactSchema", () => {
  it("accepts a valid email + WhatsApp", () => {
    const r = contactSchema.safeParse({
      email: "ana@gmail.com",
      whatsapp: "11999998888",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const r = contactSchema.safeParse({ email: "nope", whatsapp: "11999998888" });
    expect(r.success).toBe(false);
  });

  it("rejects a WhatsApp that is too short", () => {
    const r = contactSchema.safeParse({ email: "ana@gmail.com", whatsapp: "123" });
    expect(r.success).toBe(false);
  });
});
