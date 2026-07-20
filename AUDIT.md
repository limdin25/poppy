# AUDIT.md — HeyElsie Reviews, Phase 0 repo & access audit

Date: 2026-07-20. Produced by a 13-agent research pass over the full repo, live credential checks, Zernio docs, Review Harvest public + logged-in surfaces, and UK compliance sources. Companion docs: [REVIEWHARVEST_MAP.md](REVIEWHARVEST_MAP.md), [PLAN.md](PLAN.md), [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Access verification (live API calls, 2026-07-20)

| Service | Status | Detail |
|---|---|---|
| Supabase REST | ✅ OK | Project `loggyxryrhqsbtqpteog`, service-role key valid (134 REST paths) |
| Supabase SQL (pooler) | ✅ OK | `select count(*) from businesses` → 8. **We can run migrations.** |
| Vercel | ✅ OK | Token valid (account hugo@nfstay.com) |
| Twilio (Elsie acct) | ✅ OK | Account active. Fleet account untouched. |
| Stripe | ✅ OK | Live shared Lemlin account `acct_1M9GXPLdAEhwWg6w` |
| Resend | ✅ OK | `heyelsie.com` verified (mail.heyelsie.com partially_failed — unused) |
| Anthropic | ✅ OK | Models list returned |
| Cloudflare | ✅ OK | heyelsie.com zone active, DNS-edit token works |
| **Unipile** | ❌ **401** | Token rejected AND byte-identical to the one on Vercel prod → **production WhatsApp/email sync is likely broken right now.** Needs a new key from dashboard.unipile.com. |
| Zernio | ✅ OK | Provided key valid (`GET /v1/profiles` → 200). 1 profile, **0 connected accounts**, free tier (60 req/min). |
| Google Places / OpenAI / Tavily | ✅ | Keys present in memory (not called) |

## 2. Repo shape (what exists)

One Vite/React 19 SPA + Vercel serverless `api/` serving **two hosts from one deploy**: `heyelsie.com` (marketing landing, `src/features/landing/LandingPage.tsx`) and `app.heyelsie.com` (product). 24 live feature modules in `src/features/`, thin per-vendor wrappers in `src/integrations/` (unipile, twilio, resend, retell, stripe, openai, tavily, calcom, supabase), ~105 Supabase tables across three domains:

- **Elsie multi-tenant SaaS** (~33 tables): `businesses`, `channels`, `contacts`, `conversations`, `messages`, `calls`, `appointments`, `quotes`, `invoices`, `campaigns`, `agents`, `deals`… all RLS-scoped by `business_id IN (SELECT user_business_ids())`.
- **Admin/platform** (no RLS, service-role via `/api/admin/*`): `admin_users`, `feature_flags`, `platform_settings`, BRRR tables, CEO-cockpit `agent_*` tables.
- **CRM (`wk_*`, ~45 tables)**: the ported NFStay call-centre — single-workspace, **no business_id anywhere**, own edge functions (36 in `supabase/functions/`), own guards.

Deploy: manual Vercel CLI with the `.git`-hide trick (project linked to a different repo). **Prod = last CLI deploy, not git.** Branch `crm-clone` is 38+ commits ahead of origin and never pushed; prod runs some uncommitted code (VM drop). 16 Vercel crons already registered (5 every-minute).

## 3. Reusable for the reviews product (the good news)

| Need | What exists | Where |
|---|---|---|
| Multi-tenancy + client dashboards | `businesses` + `team_members` + RLS pattern + feature flags (`simple_portal` precedent = slim client portal) | `supabase/migrations/20260501000001_init.sql`, `src/core/auth/` |
| Admin super-view | `/super/*` **already aliases the full admin panel** (`src/app/App.tsx`) | `src/features/admin/` |
| Impersonation ("view as user") | Works client-side end-to-end (AuthProvider businessId swap + RLS admin union + banners). Gap: server API routes ignore it (§4) | `src/core/auth/AuthProvider.tsx` |
| SMS sending | Edge-safe Twilio wrapper `sendSMS`; hardened bulk pattern (throttled queue, kill switch, daily cap, do-not-text exclusion) in CRM `wk-sms-broadcast`/`wk_jobs` | `src/integrations/twilio/client.ts`, `supabase/functions/wk-*` |
| STOP/opt-out handling | Exists once, done right (fail-closed Twilio signature check, STOP regex → do-not-text tag, idempotent) — **but only on the CRM side**; copy the pattern | `supabase/functions/wk-sms-incoming/` |
| Twilio number purchase | Code exists, dormant, zero callers (`searchNumbers`, `provisionNumber`, `releaseNumber`) — needs a route + SmsUrl wiring | `src/integrations/twilio/client.ts` |
| Email sending | Resend wrapper + verified heyelsie.com domain + threaded replies + inbound webhook | `src/integrations/resend/client.ts` |
| WhatsApp | Unipile per-client connect (hosted QR), `sendToChat` to any phone, campaign blast w/ `{name}` templating (⚠ token dead, ⚠ ToS risk for bulk — see PLAN) | `api/channels/whatsapp/`, `api/campaigns/` |
| CSV contact upload | 5000-row normalised import | `api/contacts/import.ts` |
| AI drafting | `callLLM` (claude-sonnet-4-6, per-business model override) + **three** proven draft-then-approve implementations | `api/lib/llm.ts`, `api/messages/approve.ts`, `wk-draft-action`, `agent_approvals` |
| Google OAuth pattern | Calendar connect/callback (GCP project poppy-495417) — template only; **Zernio replaces the need for our own GBP OAuth** | `api/calendar/connect.ts` |
| `google_place_id` | Already a column on `businesses` since day 1, unused | init migration |
| Stripe subscriptions | Checkout + webhook → `businesses.plan/billing_status`, customer portal, payment-link-able prices | `api/billing/`, `api/webhooks/stripe.ts` |
| Cron/queue pattern | CRON_SECRET crons + atomic claim (`FOR UPDATE SKIP LOCKED` RPC) + backoff/reaper | `api/agent/tick.ts`, `vercel.json` |
| Dashboard aggregates | SECURITY DEFINER `analytics_*` RPC pattern | migration 20260507000003 |
| Scheduled sends | `appointment_notifications` queue + cron sender; `scheduled_followups` | migrations 20260508000005, 20260604000000 |
| Weekly digest email | Daily-summary cron precedent | `api/notifications/daily-summary.ts` |
| E2E testing | Playwright (21 specs, auth storageState, self-healing locators) + vitest (34 unit files) | `tests/e2e/`, `playwright.config.ts` |
| CRM as sales tool | Pipelines/columns/automations are data-driven (a "Reviews" sales pipeline = zero code); dialer + VM drop + broadcasts for outbound selling | `src/features/crm/` |

## 4. Gaps (what must be built or fixed)

1. **No review domain anywhere**: no GBP integration, no review tables, no request lifecycle, no review-link storage, no click tracking. All net-new (by design — Zernio fills the Google side).
2. **No image rendering**: `sharp` and `canvas` both absent. Personalized-image requests need a new dependency + a Node-runtime function. **UK nuance: Twilio UK long codes can't do true MMS** — the image must travel as a link (SMS), or embedded (email/WhatsApp).
3. **No per-contact opt-out on the Elsie side**: `contacts` has no `opted_out` concept; the Elsie inbound-SMS webhook (`api/webhooks/twilio-sms.ts`, untracked) has **no STOP handling and no Twilio signature validation**. Compliance requires a tenant-scoped, cross-channel suppression list built FIRST.
4. **go.heyelsie.com**: zero references. Needs Cloudflare DNS + Vercel domain + a host branch in `RootEntry` (pattern exists).
5. **Server-side impersonation gap**: `api/lib/auth.ts requireAuth` resolves businessId from the *admin's own* membership, so API-mediated actions during "view as client" hit the wrong business. Must fix for a usable super-view.
6. **One-business-per-user assumption** in AuthProvider/requireAuth (`.limit(1).single()`) — fine for v1, blocks agencies/multi-location later.
7. **No SMS delivery-status callbacks** (no StatusCallback anywhere) — needed for honest dashboard numbers.
8. **No request-volume metering** — tier caps (50/100/300 requests/mo) need per-business monthly counting + pause-at-cap + Stripe upgrade path.
9. **Onboarding has no completion tracking**, and its current flow is receptionist-shaped; reviews onboarding is a new module.
10. **Docs drift**: `docs/DATA_MODEL.md` covers 14 of ~105 tables; `media` storage bucket exists only via dashboard (not migrations); two duplicate migration timestamps.

## 5. Risks to manage during the build

- **Two parallel SMS stacks** (Elsie `api/*` vs CRM `wk_*`). The reviews product must build on the **multi-tenant Elsie side** and only copy patterns (throttle, kill switch, STOP) from `wk_*` — never send client traffic through the CRM's number pool.
- **Unpushed/uncommitted state**: prod runs code that exists only in this working tree. Commit the WIP before branching for reviews (no push needed).
- **Shared Stripe (Lemlin) + shared Twilio account**: reviews-product disputes/carrier reputation bleed across products. Acceptable for launch, worth isolating later.
- **Every-minute cron budget**: 16 crons already; the review drip should ride ONE new cron with an internal queue, not several.
- **Admin RLS union**: any admin JWT can read/write every business — new review tables inherit this (fine, but stated).
- **Realtime under RLS** needs `REPLICA IDENTITY FULL` (bit the project once).
- **WhatsApp-via-Unipile for bulk review requests violates WhatsApp ToS** (ban risk). SMS+email are the primary channels; WhatsApp is best-effort, low-volume, human-paced (see PLAN §compliance).
- **Twilio geo-permissions are console-only** (error 21408). UK is enabled; any new country needs a console tick first.

## 6. Verdict

~70% of the plumbing already exists (tenancy, sending rails, AI drafting, billing, admin, impersonation, e2e harness). The genuinely new work is: the Zernio integration, the review-request engine + suppression/compliance layer, the personalized-image renderer, the client dashboard + reviews onboarding on go.heyelsie.com, request metering against Stripe tiers, and the landing page rebuild. Nothing found blocks the build. Full build plan: [PLAN.md](PLAN.md).
