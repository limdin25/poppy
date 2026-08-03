# ig-login

Instagram sign-in, plus the whole sign-up wizard that leads into it.

Instagram is the **only** way to sign up and sign in. Everything here ends at the public
route `/api/auth/instagram/start`, which redirects to Outstand's managed Instagram OAuth
(Outstand's own Meta app, so no Meta App Review needed). The callback at
`/auth/outstand/callback` then creates or logs in the influencer.

## Public API

- `IgLoginButton`: `<IgLoginButton label?="..." />`, the plain sign-in link.
- `IgSignupForm`: `<IgSignupForm defaults?={...} />`, the four-screen sign-up wizard.
- `ConnectInstagramStep`: screen four on its own (the wizard composes it).
- `TermsContent`: the Terms body, shared with `/terms`.
- `igLoginCopy`, `signupStepsCopy`, `signupWizardCopy`, `connectInstagramCopy`,
  `signupMobilePitch`.

## The sign-up wizard

Four screens inside **one** `<form method="POST" action="/api/auth/instagram/start">`:

| Screen | Question                          |
| ------ | --------------------------------- |
| 1      | First name + last name            |
| 2      | Email                             |
| 3      | Mobile number                     |
| 4      | Connect your Instagram            |

Screen four explains the deal in three steps (connect your account, we post viral content
that sells, you earn cash and affiliate commission) before it asks for the account.

### Things that will break if you change them

- **Every screen stays mounted.** Inactive ones carry the `hidden` attribute rather than
  unmounting, because an unmounted `<input>` is not in the submitted body and the callback
  cannot build the account without all four values. `IgSignupForm.test.tsx` guards this.
- **The posted field is still `whatsapp`.** Only the visible label changed to Mobile. The
  server schema (`schemas/profile.ts`), the signup cookie and the `profiles` column all
  still say whatsapp.
- **Enter is intercepted on screens 1 to 3.** Without that the browser posts a half-empty
  form from screen one and the server bounces it straight back.
- **The sticky CTA on screen four needs `z-20`.** The journey nodes are `z-10` and would
  otherwise paint straight through the bar.
- Complete `defaults` (a bounced Instagram round-trip, read from the signup cookie) open
  the wizard on screen four, not screen one.

## Notes

- Requires a **Professional** Instagram account (Creator or Business).
- Instagram returns no email, so users who arrive by the plain sign-in route are sent to
  `/welcome` to give us their email + mobile once (see the `contact-capture` feature).
