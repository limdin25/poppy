# PLAN.md — HeyElsie Reviews build plan

Phase 0 complete (2026-07-20). This is the execution plan for Phase 1. Grounding: [AUDIT.md](AUDIT.md) (what exists), [ARCHITECTURE.md](ARCHITECTURE.md) (how it fits), [REVIEWHARVEST_MAP.md](REVIEWHARVEST_MAP.md) (what we're cloning).

**Positioning (from research):** Review Harvest is $57K MRR / ~850 clients, now runs its own custom dashboard/onboarding software (it began as white-labelled GoHighLevel in 2023 and GHL still powers its booking calendars and likely its SMS rails), and **does not serve the UK** (US/CA/MX only — they never solved UK SMS). Our pricing mirrors their proven tiers, in pounds, with a custom stack they can't match. No UK-native competitor offers personalized-image reactivation (Cloutly can't send UK SMS; Podium/Birdeye cost 3–8x more).

---

## Pricing (canonical — do not drift)

| Tier | Requests/mo | Price | Trial |
|---|---|---|---|
| Starter | up to 50 | £99/mo | £1 today, 10-day trial, card on file |
| Growth ⭐ Recommended | up to 100 | £179/mo | £1 today, 10-day trial, card on file |
| Pro | up to 300 | £279/mo | £1 today, 10-day trial, card on file |

All features on every tier (4x-reviews claim, automated text & email, reactivation, dynamic follow-ups, AI smart messaging, personalized image requests, auto AI review replies, social review posting, review widgets, referral program, CRM integration, Zapier, unlimited users, 1-1 setup call). "Request" = one send to one contact; follow-ups don't count. Cap → pause + self-serve Stripe upgrade with proration. No free tier, no enterprise tier.

---

## Build order (each stage ends compilable + tested; receptionist untouched throughout)

### Stage 0 — Baseline hygiene (½ day)
- Commit the current `crm-clone` WIP locally (no push — deploys are CLI anyway), then branch **`reviews`**.
- New Unipile API key onto Vercel + memory (Comet prompt — token is dead, receptionist inbox is down NOW; independent of this build but do it first).
- Migration fixing drift we'll trip over: define the `review-assets` storage bucket properly.

### Stage 1 — Compliance backbone FIRST (1 day)
- Migration: `review_suppressions` + `review_settings` (attestation columns) + suppression checks as a shared lib (`api/lib/review-guards.ts`).
- Per-client sender numbers: resurrect dormant Twilio purchase code behind an admin route; wire `SmsUrl` → new `api/webhooks/twilio-reviews-sms.ts` (signature-validated fail-closed, STOP → suppression, copied from the proven `wk-sms-incoming` pattern).
- Template lint: business name + opt-out required; incentive words blocked.
- Unit tests: STOP regex, cross-channel suppression, template lint.

