# FINAL_REPORT.md — HeyElsie Reviews v1

Shipped to production 2026-07-20, branch `reviews` (local commits `b8c7bc7`+, not pushed — deploys are CLI per repo convention). Companion docs: [PLAN.md](PLAN.md), [ARCHITECTURE.md](ARCHITECTURE.md), [AUDIT.md](AUDIT.md), [REVIEWHARVEST_MAP.md](REVIEWHARVEST_MAP.md).

---

## 1. What is live right now

| Surface | URL | Status |
|---|---|---|
| Marketing landing (reviews product, £ pricing) | https://heyelsie.com | ✅ deployed |
| Client app (login, dashboard, all 9 pages) | https://go.heyelsie.com | ✅ deployed (new DNS + domain) |
| 10-minute onboarding | https://go.heyelsie.com/onboarding | ✅ deployed |
| Admin super-view | https://app.heyelsie.com/super/reviews | ✅ deployed |
| Widget embeds | https://app.heyelsie.com/api/widget/{popup\|carousel\|grid} | ✅ deployed |
| Short review links | https://go.heyelsie.com/r/{token} | ✅ deployed |
| Receptionist product | app.heyelsie.com | ✅ untouched (verified: existing routes/flags intact) |

**The proven live loop (2026-07-20):** admin bought UK mobile **+447460035763** through /super (Twilio GB-Mobile + the account's approved regulatory bundle, STOP webhook wired at purchase) → Claude wrote a personalised request → **"Hi Hugo!" image rendered** (sharp + glyph paths) → **SMS delivered to +447863992555** (Twilio status `delivered`, SID `SM38f5fbb3…`). Reply STOP to that message any time — it exercises the live suppression path.

## 2. Test evidence

- `npx tsc --noEmit` → **0 errors** (app project; the api project has 7 pre-existing errors in files I never touched — Vercel builds fine, unchanged behaviour).
- `npx vitest run` → **289/289 passed** (54 new: STOP regex, phone normalisation, template lint incl. incentive blocking, quiet-hours windows incl. BST, cap periods, Twilio HMAC fail-closed, drip scheduling caps/monotonicity, SMS/email composition, image rendering incl. hostile-name sanitisation).
- Playwright vs **production**: **12/12 passed** — landing content + £ pricing + compliance strip; onboarding account creation → Google step; login → dashboard (stat cards, Rating Projection, Milestones); add-contact with consent → appears in Contacts; billing tiers + **real Stripe checkout session created** (live mode, no charge); referrals £100/£100 link; widget JS served + **renders in Shadow DOM on a plain HTML page**; SMS webhook 403 unsigned; Zernio webhook 403 unsigned; /r redirect.
- Unit tests caught one real bug before ship (smart-messaging-off with no template fell into the LLM path).

## 3. What's real vs. what needs one more step

**Fully real:** request engine + drip cron (live, every minute), suppression/STOP (cross-channel), tier metering + cap pause, personalized images, AI smart messaging, AI review replies (auto 4–5★ / approval 1–3★), review repurposing to GBP posts, weekly stats email (Mondays 08:00), widgets, referrals (attribution + paid-invoice flip live in the Stripe webhook), Zapier/webhook trigger endpoint, closer onboarding, number purchases, audit-logged API impersonation, Stripe tiers £99/£179/£279 with 14-day trials + payment links:
- Starter: https://buy.stripe.com/eVq00k4OvbfyetdbE0fbq00
- Growth: https://buy.stripe.com/dRm28sbcT2J21GrdM8fbq01
- Pro: https://buy.stripe.com/3cI3cwft94RagBl5fCfbq02

**Needs a first real-world pass (not code):**
1. **Zernio GBP connect end-to-end** — the flow is built and the key verified, but no location has been OAuth-connected yet (needs a real Google Business Profile login — 2 connections are free on Zernio's tier). First connect also auto-registers the `review.new` webhook. **Action: connect your own GBP (or a client's) through go.heyelsie.com onboarding.**
2. **Zernio plan** — review webhooks need their usage-based (card-on-file) plan; confirm hello@lemlin.com has a card. ~\$6/account/mo after the free two.
3. **Stripe checkout completion** — session creation is e2e-tested; an end-to-end paid signup needs a real card (14-day trial, cancel after, or use the trial itself as the test).

**Known v1 boundaries (deliberate):**
- UK SMS carries the personalized image **as part of the ask via link/email embed** — UK long codes cannot send MMS (confirmed: purchased number reports `MMS: false`). Emails embed the image; US senders would attach it natively later.
- WhatsApp channel deferred (your call — no Unipile key for now; SMS+email are the engine).
- Review Harvest's "Add Business" multi-location, social-network posting (FB/IG) and automated gift-card payouts are v2; referral payouts are the manual /super queue.
- Stop-on-review matches by reviewer first name within 45 days (same approach RH uses); the nightly reconcile catches stragglers.
- Metering period is the calendar month (not the Stripe anchor date).

## 4. Costs & artefacts created today

- Twilio: +447460035763 (~£1–2/mo) — the house demo sender; keep it (it's your live proof line).
- QA rows in prod: business "HeyElsie Reviews Demo" (reviews-demo@heyelsie-qa.com / ReviewsDemo2026!) + e2e businesses `QA Reviews {run}` (reviews-e2e-…@heyelsie-qa.com) — harmless; delete whenever.
- Stripe: 1 product + 3 prices + 3 payment links (live).
- Supabase: 13 new tables + 3 RPCs + `review-assets` bucket (migrations `20260720000002`, `20260720000003`, applied).
- Vercel: 3 new crons (engine every minute, reconcile 04:00, weekly email Mon 08:00), go.heyelsie.com domain + DNS, env `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `GO_APP_URL`.

## 5. Team runbook — closer sells a client on the phone

1. **Mid-call:** open **app.heyelsie.com/super/reviews → Onboard client** — business name, owner name, email, tier. Copy the **payment link**, text it to the client on the call ("14-day free trial, card just holds your place").
2. The client gets a set-password email automatically; a **sender-number request is already queued**.
3. **Admin (2 clicks):** /super/reviews → Numbers → **Buy UK number** (uses the approved regulatory bundle; STOP webhook wires itself).
4. **Client (or you, via "View as client"):** go.heyelsie.com — connect Google (their own login), upload the customer CSV, confirm the consent step, launch reactivation. Ten minutes.
5. Requests drip 09:00–20:00 at the configured pace; the dashboard, weekly email and /super all show progress. 1–3★ reply drafts wait in their Reviews tab.
6. Referral link lives on their Refer a Friend page; when a referral's first paid invoice lands you'll see it in /super → Referrals — send both £100 gift cards and mark it done.

**Hard rule that's enforced in code, tell every closer anyway:** we never filter who gets asked and never incentivise reviews — it's a Google ban risk and illegal under the DMCC Act, and the platform physically has no gating mode.

## 6. Anything else on your plate

- The **Unipile token is still dead** — unrelated to Reviews, but the receptionist WhatsApp/email inbox stays down until a new key is minted (say the word and I'll write the Comet prompt).
- Branch `reviews` holds today's commits locally; `crm-clone` WIP was checkpointed first. Nothing pushed (normal for this repo).
- Browser verification screenshots land in [docs/reviews-verification/](docs/reviews-verification/) (Kimi run).
