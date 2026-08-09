# BUILD PROMPT — Instant demo website generator for cold-outreach leads (UK plumbers first)

*Paste everything below into a fresh Claude Code window opened at `/Users/hugo/Whats/Poppy`. Every integration point cited here was verified against the live code and project memory before writing this (file paths are real, not guessed).*

> ## HOW TO RUN THIS BUILD
> **Build the whole feature in one session, start to finish. Do not stop halfway to ask for confirmation.** Every mechanism below is grounded in code or memory that's already live — there are no open technical questions left in this version.
>
> **BUT DO NOT MAKE IT LIVE.** Build in the working tree, keep the green gate passing, commit locally per behaviour. Then STOP.
> - **Write** the migration — do **NOT** apply it to production (`loggyxryrhqsbtqpteog`). Applying it is the owner's go-live step.
> - **Do NOT deploy** anything to Vercel/Supabase. Do NOT `git push`.
> - Manual go-live steps are collected in the final "GO-LIVE" section. Do not perform them; just leave nothing else to build.

---

## 0. What you're building (and what you're NOT)

The CRM's cold-SMS play already sends: *"Hey Matthew, this is Pedro. I saw you on Google and noticed you dont have a website. I know this is kinda random, but I built you one. Wanna see it?"* — but there's no automated way to actually generate that website yet. This builds the generator, the page it lives on, an AI chat widget on it, a phone-testable AI receptionist tied to it, an escalation ladder culminating in the **AI closing the client itself** (Hugo, 2026-07-28: *"I will try this new close approach where the AI closes them"*), CRM visibility of the whole funnel, and — once the lead converts — a scoped self-serve editor so the client can run their own site without ever touching the agency's CRM.

**This is its own standalone system — explicitly NOT tied to the VSL video pipeline** (Hugo, 2026-07-28: *"forget about the video, this is something else, don't mix the video with this"*). Do not share tables, routes, or code paths with `wk_vsl_pages`/`api/vsl/*`. Where this doc mentions a VSL file, it's cited only as **prior art to skim for a similar shape** (e.g. "roughly how a per-lead public page is structured elsewhere in this repo") — reimplement fresh for this feature, don't import from or extend the VSL code, and don't route this funnel's data through `wk_vsl_pages`/`wk_vsl_events`/the VSL checkout. Hugo wants to run this AI-closes approach as its own distinct experiment, not conflated with the video funnel's existing self-serve flow.

**What this is NOT:**
- **Not a bespoke coded site per lead.** A full cinematic-ui build (4 phases: decisions → storyboard → compiled spec → build) per lead is far too slow for "generate it right after the SMS reply." Instead: design a **small library of 3–5 distinct, genuinely premium shells ONCE** (using `~/.claude/skills/cinematic-ui`, run manually by a human/agent as a one-time design pass, not part of this build's runtime path), then this build's job is the **fast per-lead fill**: swap in business name, trade, town, phone, address, services — the exact same token-substitution idea already used for the sales script (`src/features/crm/lib/interpolateScript.ts`, tokens like `[owner_first]`, `[business_name]`, `[town]`). Rotate which shell a lead gets (e.g. `hash(contact_id) % N`) so demos don't all look identical.
- **Not exposing colour/design customisation before the sale.** Hugo's explicit instruction: during outreach, don't offer or mention colour changes at all. Colour/text/image editing only exists in the **post-sale** client editor (§1e).
- **Not a VPS render queue.** A template fill is sub-second — this can run synchronously in the Vercel function that creates the page. Do not build a queue/worker for this.
- **Not sharing infrastructure with the VSL video funnel** — separate tables, separate routes, separate Stripe checkout integration, even where the shape looks similar. See above.

---

## 1. The exact mechanism

### 1a. Template shell library (built once, not per lead)
Design 3–5 shells with `~/.claude/skills/cinematic-ui` (a one-time manual design pass — genre/director brief: local UK trade services, not film-noir; still run the skill's full process to get something that doesn't look like a generic template). Land them as typed React components under `src/features/site-demo/templates/`, each taking one props object:
```ts
interface SiteDemoData {
  businessName: string; ownerFirst?: string; trade: string; tradePlural: string;
  town?: string; phoneDisplay: string; address?: string;
  services: string[]; logoUrl?: string; heroImageUrl?: string;
  reviews?: number; rating?: number; // reuse wk_contacts.custom_fields fields already
}                                     // populated by scripts/process-plumber-leads.mjs
```
The `custom_fields` keys already on every plumber contact (`owner_name, reviews, rating, rank, town, competitor_1/2, plumbers_ahead, total_plumbers, website, google_search_url` — see `docs/PLUMBER_LEADS_PIPELINE.md`) are the data source; no new lead-enrichment step is needed for v1.

### 1b. Per-lead page (its own route, independent of the VSL page)
New route, public, server-rendered so SMS link previews work: **`heyelsie.com/s/{slug}`** (Hugo's spec — `/s/` prefix). `slug` is a **slugified business name**, not a random ID (Hugo's example: "clientname" — human-readable, e.g. `mjr-plumbing`, not a UUID), so it reads clean in an SMS link and in the browser bar. Generate with the standard lowercase/hyphenate/strip-punctuation slugify, then de-dupe on collision by appending `-2`, `-3`, etc. (check `wk_site_pages.slug` uniqueness before insert). Build fresh (do not import from `api/vsl/page.ts`, per §0):
- bot/prefetch filtering so opens aren't inflated by iMessage/WhatsApp preview fetchers (a UA + `Sec-Fetch-Dest` check is a small, self-contained piece of logic — write it once for this feature)
- a signed beacon token for open/interaction events, so they can't be forged by replaying against a guessable slug (HMAC over `page_id` + an hour bucket, using its own secret env var — don't reuse `VSL_BEACON_SECRET`)
- server-rendered OG tags so the SMS link preview shows something real

