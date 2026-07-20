# REVIEWHARVEST_MAP.md — full product map (clone blueprint)

Sources: browser walkthrough of Hugo's paying account on dash.reviewharvest.com + onboarding.reviewharvest.com (48 screenshots in [docs/reviewharvest-map/screenshots/](docs/reviewharvest-map/screenshots/), DOM notes in [docs/reviewharvest-map/dom-notes.md](docs/reviewharvest-map/dom-notes.md)), their public site, their official Supademo interactive demo, their Intercom help center, their lifecycle emails in Hugo's Gmail, and founder-video research. **We clone structure and feature set only — all copy, images and branding are ours.** Mapped 2026-07-20.

---

## 1. Business + tech intel

- Founder Clay Lawrence, launched 2023, ~$57K MRR / ~850 clients (Mar 2026), team of 5–6, sold via outreach + YouTube case-study flywheel, **US/CA/MX only — they never solved UK SMS**.
- Stack: **GoHighLevel white-label core** (go.reviewharvest.com → brand.ludicrous.cloud; SMS via GHL LC Phone/Twilio) wrapped in a custom Next.js dashboard (dash.), a TanStack Start onboarding app (onboarding.), an Astro marketing site, Intercom support, Zapier as CRM middleware, Stripe billing (SetupIntent card-on-file), FB Pixel/Cometly/Tolt tracking.
- Login = email OTP code (Auth@access.reviewharvest.com, 10-min expiry). No password.
- **Pricing reality on the inside**: every tier card in the dashboard says "Includes **$40 account fee**" — Starter $99 = $59 product + $40 fee. Trial on Hugo's account: signed up Jul 18, first charge Jul 30 (~12 days; site says 10-day trial; onboarding rail claims a **45-day money-back guarantee** that their own T&Cs contradict).
- Legacy parallel offer: done-for-you **$10/review capped at $499/mo**, SMS costs rebilled (~$5/mo), billed for ANY new review regardless of attribution. Page removed Jul 2026; subscriptions now lead.
- Their claimed funnel numbers: 10–15% of past customers convert, 20–30% of new; "4x more reviews" from the personalized image; 42% of reviews come from follow-ups; drip starts ~1h after upload; 30-day cooldown per contact; stop-on-review via GBP OAuth (scope `business.manage`).

## 2. Sitemap (dash.reviewharvest.com — React SPA)

```
Sidebar: business switcher ▸ notifications drawer
  /business/dashboard      Dashboard
  /business/contacts       Contacts
  /business/add-contacts   Add Contacts
  /business/messaging      Messaging
  /business/scheduling     Request Scheduling
  /business/reviews        Reviews
  /business/widgets        Widgets            (iframe widget.reviewharvest.com)
  /business/social-posting Social Posting β   (iframe social-posting.reviewharvest.com)
  /integrations (+/add)    Integrations
  /business/referrals      Refer a Friend ($100/$100)
User menu: Integrations · Account Settings · Payment Method · Manage Users · Log out
Account tabs: /account (Overview) · /analytics · /update-payment · /payment-history
              · /subscription (→ /subscription/{businessId} plan manage) · /users (Team)
Customer-facing review link = raw Google writereview?placeid=… (no tracked redirect observed)
```

## 3. Per-screen records → Elsie module mapping

### Dashboard (`/business/dashboard`) → `src/features/reviews/` home
- Business name H1 with inline pencil edit.
- **"Last 30 Days Performance"** — 5 stat cards: New Reviews · Updated Reviews · Link Clicks · Requests Sent · Contacts Added.
- **Review History** chart with `7d / 30d / All` toggle; empty state "no data for this period".
- Right column **Google Reviews card**: big `0.0/5` rating + star row + total count; **Rating Projection** widget (spinbutton "+N 5-star reviews" + slider showing projected rating — brilliant anti-churn/upsell toy, cheap to build); **Milestones** ("reviews needed to reach each rating level" with progress bars); buttons **View on Google Maps** + **Copy Review Link**.
- Intercom launcher + "Onboarding Checklist — 3 steps · ~5 minutes" floating card.

### Contacts (`/business/contacts`) → reviews contacts page (reuses `contacts` + `review_requests`)
- Search (name/email/phone). **Status filter** (multi-checkbox): `No Review, Failed, Follow Up, Initial, Pending, Waiting`. Inline flag filters: `Clicked, Stopped, Do Not Contact, Left Review`. Count badge. (Table columns unknown — account empty; our lifecycle enum in ARCHITECTURE.md §3 covers all these states.)

### Add Contacts (`/business/add-contacts`) → part of reviews contacts
- Tab **Single Contact**: First Name* / Last Name / Email / Phone (≥1 contact method required), "Add to Do Not Contact List" toggle, **per-contact consent checkbox** ("I have the required consent to message this customer by email or SMS" — we go further with the PECR attestation).
- Tab **Import CSV**: requirements card (Name + Phone/Email), **Download Template**, drag-drop ≤10MB.

