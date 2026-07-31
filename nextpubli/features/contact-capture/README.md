# contact-capture

One-time email + WhatsApp capture shown right after a new influencer's first Instagram
login. Instagram never gives us an email, and NextPubli needs a contactable address to
send campaign updates and pay commissions — so a fresh account is flagged
`needs_contact = true` and the middleware routes it to `/bem-vindo` until this form is
submitted.

## Public API

- `ContactCaptureForm` — renders the heading + email/WhatsApp form. Submits via the
  `saveContactInfo` server action (`lib/actions/profile.ts`), which validates with
  `contactSchema`, saves to `profiles`, clears `needs_contact`, and redirects to
  `/onboarding`.