Generation is **synchronous**: the CRM "Send site" click (§1c below) creates the `wk_site_pages` row AND renders/stores the filled content in the same request — no render queue needed, a template fill is sub-second.

### 1c. Trigger — auto-generate on a positive SMS reply, from day one
Hugo wants this live from the start, not a fast-follow: the moment a lead replies positively to the "I built you a website, wanna see it?" text (e.g. "yeah show me", "sure", "ok show me"), the system should generate the site and text the link back automatically, no human/agent click needed.

**What already exists to hook into:** `supabase/functions/wk-sms-incoming/index.ts` is where every inbound SMS lands; it already enqueues an `ai_reply` job (see `:352-376`) that generates a reply via the same pipeline `api/lib/ai-reply.ts` uses. **What does NOT exist yet:** any positive/negative intent classification of the inbound text — today it only generates a reply, it doesn't decide "this person wants the thing we offered." Add a small classification step (a single cheap LLM call, or even a short keyword/embedding check first — try the cheap version first and only reach for an LLM call if it's not reliable enough) that runs alongside the existing `ai_reply` enqueue in `wk-sms-incoming`, specifically for contacts on a campaign where a site-demo offer was texted (gate it — don't classify every inbound message in the whole CRM, only ones where `wk_site_pages` doesn't already exist for that contact and the outbound history shows the "I built you one" message was sent). On a positive classification: create the `wk_site_pages` row, fill it, and send the link — synchronously, in the same handler, since generation is sub-second (§1b).

Also keep a **manual "Send site" button** in the live-call/dialer UI for agents to trigger it by hand (a new button alongside whatever's already there for other sends — do not wire it through the existing "Send video" button's code path, this is a separate action with its own API route) — useful for phone replies ("yeah, show me") that never come in as text, and as a manual override/retry path.

### 1d. AI chat widget — every message logged
A small embeddable widget on the demo page, backed by a new `api/site-demo/chat.ts` route. System prompt = `wk_site_pages.chat_prompt` (defaults to an auto-filled template, editable later in the post-sale editor — §1f). Uses the same `ANTHROPIC_API_KEY` already configured in Vercel. Keep this its own route — don't reuse the WhatsApp/SMS auto-reply prompt code verbatim, the channel and constraints differ, but the "system prompt + business context" shape is the same idea.

**Tracking (Hugo wants everything on the site visible in the CRM):** every widget message — both the visitor's and the AI's reply — writes a `wk_site_events` row (`type='chat_message'`, `meta:{role, text}`). The first message of a session also advances `wk_site_pages.state` to `chat_used` and moves the CRM pipeline card (§2/§4).

### 1e. Phone-testable AI receptionist — reuse the existing demo line, caller-ID only, no extension
**Use the already-built spare line `+447576558278`** (Elsie project memory `project_demo_receptionist_line.md` — built 2026-07-01, its own isolated Retell agent `agent_ee268fbbb679c28d9c9ab0e852` and business row `f8b98eb2-…`, completely separate from the live production number `+447426495169`). No new number, no extension, no IVR gather step.

