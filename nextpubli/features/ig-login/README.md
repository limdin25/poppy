# ig-login

The "Entrar com Instagram" / "Criar conta com Instagram" button.

Instagram is the **only** way to sign up and sign in. This button links to the public
route `/api/auth/instagram/start`, which redirects to Outstand's managed Instagram
OAuth (Outstand's own Meta app — no Meta App Review needed). The callback at
`/auth/outstand/callback` then creates or logs in the influencer.

## Public API

- `IgLoginButton` — `<IgLoginButton label?="..." />`

## Notes

- Requires a **Professional** Instagram account (Creator or Business).
- Instagram returns no email, so new users are sent to `/bem-vindo` to give us their
  email + WhatsApp once (see the `contact-capture` feature).
