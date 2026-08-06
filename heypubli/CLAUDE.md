# NextPubli — Claude Code Rules

@AGENTS.md

## About this project

**NextPubli** is a Portuguese-language micro-influencer management platform for Brazil.
Influencers sign up, connect Instagram, and we auto-publish content on their feed/stories
for partner brands. They earn 30% recurring commission per sale via their Hotmart affiliate
link. Admin has full control: schedule posts, manage brands, message influencers, track
sales.

Domain: nextpubli.com | Stack: Next.js 16 + Supabase + Vercel Cron + Meta Graph API

## User context

Hugo is the owner — **non-technical**. Never assume he knows what a terminal, CLI flag, or
API does. Keep responses short — he can read the diff. Never ask Hugo for credentials —
they are all stored in Claude Code memory.

## TDD — Non-negotiable

1. **Write the test FIRST.** Run it and see it FAIL.
2. **Then write the code.** Run the test and see it PASS.
3. **No exceptions.** Every feature, every component, every utility.
4. Unit tests: Vitest + Testing Library. E2E tests: Playwright.
5. Never claim something works without a passing test.

## Read docs before coding — Non-negotiable

Before implementing ANY integration, you MUST fetch and read the official documentation
URL first. Never guess at API shapes, auth flows, or request formats.

| Service                    | Documentation URL                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Supabase                   | https://supabase.com/docs                                                                  |
| Meta Graph API (Instagram) | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login |
| Hotmart API                | https://developers.hotmart.com/docs                                                        |
| Unipile (WhatsApp)         | https://developer.unipile.com/docs/whatsapp                                                |
| Resend (Email)             | https://resend.com/docs                                                                    |
| Vercel Cron Jobs           | https://vercel.com/docs/cron-jobs                                                          |
| Next.js 16                 | https://nextjs.org/docs                                                                    |

## Stack

- Next.js 16 (App Router, RSC) + TypeScript strict + React 19
- Tailwind v4 (CSS-first — no `tailwind.config.ts`, tokens live in `app/globals.css`)
- Supabase (Auth + Postgres + Storage + Realtime + Edge Functions)
- Lucide icons, react-hook-form + zod, Framer Motion, Recharts, date-fns
- Vitest + Testing Library (unit) + Playwright (e2e)
- Prettier + ESLint 9 flat config + eslint-plugin-boundaries
- Husky + lint-staged pre-commit

## Commands

```bash
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm test             # Run Vitest tests
pnpm exec tsc --noEmit # TypeScript check (must pass before commit)
pnpm exec eslint .    # Lint check (must pass before commit)
pnpm exec playwright test # E2E tests
pnpm format           # Prettier format
```

## Modular architecture rules (hard)

1. **Every visual concept = its own folder** under `features/<kebab-case>/`.
   A feature's only public export is `index.ts`. Nothing outside the feature
   may import from its internals.
2. **No cross-feature imports.** If `features/A` needs something from
   `features/B`, lift it to `app/...page.tsx` and compose there.
3. **Zone edges** (enforced by eslint-plugin-boundaries):
   - `app/*` → features, components, lib, mocks, types, schemas, copy
   - `features/*` → components, lib, types, schemas, copy
   - `components/*` → lib, types
   - `lib/*` → types, schemas
   - `mocks/*` → types, schemas
4. **Every feature folder has a README.md** (see `docs/ADDING-A-FEATURE.md`).
5. **Portuguese copy lives in per-feature `copy.ts`.** Global strings in `copy/pt-BR/global.ts`.
6. **Mock data**: per-feature `mock.ts` for tests; canonical dataset in `/mocks/*.mock.ts`.

## PT-BR copy rules

- Always use `você` (not `tu`)
- Imperative CTAs: "Pegue seu link", "Conecte seu Instagram"
- Never use "Bloqueado" — use "Desbloqueie" or "Faltam R$ X"
- All user-facing text in Portuguese (Brazil)

## Design tokens

| Element              | Color                       | Usage                             |
| -------------------- | --------------------------- | --------------------------------- |
| Background           | #FFFFFF                     | Main background                   |
| Background secondary | #F9FAFB                     | Cards, content areas              |
| Accent primary       | #E1306C                     | Buttons, highlights, active icons |
| Accent gradient      | #F56040 → #E1306C → #C13584 | Headers, badges, special CTAs     |
| Text primary         | #1A1A1A                     | Titles, important text            |
| Text secondary       | #6B7280                     | Descriptions, labels              |
| Borders              | #E5E7EB                     | Cards, tables, dividers           |
| Success              | #10B981                     | Connected, published, active      |
| Error                | #EF4444                     | Failed, disconnected, pending     |
| Warning              | #F59E0B                     | Scheduled, expiring, attention    |