### Stage 2 — Zernio integration (1–1.5 days)
- `src/integrations/zernio/client.ts` (profiles, connect, locations, reviews, reply, posts, analytics, webhooks) + `gbp_connections` migration.
- `api/webhooks/zernio.ts`: HMAC verify, event dedupe, `review.new`/`review.updated` → `gbp_reviews` upsert + stop-on-review matching.
- Register webhook + subscribe events; nightly reconcile cron fallback.
- Connect flow test against a real GBP location (Zernio has no sandbox — use Hugo's/a test business profile).

### Stage 3 — Request engine (2 days)
- Migrations: `review_campaigns`, `review_requests`, `review_usage`, `review_events`, `zapier_webhooks`.
- `api/cron/review-requests.ts`: atomic claim → guards (suppression, cap, quiet hours, kill switches) → send SMS (Twilio + StatusCallback) / email (Resend) → follow-up scheduling → stop-on-review honoured.
- Personalized images: add `sharp` (Node runtime function), `review_image_templates`, name composite, upload to `review-assets`; SMS carries link, email embeds.
- AI smart messaging via `callLLM`.
- Reactivation campaign type (drip-paced blast over old contacts) + ongoing type (Zapier/CRM-trigger + manual add) — inbound trigger endpoint (token auth, "job done → send request") + outbound event hooks per `zapier_webhooks`.
- Unit tests: cap metering, quiet hours, follow-up scheduling, image render.

### Stage 4 — Reviews inbox + auto-replies + repurposing (1 day)
- `review_replies` migration; on new review: Claude drafts → 4–5★ auto-post via Zernio, 1–3★ held for approval.
- Client-facing approval inbox (reuse draft-approve UX pattern); 5★ → GBP post repurposing (opt-in toggle).
- Approval-queue alert: Resend email to the client when a 1–3★ draft is held, so drafts don't sit unseen (map §6).

### Stage 5 — Client dashboard + go.heyelsie.com (2 days)
- Cloudflare DNS + Vercel domain + `RootEntry` host branch → `ReviewsApp`.
- `src/features/reviews/`: stats (reviews this week/month, rating trend, requests sent vs cap, reply activity), reviews list, requests/campaigns, contacts upload, message-thread view, settings, billing.
- Dashboard right column (per map): Google Reviews card (big rating + count), **Rating Projection** (spinbutton "+N 5-star reviews" + slider → projected rating), **Milestones** (reviews needed per rating level, progress bars), **View on Google Maps** + **Copy Review Link** buttons.
- Weekly stats email cron (Resend): "You got 6 new reviews this week, rating up to 4.7".
- Feature flag `reviews`; new signups get reviews-only UI; receptionist hidden for them.

### Stage 6 — Onboarding at go.heyelsie.com/onboarding (1.5 days)
Clone the RH flow shape (see REVIEWHARVEST_MAP.md): account → verify → **connect Google via Zernio** → pick location → pick CRM or spreadsheet → upload contacts → PECR attestation (ours, they don't have it) → message preview + image template → card via Stripe (£1 today + 10-day trial) → first reactivation batch armed (but NOT sent until number assigned + Hugo-gate passed). Target: 10 minutes.
- Abandoned-onboarding nudge email (Resend, day-0 "finish setup" — RH's proven email, map §6) when a signup stalls mid-flow. Their educational drip stays v2.

### Stage 7 — Billing (1 day)
- Create 3 Stripe products/prices (GBP, £1 entry + 10-day trial) + payment links via API; extend `PRICE_TO_PLAN`; cap-pause + upgrade prompt; proration self-serve.

### Stage 8 — /super + CRM bridge (1.5 days)
- `/super/reviews` clients overview, health, approval queues, onboard-a-client wizard.
- Fix server-side impersonation (header + audit log via existing orphaned endpoint) + token hand-off into go. dashboards.
- `wk_contacts.business_id` migration + "Reviews" sales pipeline in the CRM.

### Stage 9 — Landing page (1 day)
- Rebuild `LandingPage.tsx` on the RH structure (13 sections — see map): hero **"When someone Googles a plumber, they call the one with 400 reviews — not the one with 25."**, first-25-reviews-free offer, UK verticals, how-it-works, personalized-image showcase, pricing table above, FAQ (UK-adapted), compliance-clean footer (STOP notice). UK English, £.

### Stage 10 — Widgets (1.5 days)
- Migration `review_widget_settings` (per business × widget type: colors, position, show-names toggle).
- Public embed endpoint `api/widget/[type].ts`: self-contained JS bundle + reviews JSON from `gbp_reviews` (cached, no auth). Settings ride the script-tag query string (RH pattern) but are also stored server-side for the editor. **No rating filtering — FTC/DMCC require negative reviews shown too.** "Powered by HeyElsie" backlink on every widget (free marketing, RH does the same).
- 3 widgets, vanilla JS in Shadow DOM (client CSS can't break them):
  - **Popup** — bottom-corner toast "{Name} left a review · Read our N reviews"; position Left/Right; colors star/background/text (defaults `#FFC107`/`#FFFFFF`/`#000000`).
  - **Carousel** — header "What our customers are saying on Google!" + View on Google Maps button; colors star/bg/text + button color `#1567f1` + button text `#ffffff`; Show Reviewer Names toggle.
  - **Grid** — card colors (star/bg/text) + page background `#F9FAFB` + button `#333333`; responsive 1/2/3 columns.
- Dashboard editor per widget: live preview, color pickers, Reset + Save, **Installation Guide** modal (2 copy-paste snippets: `<script … defer>` + `<div id="{tag}">` container, plus Wix/Squarespace/WordPress plain-English note).
- **Send Installation Instructions**: tech-support email field → Resend email with the snippets to the client's web person.
- Tests: embed endpoint serves JS + correct reviews, includes low ratings (no-filter rule), settings persist.

### Stage 11 — Referrals (1 day)
- Migration `review_referrals`: referrer user, invitee email, status (`invited→signed_up→paid→rewarded`), reward state.
- Personal link `go.heyelsie.com/onboarding?ref={userId}` (attribution stored at signup) + invite-by-email form (name + email → Resend) + "Your Referrals" list in dashboard.
- Reward **£100/£100** triggered by invitee's first paid Stripe invoice (webhook flips status) → payout queue in `/super`. v1 fulfilment is manual (Hugo sends the gift card / credit); RH uses a 2,000-brand gift-card service (Tremendous-style) — automate later if volume justifies a Tremendous account.

### Stage 12 — In-app support messenger + admin dashboard (2 days)
Intercom-lite, built from Hugo's approved mockup — **[docs/support-widget-mockup.html](docs/support-widget-mockup.html)** is the visual spec: match its layout, spacing and interactions, swap `--chat-primary` to Elsie brand colours (RH pays Intercom for this; ours is in-house, £0/mo). Client widget lives INSIDE the go. dashboard (React component, not an embed).
- Migrations: `support_conversations`, `support_messages`, `help_articles`, `checklist_steps` (+ seeded defaults), `checklist_progress`.
- **Client widget** (launcher bubble bottom-right + unread badge, panel 380px / mobile full-screen), 5 views per the mockup:
  - Shell: header (view title, close; back button appears on Article and returns to the previous view), bottom nav with 4 tabs (Home · Messages · Help · Tasks), fade+slide open/close animation, panel widens to 460px on the Tasks and Article views.
  - **Home** — avatar + "Hi {first name}, send us a message" greeting, latest-update card, "Send us a message" CTA.
  - **Messages** — live thread with the team via existing Supabase Realtime (bubbles, composer); auto-ack bubble on first message.
  - **Help** — published articles list → **Article** view (title, subtitle, author, steps with screenshot + callout).
  - **Tasks** — onboarding checklist: progress bar, expandable step cards (link + CTA deep-linking into the product + Mark as completed). Progress stored per business in DB (mockup's localStorage → real persistence).
- Floating "Onboarding Checklist — N steps · ~5 minutes" nudge card on the dashboard until complete (RH pattern); steps auto-complete from real events where possible (Google connected, contacts uploaded, image added) as well as manual mark-done.
- **Admin at `/super/support`**: all-clients inbox (open/closed, unread counts), thread view + reply (Realtime back to the client), help-article CRUD (markdown editor), checklist-step editor (title, CTA label + route, linked article, order, active).
- New inbound client message → email notification to Hugo (Resend) so nothing sits unanswered.
- Tests: unread badge count, checklist persistence + auto-complete, admin reply roundtrip.

### Stage 13 — E2E + deploy + verification (1.5 days)
- Playwright: signup/login, onboarding e2e, CSV upload, **send to Hugo's phone (+447863992555 — confirm this is the number you want)**, personalized image correct name, STOP works, dashboard data (incl. Rating Projection + Milestones render), widget embed renders on a plain HTML page with all ratings shown, referral link attributes a signup, support-widget message → /super reply roundtrip, checklist step marks complete, Stripe test checkout, weekly email render. Paste results.
- Deploy (CLI + .git-hide), Kimi browser-verify landing + dashboard with screenshots, write FINAL_REPORT.md + team onboarding runbook.

**Total: ~17.5 working days of build.** Definition of DONE per the mission: tsc clean, e2e green, browser-verified, FINAL_REPORT.md. Hard gate: nothing texts a real customer list until Hugo has seen the loop on his own phone.

---

## What I need from you (Hugo) — the complete list

**Blocking soon (not immediately):**
1. **Unipile**: new API key — the old one is revoked and **prod WhatsApp/email is likely down right now**. I'll write the Comet prompt; you paste the key back.
2. **Zernio account**: the key works but has **0 connected accounts** and review webhooks need their usage-based (card-on-file) plan. Confirm the hello@lemlin.com account has a card on it (I can check via Comet prompt). Cost is tiny: first 2 GBP connections free, then ~$6/account/mo.
3. **Twilio number purchases**: per-client UK long codes cost ~£1–2/mo each. Confirm I may auto-buy them from code when onboarding a client (spend action, so asking once here).
4. **A team photo** (any placeholder is fine) to build/test the personalized-image template.

**Confirmations (I'll proceed with these defaults unless you say otherwise):**
5. Test phone = your +447863992555.
6. New review clients live in the existing `businesses` table gated by a `reviews` feature flag (recommended; everything reuses cleanly).
7. Stage 0 commits the current crm-clone WIP locally first (no push).
8. Stripe products go on the existing shared (Lemlin) live account, same as receptionist billing.

**Open questions (non-blocking, flagged from research):**
- RH runs a 10-day trial; you specified 14 — keeping 14.
- WhatsApp bulk sends via Unipile technically violate WhatsApp ToS (ban risk per client number). Plan: SMS+email primary, WhatsApp off by default per client until you opt a client in. OK?
- Annual billing ("2 months free") exists on RH — skipped for v1 unless you want it.
- "First 25 reviews free" hero offer: WITHDRAWN — the entry offer is £1 today (2026-07-27) (not a separate billing mechanic) for v1.
