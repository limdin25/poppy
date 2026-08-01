# email-signup

Email-only signup for `/signup`, used while Instagram is hidden
(`NEXT_PUBLIC_INSTAGRAM_ENABLED` unset/false — see `lib/flags.ts`).

## Flow

1. `EmailSignupForm` — name, surname, email, WhatsApp, terms. Submits to the
   `sendSignupCode` server action, which calls `supabase.auth.signInWithOtp`
   with `shouldCreateUser: true`. The `handle_new_user` DB trigger creates the
   profile (referral_tag, registration_method `email`, `needs_contact` false).
2. `SignupCodeForm` — the 8-digit code from the confirmation email, verified by
   the `verifySignupCode` server action (`verifyOtp` type `email`). On success
   the WhatsApp typed in step 1 is copied from auth metadata into the profile
   and the user lands on `/onboarding` (or `/dashboard` if already complete).

The confirmation email template (with `{{ .Token }}`) lives in Supabase Auth
settings, subject "Your code to create your NextPubli account".

## Public exports

- `EmailSignupForm`
- `SignupCodeForm` (exported for tests)
- `emailSignupCopy`