**The caller-ID mechanism is already live and proven on this exact number** — this is not a new build, it's reusing a fix that's already shipped:
- Twilio-SIP-trunk numbers don't pass the caller's number to Retell by default (`{{from_number}}` renders empty on these numbers — this was a real gotcha hit and fixed on this line already).
- The fix already in production: `api/webhooks/retell-inbound.ts` injects `dynamic_variables:{from_number,caller_number,to_number}` from the `call_inbound` payload, and `+447576558278` already has its `inbound_webhook_url` pointed there. So `{{from_number}}` already resolves correctly on this number today.

**What this build adds on top of that existing fix:** in `retell-inbound.ts`, when the inbound number is the demo line, look up `from_number` against `wk_site_pages` (join `wk_contacts` on phone) — if a match is found, add `business_name`, `trade`, `town`, `owner_first` to the same `dynamic_variables` object already being built. The agent's prompt template uses this content to greet the caller as their own business, e.g. `"Hi, this is your AI receptionist for {{business_name}}, how can I help?"`.

**Current baseline (confirmed live by Hugo, 2026-07-28):** calling the line today answers with a generic, non-personalised greeting — *"Hey, Elsie speaking, how can I help?"* — this is what gets **replaced** by the business-specific greeting above whenever the caller-ID lookup finds a match. **Swap the prompt** (pushed via `tests/readiness/push-prompt.mjs`, not the app's normal `sync-prompt` — per `project_demo_receptionist_line.md`) so the greeting branches on whether a `wk_site_pages` match was found: match → business-specific greeting; no match (someone calls from a different number than the one on file) → keep today's generic "Hey, Elsie speaking" fallback untouched. A soft miss, not a broken call.

**Tracking:** on `call_started` (from the existing `retell-inbound.ts` webhook) and `call_ended` (existing `api/webhooks/retell.ts`), write `wk_site_events` rows (`type='call_started'`, `meta:{direction:'inbound'}` — the `direction` field matters once §1f adds outbound calls too, so both flow through the same event type instead of forking it). Advance `wk_site_pages.state` to `engaged` (see the merged state list in §1f — chat and call both count as "engaged," full detail stays in the events table per §1h).

**End-of-call close, on every call regardless of who dialled (Hugo's ask):** extend the demo line's after-call handling with the same pattern already proven for `f8b98eb2` in `api/webhooks/retell.ts` (`CALLER_RECAP_BUSINESS_IDS` → `buildDemoRecapSms()`). On `call_ended` for a call where the caller matched a `wk_site_pages` row: the agent's prompt should include a light close attempt near the end of the call itself (something like *"want me to text you a link to get this set up for real?"*), and — regardless of whether they said yes on the call, since voice consent is unreliable to parse — the after-call webhook always sends a follow-up SMS containing the checkout link (§1f's shared checkout helper). This is the same "always send the recap, let the text do the closing" pattern the demo line already uses for its onboarding upsell (`project_demo_receptionist_line.md`: "Onboarding upsell... after-call, a 2nd follow-up SMS pitches a 15-min onboarding").

### 1f. The engagement escalation ladder — SMS nudges → outbound AI call → checkout link
Hugo's spec, tightened into a single forward-moving ladder instead of separate ad-hoc rules, so every lead is always in exactly one stage and nothing double-fires:

| Stage | Trigger | Action |
|---|---|---|
| **not opened → nudge 1** | Site sent, not opened after 2h (business hours) | SMS: "hey, did you get the link to your new site? [link]" |
| **not opened → nudge 2** | Still not opened, +24h from send | SMS, different angle, then **stop nudging for non-opens** (2 touches, matches the existing "3 touches then stop" compliance cadence elsewhere in this repo) |
| **opened, not engaged → nudge 1** | Opened, no call/chat within **10 minutes** | SMS: "go ahead and give [number] a call, hear your AI receptionist answer" — Hugo's spec, this is the highest-priority trigger, strike while they're still looking |
| **opened, not engaged → nudge 2** | Still no call/chat, +2h from open | SMS, reinforcing angle |
| **escalate → outbound AI call** | Still no call/chat, +24h from open (or from nudge 2) | **Elsie calls them** — see mechanism below. Up to **2 attempts**, spaced a few hours apart, quiet-hours-respecting, then stop calling (same 2–3-touch cap philosophy as the SMS side — this is now a phone call to a business number, not a stranger, but still don't harass) |
| **any engagement (call or chat) at any stage** | — | Jump straight to the post-engagement close: see §1e's end-of-call close, and for chat, the widget's last message before a gap should similarly offer the checkout link |
| **checkout sent** | After any close attempt (end-of-call SMS, or a chat-widget close offer) | Log `checkout_sent`, card sits here until... |
| **converted** | Stripe webhook confirms payment (§1g's provisioning trigger) | Terminal |

**Outbound AI call mechanism (new capability — this is the one genuinely new piece of telephony in this build):** use Retell's call-creation API (`POST https://api.retellai.com/v2/create-phone-call`) from the **same demo line** `+447576558278`, passing `retell_llm_dynamic_variables` for `business_name`/`trade`/`town`/`owner_first` at call-creation time (the same data shape §1e already builds for inbound, just supplied outbound instead of read from a webhook — no new Retell-side concept, just the other direction of a call). Opening line for an outbound attempt should own the fact that this is a follow-up, not pretend to be inbound: *"Hi, this is Elsie — I sent [owner_first] a link to a new website for [business_name] the other day, did you get a chance to look?"* Trigger this from the same `api/cron/site-demo-followups.ts` job as the SMS nudges (§ below), not a separate cron — it's one ladder, one job walking it stage by stage.

**This funnel's own checkout (independent of the VSL video funnel, per §0):** build `api/site-demo/checkout.ts` — its own Stripe Checkout Session creation, callable from a "Get started" button on the site-demo page, the after-call SMS (§1e), and the SMS nudges in this ladder. `api/vsl/checkout.ts` is worth a skim purely for the shape of "£1-today then trial" Stripe session config (price IDs, trial length, webhook handling) since that's proven-working in this codebase — but write this funnel's own copy rather than importing or extending the VSL one, so the two experiments can change independently (different price/trial terms, different copy, different tracking) without one touching the other.

**Cron/job mechanics:** build `api/cron/site-demo-followups.ts` running **every minute** (same shape as the existing `api/cron/messages/poll` job already running every minute in this repo) so the 10-minute trigger is actually timely — a once-daily cron would miss the "strike while they're looking" requirement entirely. Each run: claim due `wk_site_pages` rows per the table above (indexed query on `state` + the relevant timestamp column), same guard order as `review-requests.ts` (suppression → quiet hours 09:00–20:00 → kill switch) before ANY send or call, whether it's an SMS or an outbound AI call.

Each follow-up send writes a `wk_site_events` row (`type='followup_sent'`, `meta:{stage}`) so the CRM shows exactly which nudge fired and when — add `followup_sent` to the `wk_site_events` type check constraint (§2).

### 1g. Post-sale: the client's own site editor
On conversion (this funnel's own Stripe webhook, §1f — not the VSL one), generate a scoped, short-lived magic link — reuse the token hand-off mechanism ARCHITECTURE.md §7 already describes for cross-origin admin impersonation into `go.heyelsie.com` (that mechanism is generic infra, not VSL-specific, safe to reuse) — that opens a **client-only editor scoped to this one `wk_site_pages` row**. Not the CRM. Not `/super`. Just their site.

Editable in this editor (unlocked only here, post-sale): colours, every text block, images, logo upload, favicon upload, address, phone, embedded-form notification target, and the chat widget's system prompt.

**Home for this editor:** `go.heyelsie.com` already IS the client dashboard host with its own per-origin Supabase session (ARCHITECTURE.md §1). Add it there as a new section/tab rather than standing up a fourth host — confirm this placement with Hugo before building if anything about it feels ambiguous once you're in the code, but it's very likely correct given the existing host-per-purpose pattern.

### 1h. CRM visibility — every interaction shows up, not just the end state
Hugo's requirement, verbatim intent: the CRM must show, per lead, that they opened the site, that they called the AI receptionist, that they used the chat widget, and that a follow-up text went out — not just a single generic "engaged" flag. Two layers, mirroring how `wk_vsl_pages`/`wk_vsl_events` already do this for video:
1. **`wk_site_events`** is the full timeline — every open, chat message, call, and follow-up, timestamped. This is what a lead-detail drawer/card renders as an activity feed (mirror however the existing call/SMS history timeline is rendered in the CRM contact view today — reuse that component if one exists, don't build a new timeline UI from scratch).
2. **Pipeline columns** are the at-a-glance summary — a card sits in exactly one column at a time, forward-only, same as the VSL funnel's six auto-inserted columns. §2 lists the columns for this funnel.

---

## 2. Schema — one migration

New file: `supabase/migrations/<today>_site_demo_pages.sql` (idempotent, mirrors `20260725000001_vsl_funnel.sql` structure closely):

```sql
create table if not exists wk_site_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  contact_id uuid not null references wk_contacts(id) on delete cascade,
  agent_id uuid not null references profiles(id),
  business_id uuid references businesses(id),        -- set on conversion
  template_key text not null,                         -- which shell (§1a)
  business_name text not null,
  owner_first text, trade text, trade_plural text, town text,
  phone_display text, address text,
  content jsonb not null default '{}'::jsonb,          -- filled site copy, editable post-sale
  logo_url text, favicon_url text,
  primary_colour text, secondary_colour text,          -- null pre-sale; only the §1g editor sets these
  chat_prompt text,
  state text not null default 'created' check (state in
    ('created','sent','opened','engaged','nudged','ai_calling','checkout_sent','converted')),
  sent_at timestamptz, first_opened_at timestamptz, open_count int not null default 0,
  last_nudge_at timestamptz, outbound_call_attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists wk_site_pages_contact_idx on wk_site_pages (contact_id);
create index if not exists wk_site_pages_state_idx on wk_site_pages (state, updated_at);

create table if not exists wk_site_events (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references wk_site_pages(id) on delete cascade,
  type text not null check (type in
    ('open','call_started','chat_message','followup_sent','converted')),
  meta jsonb not null default '{}'::jsonb,             -- e.g. {role,text} for chat, {stage} for followup_sent
  created_at timestamptz not null default now()
);
create index if not exists wk_site_events_page_idx on wk_site_events (page_id, created_at);

-- RLS: agent reads own rows, admin reads all, all writes are service-role
-- (no client-side insert/update policy — every write goes through a server route or cron).

-- Pipeline columns, auto-inserted into the default workspace pipeline the same way
-- other CRM funnels append columns here (a `do $$ ... end $$` block that finds the
-- pipeline, appends after the current max position, skips if already present) —
-- one column per state so a card's position always matches wk_site_pages.state:
-- 'Site sent', 'Site opened', 'Engaged (call/chat)', 'Nudge sent', 'AI calling',
-- 'Checkout sent', 'Converted'
```
Update the `state` check constraint above to match this ladder:
`('created','sent','opened','engaged','nudged','ai_calling','checkout_sent','converted')`
Write this file. **Do not apply it to prod** — that's a go-live step.

---

## 3. Behaviour-by-behaviour plan (build + commit each, TDD where the logic is pure)

1. **Template shells + token-fill** — `fillSiteTemplate(templateKey, data: SiteDemoData)`. Pure function, easy to test: missing fields fall back sensibly (never render a literal unfilled token on a page a real prospect sees — that's the one thing worse than a placeholder image).
2. **Migration** (§2) + RLS + pipeline columns (seven columns per §2's list).
3. **Pipeline auto-move function** — `advanceSiteState(pageId, event)`, a pure state-transition function (forward-only, same idea as the VSL funnel's state machine but its own independent implementation per §0) that every other behaviour below calls into instead of hand-rolling its own column move. Build this early — #4/#7/#8/#9 all depend on it.
4. **`api/site-demo/page.ts`** — the public per-lead page (bot filtering, beacon token, OG tags — built fresh per §1b), swap in the template render. Log `open` events + advance state.
5. **Positive-reply classifier + auto-generate** (§1c) — new classification step in `wk-sms-incoming`, gated to contacts with a sent site-demo offer and no existing `wk_site_pages` row. On positive: create + fill + send, synchronously.
6. **Manual "Send site" CRM button** — a new button + its own API route, as the human-triggered path alongside #5.
7. **Chat widget** — `api/site-demo/chat.ts` + the embeddable widget component. Every message logs a `chat_message` event (§1d). Include a close-offer near the end of a stalled conversation.
8. **Receptionist caller-ID lookup + end-of-call close** — extend `api/webhooks/retell-inbound.ts`'s existing `dynamic_variables` build with the `wk_site_pages`/`wk_contacts` lookup (§1e), swap the demo line's prompt via `push-prompt.mjs` to branch on match/no-match. Log `call_started` events (`meta:{direction:'inbound'}`), tag `wk_calls.source='site_demo'`. Wire the after-call webhook to always send the checkout-link SMS for matched calls (§1e).
9. **Escalation ladder cron** — `api/cron/site-demo-followups.ts`, running every minute, same guard order as `review-requests.ts` (suppression → quiet hours → kill switch). Handles all five ladder stages from §1f's table: SMS nudges, the outbound AI call trigger (capped at 2 attempts), and logs `followup_sent`/`call_started(direction:'outbound')` events accordingly.
10. **This funnel's own checkout** — `api/site-demo/checkout.ts` (§1f), its own Stripe webhook for `checkout_sent`→`converted`. Do not touch `api/vsl/checkout.ts`.
11. **Post-sale editor** — scoped auth, colour/text/image/logo/favicon/form editing, under `go.heyelsie.com`.

Green gate before every commit: `npx tsc -b && npx vitest run` (per repo convention — see `docs/VMDROP_BUILD_PROMPT.md` for the exact command form used in this repo).

---

## 4. Testing
- Pure-logic unit tests (`fillSiteTemplate`, reply-intent classifier, caller-ID lookup, `advanceSiteState` transitions, ladder-stage eligibility, outbound-attempt cap) under `tests/`.
- Automated tests never place a real call or send a real SMS.
- Live smoke test (Hugo, at go-live): text a test contact the offer, reply "yeah show me" from that contact's phone and confirm a site auto-generates and sends, open the link, confirm the chat widget answers and logs events, call `+447576558278` **from the same test contact's phone number** and confirm the AI receptionist greets by the right business name and attempts a close near the end of the call, confirm the after-call SMS with the checkout link arrives, confirm the CRM card walks through every pipeline column as each thing happens. Then, with short test windows substituted for the real 10min/2h/24h ones: confirm the SMS nudges fire in order, confirm an outbound AI call actually gets placed after the ladder escalates, confirm it stops after 2 attempts rather than calling forever.

---

## 5. Deliverable checklist
- [ ] Migration `<date>_site_demo_pages.sql` — written only, not applied
- [ ] 3–5 cinematic-ui-designed shell templates in `src/features/site-demo/templates/`
- [ ] `fillSiteTemplate` + tests
- [ ] `advanceSiteState` pipeline state machine + tests — built early, everything else calls into it
- [ ] `api/site-demo/page.ts` (public per-lead page at `/s/{slug}`, logs `open` events)
- [ ] Positive-reply classifier wired into `wk-sms-incoming` + auto-generate-and-send
- [ ] Manual "Send site" CRM button + its own API route
- [ ] Chat widget + `api/site-demo/chat.ts`, every message logged, includes a close offer
- [ ] `retell-inbound.ts` caller-ID lookup extension + demo-line prompt swap (`push-prompt.mjs`), branches on match/no-match
- [ ] End-of-call close wired into the after-call webhook (always sends the checkout SMS for matched calls)
- [ ] `api/cron/site-demo-followups.ts` running every minute — full ladder: 2 SMS nudge stages + outbound-AI-call escalation (capped at 2 attempts) — mirrors `review-requests.ts` guard order, does not touch its code
- [ ] `api/site-demo/checkout.ts` — this funnel's own Stripe integration, independent of `api/vsl/checkout.ts`
- [ ] Post-sale scoped site editor under `go.heyelsie.com`
- [ ] Zero TS errors, green test gate, committed locally, nothing deployed
- [ ] Nothing in this feature imports from or writes to `wk_vsl_pages`/`wk_vsl_events`/`api/vsl/*` (per §0 — spot-check this before calling it done)

---

## 6. GO-LIVE — the owner does this later, NOT you
1. Apply the migration to prod (`loggyxryrhqsbtqpteog`).
2. Deploy the new routes/functions + frontend.
3. Register the new cron (`site-demo-followups`) in Vercel's cron config alongside the existing ones — every minute.
4. Create the new Stripe price(s)/product(s) for this funnel's trial offer if they don't already exist (confirm terms with Hugo — this build assumed "similar to the VSL £1-then-trial shape" but didn't assume the exact same price ID).
5. Confirm the demo-line prompt swap on `+447576558278` looks right (Hugo should hear it once before it goes to real leads) — both the match and no-match branches.
6. Run the cinematic-ui design pass for the 3–5 shells if not already done as a pre-step.
6. Live smoke test per §4, on Hugo's own phone first, from a real registered contact's number (caller-ID lookup needs a matching `wk_contacts` row to prove out).
