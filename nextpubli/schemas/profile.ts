import { z } from "zod/v4";

export const genderEnum = z.enum(["male", "female", "non_binary", "undisclosed"]);

export const signupSchema = z.object({
  first_name: z.string().min(1, "Nome é obrigatório"),
  last_name: z.string().min(1, "Sobrenome é obrigatório"),
  email: z.email("Email inválido"),
  password: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Z]/, "Precisa de uma letra maiúscula")
    .regex(/[a-z]/, "Precisa de uma letra minúscula")
    .regex(/[0-9]/, "Precisa de um número")
    .regex(/[^A-Za-z0-9]/, "Precisa de um caractere especial"),
  accept_terms: z.literal(true, {
    error: "Você precisa aceitar os termos",
  }),
});

export const personalProfileSchema = z.object({
  date_of_birth: z.string().min(1, "Data de nascimento é obrigatória"),
  gender: genderEnum,
  address_street: z.string().min(1, "Rua é obrigatória"),
  address_city: z.string().min(1, "Cidade é obrigatória"),
  address_postal_code: z.string().min(1, "CEP é obrigatório"),
  address_country: z.string().default("BR"),
  phone: z.string().min(1, "Celular é obrigatório"),
});

export const hotmartLinkSchema = z.object({
  hotmart_url: z.url("URL inválida"),
});

// Captured once, right after the first Instagram login (Instagram gives us no email).
export const contactSchema = z.object({
  email: z.email("Email inválido"),
  whatsapp: z.string().trim().min(10, "Informe um WhatsApp válido com DDD"),
});

// Collected on /cadastro BEFORE the influencer is sent to Instagram.
export const igSignupSchema = z.object({
  first_name: z.string().trim().min(1, "Nome é obrigatório"),
  last_name: z.string().trim().min(1, "Sobrenome é obrigatório"),
  email: z.email("Email inválido"),
  whatsapp: z.string().trim().min(10, "Informe um WhatsApp válido com DDD"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type PersonalProfileInput = z.infer<typeof personalProfileSchema>;
export type HotmartLinkInput = z.infer<typeof hotmartLinkSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type IgSignupInput = z.infer<typeof igSignupSchema>;