### Messaging (`/business/messaging`) → reviews settings / templates
- "CURRENT SENDING MODE" banner. iPhone-mock **live preview** with the personalized image and the SMS text.
- Tabs **Smart Message** (AI-optimised copy, "tested across thousands of requests, learns tone, optimises click rate" — ours = Claude via callLLM) | **Custom Message** (template editor with variable chips `First Name · Review Link[required] · Owner Name · Business Name`, char counter, Save).
- Shared: Owner First Name, Business Name, **Personalized Image toggle + Upload Image**.
- **Follow-up Messages** card: preview, Enable toggle, "42% of reviews come from follow-ups" factoid, rules: first follow-up 3 days after initial · up to 3 reminders · smart stop (review left OR link clicked) · business hours only.

### Request Scheduling (`/business/scheduling`) → reviews settings
- Status banner "Review requests active" + **Pause** button (per-business kill switch).
- **Initial Request Scheduling** slider (current "Right Away"); sends only **9 AM–7 PM local**, outside → next day.
- **Follow-Up Messages** slider (current "2 follow-ups"); 3 days after previous; link-clickers excluded; per-contact stop.

### Reviews (`/business/reviews`) → reviews inbox
- **AI Response Settings**: toggle "Auto-generate responses for 4–5 star reviews" + "Business nickname" field (name the AI uses in replies).
- Rating filter pills All/5/4/3/2/1, paging count, list of reviews. (Their 1–3★ handling is manual; ours adds the held-for-approval drafts queue.)

### Widgets (`/business/widgets`, separate widget subdomain) → **v2, not in first build**
- 3 embeddable widgets (Review Popup, Carousel, Grid), colour pickers, live previews, script-tag installer + "email instructions to your web person". ⚠ If we ever build this: FTC/DMCC require widgets to show negative reviews too — no filtering.

### Social Posting β (`/business/social-posting`) → our GBP-posts feature (Zernio); social networks v2
- Social Connections, caption source tabs (**Review Comment | Review Reply | Custom**), **Auto Posting** master toggle + per-day Story/Feed toggles Mon–Sun, Upcoming Posts queue, Post Templates.

### Integrations (`/integrations`, `/integrations/add`) → CRM connector + Zapier + webhook
- Catalog: Jobber · Sweep & Go · Workiz · **Webhook** ("receive customer data via webhook from any service") · ResponsiBid · Zapier (5,000+ apps) · Housecall Pro · Launch27. Our v1: CSV + generic inbound webhook + Zapier; UK trade CRMs later.

### Referrals (`/business/referrals`) → v2
- "Give $100, Get $100" gift-card program, personal link `onboarding.../i/{userId}`, invite form, referral list.

### Account section → reviews billing page + /super
- **Overview**: Active Businesses, Billing Model, Account Since, payment method card, connected businesses.
- **Analytics** (account-level, multi-business): KPI cards (Reviews Collected, Average Rating, Click-Through Rate "0 of 0 messaged", Requests Sent), Reviews-over-time chart, **Engagement Funnel**, **By Business table** (Business · Reviews Collected · Rating · Total Reviews · Requests · Clicks · CTR) — this is essentially their agency view; ours lives in `/super/reviews`.
- **Payment**: Stripe saved-card update. **Payment History**: Stripe invoice list.
- **Subscription**: status card (Trial badge, next payment, **Cancel Subscription**), per-business **Manage** → tier cards (Starter $99 / Growth $179 "Most Popular" / Pro $279, each "includes $40 account fee") — self-serve plan switch. Ours: same, minus the sneaky fee.
- **Team**: add member (email, name, assign-to-businesses checkboxes, role) — maps to existing `team_members`.

### Notifications drawer
- Simple list + refresh, no settings. **No email-preference page exists anywhere** — their product emails are hardcoded.

## 4. Onboarding flow (onboarding.reviewharvest.com — TanStack Start)

No step bar; URL-namespaced by an email hash. Left rail sells while you fill (pitch bullets, FAQ accordion, BrightLocal stat).

1. `/` **Create Your Account** — First/Last/Email/Mobile + ToS checkbox + Continue; "Book Onboarding" escape hatch. Rail: "Let's 4x Your Reviews!" bullets + **45-day money-back guarantee** claim.
2. `/{hash}/create` — "Creating your account…" transition; rail becomes FAQ (billing timing, real reviews?, cancel, contract, guarantee, human, demo).
3. `/{hash}/google` — **Connect Google Business Profile** (OAuth, scope business.manage; hotspot copy: "lets us see your new reviews and respond on your behalf"); "don't have a profile? create one free"; "Schedule Setup Call".
4. `/{hash}/google-error` — failure screen + reasons + retry.
5. `/{hash}/select-business` — pick GBP location; empty variant + reconnect.
6. `/{hash}/pricing` — plan cards; rail lists the 12 all-tier features.
7. `/{hash}/pay` — Stripe SetupIntent card capture.
8. `/{hash}/success`.

