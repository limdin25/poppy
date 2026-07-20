# ARCHITECTURE.md — HeyElsie Reviews

Architecture for the reviews product (the company's main product as of 2026-07-20). The receptionist's architecture stays documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); it is untouched and hidden behind feature flags. Repo audit that grounds every choice here: [AUDIT.md](AUDIT.md).

---

## 1. Surfaces & hosts (one repo, one Vercel deploy)

| Host | What it serves | How |
|---|---|---|
| `heyelsie.com` | New reviews marketing landing (+ /privacy, /terms) | Existing host-aware `RootEntry` in `src/app/App.tsx` already branches on hostname; replace `LandingPage` content |
| `go.heyelsie.com` | **Client dashboard** + `/onboarding` (reviews onboarding wizard) | New host branch in `RootEntry` → `ReviewsApp`. DNS via Cloudflare API + domain added to the Vercel project (both tokens in memory) |
| `app.heyelsie.com` | Receptionist app (existing, flag-hidden for new signups) + **`/super`** admin | `/super/*` already aliases AdminApp today; add a Reviews section to it |

Supabase sessions are per-origin, so `go.` gets its own login (same Supabase project/auth pool). Admin impersonation into a `go.` dashboard uses a short-lived token hand-off (§7).

## 2. Feature modules (repo rules: features never import features; shared code in `src/core/`; one wrapper per vendor in `src/integrations/`)

```
src/features/reviews/            — client dashboard: stats, reviews inbox, requests, contacts, settings, billing
src/features/reviews-onboarding/ — go.heyelsie.com/onboarding wizard (10-minute setup)
src/features/landing/            — rebuilt marketing page (module exists, content replaced)
src/features/admin/…/reviews     — /super Reviews section: all clients, health, impersonate, onboard-fast
src/integrations/zernio/         — the ONLY place that talks to Zernio
api/reviews/*                    — client-facing API routes (requireAuth → businessId)
api/webhooks/zernio.ts           — review.new / review.updated receiver (HMAC-verified)
api/webhooks/twilio-reviews-sms.ts — inbound SMS for review sender numbers: signature-validated, STOP-first
api/cron/review-requests.ts      — the drip engine tick (single new cron)
api/cron/review-weekly-email.ts  — weekly stats email (weekly cron)
```

## 3. Data model (new tables — all `business_id` FK + standard 4-policy RLS unless noted)

