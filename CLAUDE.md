# Elsie — working agreement

## What is Elsie

AI Receptionist SaaS for UK service businesses. Handles inbound calls, books appointments, sends confirmations via WhatsApp/email — all without human staff.

---

## Hugo never does manual work

Non-negotiable.

| Kind of task | Who does it |
|---|---|
| Terminal, filesystem, code edits, git, npm, tests | **Claude runs it** — no asking. Routine ops (restart dev server, run tests, commit, push) are pre-approved. Stop only for destructive or shared-state actions. |
| Web dashboards (Supabase, Vercel, Stripe, Retell, Twilio, Unipile, Resend) | **Comet does it** — Claude writes a self-contained Comet prompt, Hugo pastes it. |
| Pasting credentials Comet returns | Hugo. That's the only manual thing he does. |

---

## Stack

- **Frontend**: React 19 + Vite + TypeScript + Tailwind v3 + Radix UI
- **Backend/DB**: Supabase (Postgres + Auth + Realtime)
- **Hosting**: Vercel (frontend + serverless `api/*` routes)
- **Voice**: Retell AI + Twilio (inbound/outbound calls)
- **Messaging**: Unipile (WhatsApp + Email channel)
- **AI brain**: Claude Sonnet 4.6
- **Billing**: Stripe
- **Transactional email**: Resend
- **Dev server**: `npm run dev` (port 5174)

---

## Architecture rules

### Feature-module pattern
```
src/features/{name}/   — self-contained feature folders
src/core/              — shared code (UI primitives, hooks, utils)
src/integrations/{name}/ — one wrapper per third-party service
```

- Features NEVER import other features. Cross-feature code goes in `src/core/`.
- Each third-party gets a single wrapper in `src/integrations/{name}/`.
- Modularity is critical: never break one thing when fixing another.

### Mobile-first
Every component designed for mobile first, then scales up.

---

## Hard rules

1. Read the file before editing it. Never guess at code you haven't opened.
2. Never use `sed` to edit .tsx/.ts files — use proper Edit tools.
3. Never touch `vite.config.ts` without asking Hugo first.
4. Destructive actions (delete, drop, force push, rm -rf) — STOP and ask Hugo.
5. Zero TypeScript errors — always.
6. No hardcoded secrets — env vars only.
7. Never add features Hugo didn't ask for.
8. Keep responses short. Hugo can read the diff.
9. No filler phrases ("Great question!", "Certainly!").
10. When something breaks: what broke, why, what you're doing to fix it — one sentence each.

---

## Test loop (run before every commit)

```bash
npx tsc --noEmit && npx vitest run
```

---

## How to write a Comet prompt

Comet is less capable than the main Claude. Always:

1. Give the **exact URL** to open.
2. Reference buttons by their **visible label**.
3. Spell out every field value.
4. Tell Comet exactly **which values to report back** to Hugo, verbatim, no truncation.
5. Mark secrets ("this key is SECRET — don't summarise").
6. End with "Report ..." so Comet knows what to send back.

Each prompt should be a single fenced code block, ready to paste. Use `{{NAME}}` for placeholders and tell Hugo plainly what to substitute.

---

## Living docs

Keep these current as we go:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)
- [docs/BUILD_PHASES.md](docs/BUILD_PHASES.md)
- [docs/DECISIONS_LOG.md](docs/DECISIONS_LOG.md)

---

## Credentials

All API keys, tokens, and login credentials are stored in Claude Code memory at `~/.claude/projects/`. Check memory BEFORE asking Hugo for any credential. If a credential is missing from memory, ask Hugo once, then save it immediately.

---

## Current state (2026-05-03)