From their Supademo, the fuller journey also includes **select-CRM** ("choose your CRM… select spreadsheet if not listed") and **book an integration onboarding call** between Google connect and pay. Post-signup nudges by email if abandoned (§6).

**Ours** (go.heyelsie.com/onboarding): same shape with two insertions — contacts upload moved INTO onboarding (their reactivation starts at the first CSV anyway) and a **PECR lawful-basis attestation** step. Target ≤10 minutes. See PLAN.md Stage 6.

## 5. Marketing site anatomy (reviewharvest.com — structure to clone at heyelsie.com)

13 sections in order: **Nav** (Features/Case Studies/About/Resources▾/Pricing-anchor/Login/Signup) → **Hero** (headline: automated review generation for home services; 2 CTAs "start" + "book demo"; logo carousel + "50,000+ reviews / 700+ businesses" stats — no video) → **Pain points** (3 pains + 4 benefit callouts) → **3 featured case studies** (logo, headshot, before→after number, quote) → **Growth stat + timeline** (+4,356% centerpiece; Today/Day 3/Day 7 milestones) → **How it works** (Connect → Launch → Automate) → **5 more testimonials** → **6-feature grid** (personalized images, CRM logos, rank on Google, AI replies, follow-ups, reactivation) → **12-vertical marquee** (HVAC, roofing, plumbing…) → **Pricing** (3 tiers on-page, monthly/annual toggle "2 months free", identical 12 bullets, trial CTA; follow-ups don't count; franchise via email) → **18-question FAQ** (incl. "can't filter negative reviews — Google policy"; cadence 1 ask + 2 reminders; 10–15%/20–30% conversion claims; US/CA/MX only) → **Final CTA** → **Footer** (explore/company columns, newsletter, SMS STOP disclosure).

Our hero (agreed): *"When someone Googles a plumber, they call the one with 400 reviews — not the one with 25."* + first-25-reviews-free offer, UK verticals, £ pricing, UK English.

## 6. Lifecycle emails (from Hugo's Gmail) + auth

- **Login/verify**: OTP code email from Auth@access.reviewharvest.com ("expires in 10 minutes").
- **Abandoned-setup nudge** (day 0, from clay@r.reviewharvest.com): "I saw you started setting up… only takes a couple minutes… can start getting you reviews on the first day" + 3 CTAs: finish setup / 3-minute walkthrough video / book an onboarding call. P.S. "built for non-tech-savvy owners".
- **Educational drip** (day 1): "Why Your Worst Customers Are 10x More Likely to Leave A Review" — the 1%-unhappy-review-more angle, ✅ checklist (10-min setup, set & forget, reviews <24h, zero-risk only-pay-for-reviews, works while you sleep), social-proof link, finish-setup CTA, book-a-call PS.
- Ours (Resend, already-verified domain): OTP/welcome exists; add abandoned-onboarding nudge, educational drip, **weekly stats email** (they don't send one — our anti-churn edge), plus approval-queue alerts.

## 7. Feature surface confirmed by their help center (support.reviewharvest.com — Intercom, 33 articles)

Manual single-contact request · send request manually · AI review response on/off · adjust follow-up count · customise messaging · change business/owner name · CSV upload · change personalized image · widget install per site-builder · add/remove users · social posting setup · delete contact vs stop sending · prevent someone getting a request · payment method · per-CRM connect guides (Jobber, Sweep&Go, Workiz, Housecall Pro via Zapier, Markate, DripJobs, any CRM via Zapier).

## 8. Known unknowns (couldn't observe — account has zero data)

- Contacts table columns; contact/review/thread detail views; real plan-card + Stripe screens inside onboarding (shells only); the SMS click-tracking redirect domain (Copy Review Link is a raw Google URL; link clicks are tracked somehow on sends — likely a per-request short link, which is how we'll build it); Intercom checklist contents.
- Nothing destructive was touched; messaging mode was verified restored to Smart; browser tabs left in a "RH product map" group.

## 9. Deliberate differences in our clone

1. **UK-first**: they can't serve the UK; we're built for it (long codes + STOP, PECR attestation, quiet hours 09:00–20:00, DMCC-proof send-to-all).
2. **No hidden $40 account fee** — clean £99/£179/£279.
3. **14-day trial** (theirs ~10) and no contradictory "45-day guarantee" claims.
4. **WhatsApp channel** (UK differentiator, opt-in per client, low volume) — they're SMS/email only.
5. **Weekly stats email** — they have none; it's our anti-churn weapon.
6. **Custom stack, not GHL** — we own every screen, the AI (Claude), and the data.
7. Compliance enforced in code (template lint, suppression-first, no gating mode at all).