| Table | Purpose / key columns |
|---|---|
| `gbp_connections` | One per business: `zernio_account_id`, `zernio_profile_id`, `gbp_location_id`, `place_id`, `review_url` (from Zernio location-details), `status`, `connected_at` |
| `review_campaigns` | Reactivation blast or ongoing stream: `name`, `type(reactivation/ongoing)`, `status`, counters |
| `review_requests` | **The core lifecycle row.** `contact_id`, `campaign_id`, `channel(sms/email/whatsapp)`, `status(queued→sent→delivered→followup_1→followup_2→reviewed→stopped/opted_out/failed)`, `scheduled_for`, `sent_at`, `delivered_at`, `image_url`, `twilio_sid`/`resend_id`, `counts_toward_cap` (follow-ups don't) |
| `gbp_reviews` | Cache synced from Zernio: `zernio_review_id` UNIQUE, `rating`, `comment`, `reviewer_name`, `create_time`, `reply_status(none/draft/pending_approval/posted)`, `matched_contact_id` (stop-on-review attribution) |
| `review_replies` | AI reply drafts: `gbp_review_id`, `draft`, `status(draft/approved/posted/rejected)`, `posted_at` — 4–5★ auto-post, 1–3★ held (reuses the proven draft-approve pattern) |
| `review_suppressions` | **Compliance backbone, built first.** `business_id`, `phone`/`email`, `channel('all')`, `reason(stop_keyword/manual/bounce)`, `source`, `created_at`. Checked before EVERY send, cross-channel (SMS STOP also stops WhatsApp/email) |
| `review_settings` | Per business: templates (SMS/email/WhatsApp), follow-up gaps (days), drip pace/day, quiet-hours window, auto-reply toggles, image template ref, lawful-basis attestation (`attested_by`, `attested_at`) |
| `review_image_templates` | `storage_path` (new migration-defined bucket `review-assets`), name-render config (x, y, font, size, colour) |
| `review_usage` | Monthly metering: `business_id`, `period_start`, `requests_sent` — enforces the tier cap (50/100/300), pauses at cap, prompts Stripe upgrade |
| `review_events` | Append-only funnel log (queued/sent/clicked/reviewed/replied) for dashboard + Zapier outbound webhooks |
| `zapier_webhooks` | Per business outbound hooks: `url`, `event(review.received/request.sent)` + an inbound trigger token for "job done → send request" |
| `review_widget_settings` | Per business × widget type (popup/carousel/grid): colors, position, show-names toggle — powers the editors; embeds read settings from the script-tag query string (RH pattern) |
| `review_referrals` | Referral program: referrer user, invitee email, `status(invited→signed_up→paid→rewarded)` — £100/£100 on invitee's first paid invoice, manual payout via /super for v1 |
| `support_conversations` | In-app support messenger (Intercom-lite): one per business, `status(open/closed)`, `last_message_at` |
| `support_messages` | `conversation_id`, `sender(client/team)`, `sender_user_id`, `body`, `read_at` — Realtime-enabled both directions; new inbound → Resend notification to Hugo |
| `help_articles` | In-widget help center: `title`, `subtitle`, `body` (markdown), `author_name`, `status(draft/published)`, `sort` — CRUD in /super |
| `checklist_steps` | Onboarding checklist definition (global, /super-editable): `title`, `cta_label`, `cta_route`, `help_article_id`, `sort`, `active`, `auto_complete_event` — seeded with defaults |
| `checklist_progress` | Per business × step: `completed_at`, `completed_by(user/auto)` — powers the widget Tasks view + dashboard nudge card |

Reused as-is: `contacts` (customer lists live here; CSV import exists), `businesses` (+ Stripe columns), `feature_flags` (new keys `reviews` + existing gates hide receptionist), `admin_*`.

CRM bridge (sell-side): nullable `business_id` FK on `wk_contacts` + a data-driven "Reviews" sales pipeline. When a closer converts a lead, the admin onboarding flow links the new `businesses` row back to the CRM contact — admins see every review client from the CRM.

## 4. Zernio integration (`src/integrations/zernio/client.ts`)

Base `https://zernio.com/api/v1`, `Authorization: Bearer sk_…`. Verified live 2026-07-20.

- **Connect (onboarding step)**: create one Zernio *profile* per client business → `GET /v1/connect/googlebusiness?profileId=…&redirect_url=…` → client OAuths their own Google account (scope `business.manage`) → Zernio-hosted location picker → redirect back with `accountId`. Store in `gbp_connections`; fetch `review_url`/`place_id` via `gmb-location-details`.
- **Reviews in**: subscribe webhook `review.new` + `review.updated` → `api/webhooks/zernio.ts` (verify `X-Zernio-Signature` HMAC-SHA256, dedupe on event id). No polling needed (Pub/Sub-backed). Fallback nightly reconcile via `GET gmb-reviews`.
- **Stop-on-review**: on `review.new`, first-name match (+ recency window) against contacts with active `review_requests` → mark `reviewed`, kill remaining follow-ups.
- **Reply**: `POST gmb-reviews/{reviewId}/reply` (idempotent overwrite semantics).
- **Repurpose**: 5★ → `POST /v1/posts` (`topicType STANDARD`, 1 JPEG/PNG ≤5MB, ≥400×300) with `x-request-id` idempotency.
- **Analytics**: `GET /v1/analytics/googlebusiness/performance` for the dashboard's impressions/calls/website-clicks panel.
- Caveats encoded in the wrapper: rate limits 60→600 req/min by connected-account count; reviews pageSize ≤50; no GBP sandbox (test against a real location); review webhooks require Zernio's usage-based plan.

## 5. The request engine (send pipeline)

```
CSV upload / CRM-connector / Zapier trigger
        → contacts (reused table)
        → review_requests rows (status=queued, scheduled_for staggered by drip pace)
        → api/cron/review-requests.ts (1 cron, every minute):
             claim batch (FOR UPDATE SKIP LOCKED pattern)
             guards: suppression list → tier cap (review_usage) → quiet hours (09:00–20:00 local)
                     → per-business kill switch → global kill switch
             render personalized image (sharp, Node runtime) → upload to review-assets bucket
             send: SMS (Twilio, per-client UK long code, image as link)
                   email (Resend, image embedded)
                   [WhatsApp (Unipile) optional, low-volume, human-paced — ban risk accepted per client]
             message text: Claude-personalised (callLLM), MUST contain business name + review link + opt-out line
        → Twilio StatusCallback → delivered/failed on the request row
        → follow-ups: same queue, N days later, only if not reviewed/opted out (don't count toward cap)
        → stop: Zernio review.new webhook (§4)
```

Per-client sender numbers: resurrect the dormant `searchNumbers`/`provisionNumber` Twilio code behind an admin action; wire the number's `SmsUrl` to `api/webhooks/twilio-reviews-sms.ts` at purchase time. Inbound: validate Twilio signature (fail closed), STOP/UNSUBSCRIBE/etc → `review_suppressions` + confirmation, everything else threads into the client's message view.

## 6. Compliance enforcement (in code, not guidance)

- **Send-to-all is the only mode** — no sentiment pre-screen exists anywhere (Google policy + UK DMCC: gating is illegal and the *platform* is liable as facilitator).
- **STOP first**: suppression checked before every send; STOP on any channel suppresses all channels.
- Template builder **hard-requires** business name + opt-out line; **blocks incentive words** (free/discount/prize/voucher).
- Onboarding captures the client's **PECR soft-opt-in attestation** (customers came from real transactions, opt-out offered) — stored with timestamp + user.
- UK long codes only for SMS (alphanumeric senders can't receive STOP).
- Quiet hours default 09:00–20:00 recipient-local; queued outside the window.
- No AI ever writes a *review*; AI only writes requests and *reply* drafts.

## 7. Admin `/super` + CRM

- `/super/reviews`: every client, MRR, requests used vs cap, reviews gained, GBP connection health, reply-approval queue depth; **onboard-a-client wizard** (closer sells on phone → admin creates account, sends Stripe payment link, runs onboarding on the client's behalf).
- **Impersonation**: reuse client-side mechanism + fix the server gap — impersonation header on API calls, validated against `admin_users`, audit-logged via the existing (currently orphaned) `impersonate.ts` endpoint. Cross-origin into `go.heyelsie.com`: short-lived token hand-off link.
- **CRM**: `wk_contacts.business_id` bridge + "Reviews" pipeline (data-driven, no code) so the sell → onboard → live-client chain is visible in one place.

## 8. Billing (canonical pricing — Hugo, 2026-07-20)

| Tier | Requests/mo | Price | Trial |
|---|---|---|---|
| Starter | up to 50 | £99/mo | 14-day free, card on file |
| Growth ⭐ Popular | 50–100 | £179/mo | 14-day free, card on file |
| Pro | 100–300 | £279/mo | 14-day free, card on file |

Identical features on all tiers; volume is the only differentiator. Three new Stripe products + prices (GBP, `trial_period_days: 14`, card required) + one **payment link per tier** for closers. Webhook extends the existing `PRICE_TO_PLAN` map → `businesses.plan`. Cap enforcement in the send cron via `review_usage`; at cap → pause + in-app upgrade prompt → self-serve upgrade (Stripe portal/checkout with proration). "Request" = one review request to one contact (SMS or email each count as one; follow-ups don't). No free tier, no enterprise tier.

## 9. Receptionist co-existence

- New flag key `reviews` gates the reviews UI; new signups from go.heyelsie.com get `reviews` ON and receptionist flags OFF (same mechanism as `simple_portal`).
- Receptionist nav/routes stay gated by their existing flags (`voice_ai` etc.) — no receptionist code is deleted or modified beyond nav conditionals in `Layout.tsx`.
- Existing receptionist clients see zero change.

## 10. Testing & rollout gates

- `npx tsc --noEmit && npx vitest run` before every commit (unit: suppression logic, cap metering, image render, template lint, webhook signature/dedupe).
- Playwright e2e (existing harness): signup/login, onboarding end-to-end, CSV upload, send-to-Hugo's-phone, STOP flow, dashboard, Stripe test checkout, weekly email render.
- **Nothing texts a real customer list until the full loop is proven on Hugo's own phone (+447863992555).**
- Browser-verify deployed landing + dashboard via Kimi.