- Supabase project live: `loggyxryrhqsbtqpteog` (EU West 2)
- Migrations applied: init, admin, email_subject, enable_realtime, conversation_spam, add_video_content_type
- 14 user tables + 4 admin tables + RLS + 10 feature flags seeded
- `.env` configured with real Supabase keys
- AuthProvider + ProtectedRoute wired — login/register use real Supabase Auth
- All 7 user pages wired to real Supabase queries (no more mock data)
- Admin pages still use mock data (to be wired separately)
- Data hooks: useCalls, useContacts, useConversations, useMessages, useAppointments, useQuotes, useInvoices, useBusiness
- **Deployed to Vercel**: `https://app.heyelsie.com` (demo: `demo@poppy.ai` / `demo1234`)
- **Unipile WhatsApp integration live**: webhook + polling, 8 API routes (connect, webhook, send, poll, compose, attachment, approve, rewrite)
- **AI auto-reply**: Claude Sonnet 4.6 (switched from OpenAI gpt-4o-mini)
- **Media support**: images, audio, video, files — downloaded from Unipile → Supabase Storage → rendered in inbox
- **Reactions**: synced from Unipile, displayed as badges below message bubbles
- **Realtime**: enabled on conversations + messages tables
- Vercel env vars set: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UNIPILE_TOKEN, UNIPILE_DSN, UNIPILE_WEBHOOK_SECRET, ANTHROPIC_API_KEY, APP_URL, RETELL_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, CRON_SECRET
- **Deploy method**: Vercel CLI with `.git` hide trick and `--token` flag (project linked to different repo than git remote)
- **Onboarding persistence**: saves services, FAQs, greeting, call info fields to Supabase on each step
- **Email channel**: polling + webhook both handle email (GOOGLE/MICROSOFT accounts via Unipile)
- **Cron job**: Vercel cron hits `/api/messages/poll` every minute (CRON_SECRET set)
- **Retell AI + Twilio voice integration live**:
  - Agent: `agent_adb8cb0848bc2d3b3a4551933e`, LLM: `llm_c2071f7699e2fb91f68f49957bdf`
  - Voice: `retell-Willa` (British female), Language: `en-GB`
  - Phone: `+447426495169` (imported via SIP trunk)
  - Webhook: `https://app.heyelsie.com/api/webhooks/retell` (call_ended + call_analyzed)
  - Transcript extraction via Claude Sonnet, contact creation, call records
  - Agent setup page wired: voice selection saves to Retell API, sync-prompt rebuilds LLM prompt from business data

- **Stripe billing live**:
  - Product: `prod_USeJwGZ6Uyh9Sg` (Elsie AI Receptionist)
  - Prices: Starter £49 (`price_1TTj1DLdAEhwWg6w9uuBcjJl`), Professional £99 (`price_1TTj1DLdAEhwWg6wERoybYsY`), Business £199 (`price_1TTj1DLdAEhwWg6w2l8IOzJ9`)
  - Webhook: `we_1TTj28LdAEhwWg6wraqzHzdd` → updates plan + billing_status
  - Shared Stripe account with Lemlin (`acct_1M9GXPLdAEhwWg6w`)
- **Admin pages**: fully wired to real Supabase via `/api/admin/*` routes
- **Build errors fixed**: all API route imports use `.js` extensions for Vercel node16 compat
- **BRRR property qualifier live (2026-06-10)** — see [docs/BRRR_QUALIFIER_PLAN.md](docs/BRRR_QUALIFIER_PLAN.md):
  - Rightmove scraper (`/Users/hugo/Whats/Margarita/scraper`) has a "Send to Elsie" button on the Comps tab → `POST /api/properties/ingest` (secret: `PROPERTY_INGEST_SECRET`, scraper keeps it in `data/elsie.json`)
  - Tables `brrr_properties` + `brrr_property_calls` (admin-only, no RLS)
  - Admin tab **BRRR → Properties** (`/admin/properties`): numbers, floor plans, "Call agent" button, transcript/recording viewer
  - Outbound qualifier agent: `agent_539daa8b3bedf3d3de876276a2` / LLM `llm_3da4d9ae0e456b8498b09b000b3e` (cartesia-Willa, en-GB, press_digit IVR tool, honest-AI "Maya from Airbrick Properties"). NO agents-table row on purpose (sync-prompts would clobber it)
  - Dial cron `/api/cron/process-property-calls` every 2 min: UK-hours guard (Mon–Sat 09:30–17:00), atomic claim, max 2 dials/run, 3 attempts, calls from `+447426495169`
  - Retell webhook branches on `metadata.type === 'brrr_property'` → Claude extracts qualification → qualified properties become deals in Hugo's live pipeline (stage "Qualified") + email notification
  - Env: `PROPERTY_INGEST_SECRET`, `RETELL_PROPERTY_AGENT_ID`, `PROPERTY_FROM_NUMBER`, `PROPERTY_PIPELINE_BUSINESS_ID`

### What's next
1. Custom domain
2. Wire agent setup "Save" to sync prompt to Retell (services, FAQs, greeting, behaviour changes)
3. Test live call end-to-end
4. Google Places API for business address autocomplete

---

## Identity — do not confuse with other projects

This is **Elsie** (formerly Poppy), not Lemlin. Never reference Lemlin, instagrapi, iProyal, GHL, Fly.io workers, or any Lemlin-specific concepts. Hugo runs multiple projects — keep them separate.
