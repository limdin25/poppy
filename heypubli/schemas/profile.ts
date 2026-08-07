import { z } from "zod/v4";

export const genderEnum = z.enum(["male", "female", "non_binary", "undisclosed"]);

export const signupSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.email("Invalid email"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Z]/, "Needs an uppercase letter")
    .regex(/[a-z]/, "Needs a lowercase letter")
    .regex(/[0-9]/, "Needs a number")
    .regex(/[^A-Za-z0-9]/, "Needs a special character"),
  accept_terms: z.literal(true, {
    error: "You must accept the terms",
  }),
});

export const personalProfileSchema = z.object({
  date_of_birth: z.string().min(1, "Date of birth is required"),
  gender: genderEnum,
  address_street: z.string().min(1, "Street is required"),
  address_city: z.string().min(1, "City is required"),
  address_postal_code: z.string().min(1, "Postal code is required"),
  address_country: z.string().default("BR"),
  phone: z.string().min(1, "Mobile number is required"),
});

// Captured once, right after the first Instagram login (Instagram gives us no email).
export const contactSchema = z.object({
  email: z.email("Invalid email"),
  whatsapp: z.string().trim().min(10, "Enter a valid WhatsApp number with area code"),
});

// Collected on /signup BEFORE the influencer is sent to Instagram.
export const igSignupSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required"),
  last_name: z.string().trim().min(1, "Last name is required"),
  email: z.email("Invalid email"),
  whatsapp: z.string().trim().min(10, "Enter a valid WhatsApp number with area code"),
  // The tracked signup code (?u= on the link we message out): first characters
  // of the lead's id, same token the watch page uses. Anything malformed
  // becomes undefined, because attribution must never block a signup.
  lead_code: z.preprocess(
    (v) => (typeof v === "string" && /^[0-9a-f]{4,12}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined),
    z.string().optional(),
  ),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type PersonalProfileInput = z.infer<typeof personalProfileSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type IgSignupInput = z.infer<typeof igSignupSchema>;