## Database (Supabase — 10 tables)

Full schema in `docs/DATABASE-SCHEMA.md`. Tables:
`profiles`, `sectors`, `influencer_sectors`, `instagram_connections`,
`brands`, `brand_assignments`, `scheduled_posts`, `messages_log`,
`hotmart_sales`, `admin_sessions`

## Hard rules (never violate without asking Hugo)

- Never touch `eslint.config.mjs` zone edges without asking.
- Never add a new top-level folder without asking.
- Never install a new dependency without explaining why first.
- Never `git push --force` or `git reset --hard`.
- Never skip hooks with `--no-verify`.
- Always run `pnpm exec tsc --noEmit` before claiming anything is done.
- Always run `pnpm exec eslint .` before committing.
- Every new feature gets a Vitest test FIRST.
- Every new top-level route gets a Playwright smoke spec.
- Read the file before editing it. Never guess at code you haven't opened.
- Never use `sed` to edit .tsx/.ts files — use proper Edit tools.

## Phase state

- **Phase 1:** Project scaffold + all MD files + config
- **Phase 2:** Supabase database setup (10 tables + RLS + seeds)
- **Phase 3:** Auth + 6-step onboarding
- **Phase 4:** Influencer dashboard (Home, Calendar, Analytics, Settings)
- **Phase 5:** Admin dashboard (Overview, Influencers, Scheduler, Messages, Brands, Hotmart, Impersonate)
- **Phase 6:** Backend wiring (lib/data layer with Supabase queries)
- **Phase 7 (current):** Instagram integration — OAuth, publishing, token refresh, Vercel Cron

## Kimi WebBridge — Browser access

Claude Code has full browser control via Kimi WebBridge (local daemon at `http://127.0.0.1:10086`).
This means Claude can see, click, type, navigate, and screenshot any website using Hugo's real
browser sessions (logged-in cookies and all).

### How it works

- **Daemon:** `~/.kimi-webbridge/bin/kimi-webbridge` runs locally
- **Status check:** `~/.kimi-webbridge/bin/kimi-webbridge status`
- **Skill docs:** `~/.claude/skills/kimi-webbridge/SKILL.md`
- **Commands:** navigate, snapshot, click, fill, evaluate, screenshot, save_as_pdf
- **Sessions:** each task gets its own session name to keep tabs isolated

### When to use browser testing

Every feature or bug fix that has a UI component MUST be browser-tested before marking done:

1. Start the dev server (`pnpm dev`)
2. Use Kimi WebBridge to navigate to the page
3. Click through the user flow (golden path + edge cases)
4. Screenshot any issues found
5. Fix and re-test

### Pre-task login checklist — Non-negotiable

Before starting any task, tell Hugo which browser sessions you'll need so he can log in.
Present a checklist like this:

> **Hugo, before I start I'll need you logged into these in your browser:**
>
> - [ ] Supabase Dashboard (supabase.com/dashboard)
> - [ ] Vercel Dashboard (vercel.com)
> - [ ] Meta Developer Console (developers.facebook.com)
> - [ ] localhost:3000 (I'll start the dev server)
>
> **Once you're logged in, say "go" and I'll start working + testing.**

Common services that may need browser login:

| Service            | URL                     | When needed                        |
| ------------------ | ----------------------- | ---------------------------------- |
| Supabase Dashboard | supabase.com/dashboard  | DB changes, RLS policies, testing  |
| Vercel Dashboard   | vercel.com              | Deploy checks, env vars, logs      |
| Meta Developer     | developers.facebook.com | Instagram API, OAuth, app settings |
| Hotmart            | hotmart.com             | Affiliate/sales integration        |
| GitHub             | github.com              | PR reviews, repo settings          |
| NextPubli (prod)   | nextpubli.com           | Production smoke tests             |
| NextPubli (dev)    | localhost:3000          | Local development testing          |
| Squarespace        | squarespace.com         | If touching landing pages          |

### Browser testing workflow

```
1. Write code (feature or fix)
2. Start dev server if not running
3. kimi-webbridge status → confirm connected
4. navigate to page → snapshot → verify layout
5. click/fill through the user flow
6. screenshot results
7. Fix issues if any → re-test
8. Only then mark task as DONE
```

## Credentials

All stored in Claude Code memory at `~/.claude/projects/-Users-hugo-Whats-mypubli/memory/`.
Check memory BEFORE asking Hugo. Never ask for credentials — they are already saved.
