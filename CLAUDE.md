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
10. When something breaks: what broke, why, what you're doing to fix it. One sentence each.
11. **Never write a long dash.** No em dash, no en dash, anywhere: code, comments, commits, docs, UI copy, messages, prompts, and replies to Hugo. Use a comma, a full stop, brackets or a new sentence. Same for curly quotes and ellipsis characters. Hugo, 2026-07-27: "no long dashes ever, we don't use."
12. **Never launch a big multi-agent review on your own judgement.** Two adversarial-review Workflows in one session (37 then 39 agents) burned about 5.1M tokens and a quarter of Hugo's weekly Claude Code limit. Hugo, 2026-08-07, asked directly whether to keep doing them before risky launches and answered: **"trust"**. So: tests plus your own read of the code is the standard, even for code that sends real messages, moves money, or runs autonomously. Use the Workflow tool ONLY when Hugo asks for it in his own words that session. If a review does run and dies partway on a rate limit, say so plainly instead of reporting only the findings that finished.

---

## No long dashes

A standing rule, not a preference, and it is enforced rather than remembered.

- **Machine-checked** by `tests/message-copy.test.ts` for every message a lead receives. It fails the build.
- **Why it is not just taste:** a text is GSM-7 (160 characters a segment) only if *every* character is in the GSM 03.38 table. One long dash flips the whole message to UCS-2 and the segment drops to **70**. The old video text was 164 characters and cost **3 texts**; the new one is 211 characters, longer and friendlier, and costs **2**. Curly apostrophes do exactly the same damage.
- Helpers live in [api/lib/sms-charset.ts](api/lib/sms-charset.ts): `nonGsm7()` to detect, `toGsm7()` to rewrite, `smsSegments()` to price it.
- Outbound copy is written as plain straight punctuation. The AI reply prompt is told the rule in as many words, because a model copies the punctuation it is shown.

---

## Line status screening: the hand-run scripts only, the app is NOT covered

Built 2026-07-28 after Maria's cold batch. `libphonenumber` is an offline rulebook: it proves the number is a well-formed, allocated UK mobile and nothing more. `api/lib/phone-validation.ts` hardcodes `active_status: 'unknown'` for exactly that reason. Twilio `line_type_intelligence` does not help either, all 8 dead numbers came back `valid: true`, `type: mobile`, on real carriers.

### What is actually covered (read this before you trust anything else here)

The screen runs **only** in the lead scripts a human runs by hand in a terminal. **No part of the Elsie app screens anything.** The shared TypeScript helper `checkLineStatus()` is written and tested, and nothing imports it. Do not take that on trust, it is one command:

```bash
grep -rn "checkLineStatus" api src supabase scripts tests
```

Verified 2026-07-28: that returns exactly one line, the definition at `api/lib/twilio-lookup.ts:399`, and no callers anywhere in the product. If it ever returns more than one line, somebody has wired it in and this section is out of date.

**COVERED, the hand-run `.mjs` scripts, all sharing `scripts/lib/line-status.mjs`:** `feed-maria-leads.mjs`, `process-plumber-leads.mjs`, `assign-agent-batches.mjs`, `scrape-trade-leads.mjs`, `assign-trade-leads-to-pedro-marr.mjs`, `import-plumber-leads.mjs`, `blast-maria-website-opener.mjs`.

**NOT YET COVERED. Every send path the product itself uses is unscreened:**

| Send path | What goes out unscreened |
|---|---|
| `supabase/functions/wk-sms-broadcast` | in-product mass SMS |
| `supabase/functions/wk-jobs-worker` (`send_sms` job) | the delivery step for broadcasts, scheduled sends, outcome automations and VSL automation |
| `supabase/functions/wk-sms-send` | CRM inbox replies and the dialer |
| `api/cron/review-requests.ts` | **the main paying product**, texting a client's own customer list, which is exactly where years-old dead numbers live |
| `api/cron/vsl-auto-send.ts` | the VSL video texts |
| `api/cron/follow-up.ts` | automated follow-ups |

Also worth saying plainly: a screened list does not stay screened. A number is checked once, on the day it is imported, and nothing re-checks it before the app texts that person months later.

**Open decision for Hugo, do not take it for him.** Wiring the screen into the shared `send_sms` job worker would cover broadcast, the inbox and the crons in one place. The cost is that it adds a per-message lookup fee to the paying product, on every send, forever, including repeat texts to the same customer. That is a pricing call, not an engineering one, so it stays open until Hugo decides.

### How the check itself works

- **The check:** `GET https://lookups.twilio.com/v2/PhoneNumbers/{E164}?Fields=line_status`. Statuses are `active`, `reachable`, `unreachable`, `inactive`, `unknown`. Ground truth on the failed batch: 7 of 8 dead numbers were `inactive`, and all 91 that delivered were `reachable`. Zero false positives.
- **Only `inactive` is screened out.** `unreachable` is kept on purpose, it is a live subscriber with the handset off and the network queues the SMS. `unknown`, an HTTP 200 with `line_status: null`, and any undocumented status all fail open and keep the lead. Note `error_code` is a nullable integer *inside* the `line_status` object, not at the top level.
- **Cost, measured on our own account:** 117 lookups billed GBP 0.61893, so **GBP 0.00529 each**, GBP 5.29 per 1,000 leads. Twilio quotes usage before VAT and nobody has confirmed whether this account is VAT-charged, so budget GBP 6.35 per 1,000 until someone checks. It costs more than the texts it saves, roughly 3 to 1. We do it for the sender number's reputation with the carriers, not for the pennies.
- **Where it lives:** [api/lib/twilio-lookup.ts](api/lib/twilio-lookup.ts) (`lineAlive()` decides, `checkLineStatus()` runs cache-first with 20-way concurrency and 429 retry) and its script twin [scripts/lib/line-status.mjs](scripts/lib/line-status.mjs) (`screenLineStatus`, `dropDeadNumbers`, loads the repo `.env` itself so a run with only `SUPABASE_*` on the command line cannot silently fail open). Tests: `tests/line-status.test.ts`.
- **Cache is its own table with a 7-day TTL** (`phone_line_status_cache`, RLS on, no policies), never the 90-day `phone_lti_cache`. Line type is a numbering-plan fact, line status is live state, so a 90-day-old `reachable` would re-open the exact hole. Cache writes are fed from the misses only, so a repeat pass bills nothing.
- **Gate order inside those scripts, cheapest first, money last:** free offline format and line-type checks, then the existing Google Places / website / review checks, then `line_status` (paid, last), then write to the CRM.
- On a script send path a dead number is **dropped from the batch, it never aborts the batch**. The preflight aborts on copy problems because those are fixable, a dead subscription is not, and refusing to text 99 good leads over one of them is the wrong trade.
- **`SKIP_LINE_STATUS=1` is the no-spend switch, and it is NOT a dry run.** It skips the paid screen, so every number goes out unscreened. `SKIP_LINE_STATUS=1 node scripts/blast-maria-website-opener.mjs --apply` really does send 100 unscreened cold texts and really does charge for them. All the flag saves you is the lookup fee.
- **There is no single "nothing happens" switch. Check the script first.** Only three of the seven take `--apply`, and only those three are dry by default:
  - **`--apply` exists, dry until you add it:** `scrape-trade-leads.mjs`, `assign-trade-leads-to-pedro-marr.mjs`, `blast-maria-website-opener.mjs`. Without `--apply` they send no text and write no lead. They can still **charge** for the line-status lookups, because the screen runs before the dry-run exit so the preview counts are real. Not free, just harmless.
  - **NO `--apply`, writes on every single run:** `feed-maria-leads.mjs`, `process-plumber-leads.mjs`, `assign-agent-batches.mjs`, `import-plumber-leads.mjs`. Running one of these imports leads into the CRM and queues them to a campaign immediately. `node scripts/feed-maria-leads.mjs list.csv 1000` writes 1,000 leads and spends about GBP 5.29. There is no preview mode. None of them texts anybody, but the CRM is changed for real.
  - To try one of the second group safely, ask for a tiny count first (say 5) and look at what landed before running the real number.
- A cost estimate for the lookups is always printed before any lookup spend, including under `SKIP_LINE_STATUS=1`, which is the only thing about that flag that resembles a dry run.

---

## `region=uk` on a Google Places search restricts NOTHING

Learned 2026-07-28. Full write-up: [docs/VIDEO_SERP_TRUTH.md](docs/VIDEO_SERP_TRUTH.md).

`region=uk` is a **bias**, not a filter. "pest control in Scarborough" comes back
four-sevenths Canadian, because Scarborough is also part of Toronto. Over 727 real
result rows from 60 town searches, 6 were foreign and 4 of those landed on one lead.
This put Toronto firms in a Yorkshire lead's video, and inflated the stored `rank` /
`plumbers_ahead` that **agents read out loud on calls**.

| What you want | What actually does it |
|---|---|
| Restrict to the UK | Geocoding `components=country:GB` (hard), or Nearby Search `location`+`radius` around a GB point |
| Nothing at all | Places Text Search `region=uk` |

Two more traps from the same day, both the same shape (two parts of the repo each
holding their own idea of who a competitor is):

- **Detect the country by the SUFFIX, never the postcode shape.** Canadian postal
  codes ("M1J 3C9") look exactly like British ones. `inUk()` reads the last
  comma-separated part: a UK address ends in a postcode (has a digit), a foreign one
  ends in its country name (does not).
- **A name blocklist cannot keep shops out.** "pest control in Taunton" returns Pets
  at Home (1,395 reviews) and a garden centre (790) above every real pest controller,
  because shops collect thousands of reviews and a one-van trader collects forty. Use
  Google's `types`: shops carry `store`, tradesmen never do.

The rules live in ONE place, [api/lib/uk-places.ts](api/lib/uk-places.ts), with an
`.mjs` twin for the scraper. `tests/uk-places.test.ts` fails if the two drift. Do not
re-derive "who ranks above this lead" anywhere else, that is the bug.

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

**⚠️ THE PROPERTY BUSINESS IS DOCUMENTED IN THE OTHER FOLDER, ON PURPOSE.**
Before touching `brrr_properties`, Pedro's offer numbers, the property script or
anything on the property pipeline board, read:

> **`/Users/hugo/Whats/scraper/BRRR_STRATEGY.md`**

That is the single source of truth for what a deal is, how the offer is
calculated, and what Pedro is allowed to say. It lives in the scraper folder
because that is where the engine that produces the numbers lives, and **there is
deliberately only one copy of it**. Do not copy it here. Two copies drift, and
on 2026-08-13 five separate docs across both folders were each claiming to be
the current strategy while describing an abandoned one.

⚠️ **`docs/VALUATION_ENGINE.md` and `docs/BRRR_ADD_VALUE_PIVOT.md` below are
SUPERSEDED** and carry banners saying so. `VALUATION_ENGINE.md` in particular
says "GDV is never an input to the offer" and "offer is never above asking",
both of which are now the opposite of what we do.

Keep these current as we go:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)
- [docs/BUILD_PHASES.md](docs/BUILD_PHASES.md)
- [docs/DECISIONS_LOG.md](docs/DECISIONS_LOG.md)
- [docs/PLUMBER_LEADS_PIPELINE.md](docs/PLUMBER_LEADS_PIPELINE.md) — **loading a plumber-leads CSV**: run `scripts/process-plumber-leads.mjs` (named-owner only → Google-enrich reviews → drop >65 → import+queue → order A→Z). Hugo points you at a CSV; this is the one right way.
- [docs/SMS_BLAST_PLAYBOOK.md](docs/SMS_BLAST_PLAYBOOK.md), **read before any bulk send**: every rule in it exists because something went wrong, including the line-status screen above.
- [docs/VIDEO_SERP_TRUTH.md](docs/VIDEO_SERP_TRUTH.md), **read before touching the video's Google search**: who may appear above a lead, why `region=uk` does not restrict anything, and why the render refuses.

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
- **NO ROBOT EVER CALLS AN ESTATE AGENT. Retired 2026-08-09, do not rebuild it.**
  Hugo: *"the robot, it doesn't exist, we don't want to use that any more, no more robot calls for the properties, that was just a test, we're not gonna do that."* The AI qualifier ran for one month in June, made 26 calls, and is gone. **Estate agents are rung by a human agent in the CRM dialer. That is the only path.**
  - **Deleted, not disabled:** `api/cron/process-property-calls.ts`, `scripts/create-property-qualifier-agent.mjs`, the Vercel cron entry, the ingest auto-queue branch, the admin dial button (its API action now returns **410**), and every dead control in the admin Call rules panel (attempts, retry gap, dials/run, auto-call-on-send, calling hours and days) since the cron was the only reader of them.
  - **Pinned by `tests/property-no-ai-calls.test.ts`**, which fails if the cron file reappears, if a property cron is registered in `vercel.json`, or if anything in `api`/`src`/`supabase`/`scripts` calls `queuePropertyCall()`.
  - `queuePropertyCall`, `handleBrrrCallEvent` and `sweepStuckExtractions` still exist in `api/lib/brrr.ts` with **zero callers**. The Retell agent `agent_539daa8b3bedf3d3de876276a2` still exists in Retell with its webhook pointed at `legacy.hostunico.com`, and `RETELL_PROPERTY_AGENT_ID` / `PROPERTY_FROM_NUMBER` are still blank in production. Leave all of it alone.
  - **`brrr_properties.call_channel` now means "who owns it", not "which robot"**: `'ai'` is the default and reads as *not yet handed to an agent*; `scripts/assign-properties-to-pedro-houses.mjs` flips a whole BRANCH to `'human'` when Pedro takes it. Never per property, because one agency lists many houses.

- **BRRR property sourcing (2026-06-10, rebuilt for humans 2026-08-09)** — see [docs/BRRR_QUALIFIER_PLAN.md](docs/BRRR_QUALIFIER_PLAN.md):
  - **The scraper is NOT in this repo** (a partial copy on `main` was deleted in July and would not even import). It runs on **margarita-server** at `/root/scraper`, systemd unit `margarita-scraper`, served at **https://scraper.heyelsie.com** behind nginx basic auth (user `hugo`; password in Claude memory `credentials_scraper_site`). Backed up to the private repo **hrds100/property-scraper**. The Mac launchd job `com.margarita.propertytool` is the retired path. "Send to Elsie" on its Comps tab → `POST /api/properties/ingest` (secret `PROPERTY_INGEST_SECRET`, scraper keeps it in `data/elsie.json`) → **files the property and stops. It never starts a call.**
  - Admin tabs: **BRRR → Scraper** (embeds scraper.heyelsie.com; `/api/floorplans/stats` is deliberately un-gated so the status badge works, everything else needs the password), **BRRR → Properties**, **BRRR → Pipeline** (embeds /leads)
  - `brrr_settings` in `platform_settings` still holds the retired cron's keys, but the admin panel now exposes only `offer_low_pct` / `offer_high_pct`, the fallback band used when a property arrives with no valuation
  - Tables `brrr_properties` + `brrr_property_calls` (admin-only, no RLS). **Both were emptied on 2026-08-09** along with the scraper's own `rm_*`/`zp_*` tables; backups in `/root/backups/property-wipe-2026-08-09/` on the VPS
  - Admin tab **BRRR → Properties** (`/admin/properties`): numbers, floor plans, transcript viewer, and Hugo's deal calculator in the drawer
  - Env still set: `PROPERTY_INGEST_SECRET`, `PROPERTY_PIPELINE_BUSINESS_ID`

- **Houses for Pedro — the human path (2026-08-09)**, see Claude memory `project_houses_pedro`:
  - Pedro's room: `/admin/crm/dialer-pro?script=property_call`. Offer band **pinned above the script**, right tabs swap to Houses · Coach · Messages
  - Third sales script (`wk_property_call_script` + `src/core/content/property-call-script.html`), third `ScriptKey`, third hook. Separate tables so editing one can never touch the plumber script Pedro and Marr read on every dial
  - `wk_calls.script_key` gained `'property_call'`; `leadFacts` in `wk-voice-transcription` branches on `custom_fields.lead_type === 'estate_agent'`, so the coach stops talking about Google reviews
  - **Offers are never a % of GDV.** One shared module `api/lib/brrr-offer.ts`; `tests/brrr-offer.test.ts` fails the build if anyone reintroduces it
  - **Script rewritten 2026-08-10, day one of real calls.** Pedro now says who he is (name, "I work with our director Hugo at Unico", cash) and **negotiates on the call himself** (offer without offering, ask THEM for a figure, push back once, climb the ladder a rung at a time). "I'll speak to my director" moved from the opener to a lever used later. Never a formal offer, never a viewing: both unchanged. Objection panels 9 → 30. `PROPERTY_OBJECTIONS` in `wk-voice-transcription` gives the coach the same answers and **replaces** the Elsie knowledge base on a property call. Fifth outcome **`figure_obtained`** → `next_step: 'awaiting_director'` → its own pipeline stage, so the ones needing Hugo's decision are not buried in Qualified. ⚠️ The registered address in the script (483 Green Lanes, London N13 4BS) is the Companies House one; Hugo said something different by voice and has not confirmed it
  - **Pedro lands on the property business, every road in (2026-08-10 evening).** Hugo, tenth time that day: "this business is dead. He should land on the real estate business." `profiles.landing_path` ('/admin/crm/dialer-pro?script=property_call', set ONLY for pedro@hostunico.com) is honoured by /login, by "/" on the app host, AND by the bare dialer itself: `scriptFromLandingPath()` in `src/features/crm/lib/scriptForCall.ts` makes it the room's default script, so the sidebar Dialer link, bookmarks and History redials all open the property script. NULL landing_path (everyone else) keeps cold_call byte-identically, and vsl_close is refused as a standing default. Pinned by `tests/login-landing.test.ts` + prod e2e `tests/e2e/pedro-houses-landing.spec.ts` (creds via env, never committed).
  - **The 5:30 daily report is BUSINESS-AWARE (2026-08-10).** A day with any `wk_calls.script_key='property_call'` grades against the property script (DB copy first, bundled file fallback shipped via vercel.json `includeFiles`): availability opener, Unico+cash intro, fact checklist, floated figure, asked THEM for a figure, `lead_named_figure` (the score), callback time, rule breaks (formal offer / booked viewing / sourcer talk, script deflection lines excluded). The Houses-tab outcome log is part of the grade. Sales days grade exactly as before. Both prompts forbid long dashes. The first property day's report (which had graded Pedro zero against the dead reviews script) was regenerated the same evening. — see Claude memory `project_pedro_training`. Both noindex + robots Disallow and **not to be shared**.
    - **The two PINs are different on purpose and must stay different.** Hugo asked for one PIN; it was refused. Pedro knows 1176, and `/hugo-training` is the ANSWER KEY. Hugo's PIN lives in `api/lib/training-hugo.ts` (server only, `HUGO_TRAINING_PIN` env with an `8642` fallback) and is **never compared in the browser** — his page posts what was typed and reads the 401.
    - **Nothing under `src/` may import `api/lib/training-questions.ts` or `api/lib/training-hugo.ts`.** Either one ships the answers or the PIN to the browser. `tests/training-answer-key.test.ts` fails the build on both, and on a Hugo route accepting Pedro's `pinOk`.
    - **The video list is one config**, `TRAINING_VIDEOS` in `api/lib/training.ts`: 4 required, 2 optional. Adding one is a single entry. Course lessons are self-hosted in the PRIVATE `training-videos` bucket behind 4-hour signed URLs; **YouTube videos are EMBEDDED, never downloaded**. Watch tracking is `video.played` coverage for mp4s and marked-second polling for YouTube, never `currentTime`, and only ever moves up.
    - ⚠️ The YouTube IFrame API **replaces the node you give it**: hand it a div created in the effect, never a React-rendered one, or unmount blanks the page.
    - Routes are `api/pedro-training/*` and `api/hugo-training/*`, deliberately NOT `api/training/*` (that is the unrelated Elsie agent knowledge trainer). Progress at **`/admin/training`**. Both slugs are in the `vercel.json` apex lookahead, or they would be eaten by the VSL page rewrite.

- **Working agreements are ROLE-SCOPED, one signable URL each (2026-08-10)** — see Claude memory `project_agent_onboarding`:
  - `wk_agent_agreement` is no longer a singleton. One row per role keyed by `slug`: **`sales-closer`** (B2B Sales Closer, mode `account`, still on the original **/join**) and **`property`** (Property Deal Sourcing Caller, mode `sign_only`, on **/join/property**). Migration `20260810000003_role_agreements.sql`.
  - **The two agreements name two different companies, on purpose.** Sales closers sign with **HeyElsie** (they sell the HeyElsie reviews product). Property callers sign with **Unico**, which is what they say on the phone in `src/core/content/property-call-script.html`, and the agreement names the contracting entity in a "Who you are working with" section: **ULINC UNICO GROUP LTD**, company number **11197856**, registered office **483 Green Lanes, London, England, N13 4BS** (the Companies House record, same as `heypubli/features/legal/`). Migration `20260810000004_property_agreement_unico.sql`. The company drives the page header and badge letter, the confirmation email and the printable copy, so it is set in ONE place per agreement and never hardcoded. E2E fails if either name leaks into the other agreement.
  - **`mode` is the whole point.** `account` = the old flow (6-digit code, password, creates a capped CRM agent). `sign_only` = read, name, drawn signature, confirm email, submit, and **nothing else happens**: no account created, no existing account touched. Pedro already had a login, so the 409 "an account already exists" guard was the wrong answer for him. That guard is untouched on the account flow, and `sign.ts` now refuses `sign_only` agreements outright.
  - **The signature is the record, not a pointer to one.** `wk_agreement_signatures` stores a full snapshot of title, intro, company, terms and tick boxes as they read at the moment of signing, so editing the agreement later can never rewrite what somebody agreed to. Admins get **SELECT only**, there is deliberately no UPDATE or DELETE policy. `version` on the agreement auto-bumps whenever the wording changes. Pinned by `tests/agreement-snapshot-immutable.test.ts`.
  - **This already happened for real, do not undo it.** Pedro signed the property agreement at 12:21 UK on 2026-08-10 on **version 2**. Hugo then changed the pay terms (now **version 3**) and chose to tell Pedro verbally rather than have him re-sign. So Pedro's stored copy says the OLD terms, *"paid within 72 hours, in practice Monday morning"*, and it must keep saying that. The live clause is *"released the next day, every Saturday, sent to you by Wise, please allow until midnight on Saturday"*. Migration `20260810000005_property_pay_saturday_wise.sql`.
  - **The payment rail is Wise for property.** Hugo said "direct debit", which is the wrong term (a direct debit pulls money OUT of an account). Payoneer and the Monday timing still appear in the **welcome email in `api/agent-onboarding/verify.ts`**, which only ever runs on the account-creating flow, so the property agreement never reaches it. Whether Payoneer is still right for the closer role is an open question for Hugo.
  - **A signature is filed against whatever login the email matched.** Pedro signed with `preyes1588@gmail.com` (his old sales-closer account) rather than `pedrohouses@heyelsie.com`. The record is left exactly as typed; the admin table names the matched CRM account underneath the email instead, and flags any signature taken on an older version.
  - The tick-box acknowledgements now live in the row (`acks`), not hardcoded in `AgentJoinPage.tsx`, so each role confirms its own terms.
  - Hugo edits both agreements and reads every signed copy (View / print) in **Settings → Agents & spend**. Print rendering is one shared module, `src/core/agreements/signedAgreementDoc.ts`.
  - No `vercel.json` change was needed: the apex VSL catch-all only swallows single-segment paths, and `/join/property` is two.

- **Twilio SMS geo-permissions — per-country allowlist (learned 2026-07-16 the hard way)**:
  - Twilio blocks outbound SMS to any country not ticked at Console → Messaging → Settings → Geo Permissions. Error = **21408**, shows under "Fraud" in the health score. 129 sends died this way on 2026-07-16 (US wasn't ticked).
  - **US + Canada enabled 2026-07-16.** Before texting any NEW country (Australia, etc.), tick its box FIRST.
  - There is **NO REST API** for SMS geo-permissions (voice-only DialingPermissions exists) — the console (via Kimi WebBridge/Comet) is the only way to change it.
  - Separate rule, don't confuse: US toll-free (833) → UK mobile = error **21612**, impossible regardless of geo-permissions.

- **HeyElsie Reviews — THE MAIN PRODUCT (shipped 2026-07-20)**: full Review Harvest clone. Landing = heyelsie.com; client app + onboarding = go.heyelsie.com; admin = /super/reviews. Pricing £99/£179/£279 (volume-only tiers; **£1 today then a 10-day trial on EVERY door** — canon `api/lib/review-plans.ts`, Stripe product `prod_Uv8eim0pBOmEGZ`). Engine: `api/cron/review-requests.ts` (every minute) with suppression-first guards (STOP webhook `api/webhooks/twilio-reviews-sms.ts`, fail-closed sigs), quiet hours 09:00–20:00, tier caps in `review_usage`, drip pacing, personalized images (sharp+opentype, `review-assets` bucket). Google side = Zernio (`src/integrations/zernio/`, env `ZERNIO_API_KEY`, webhook `api/webhooks/zernio.ts`). Sender numbers = **admin-bought only** (/super → Numbers; GB Mobile REQUIRES the approved regulatory bundle — error 21649 otherwise, see api/admin/reviews/numbers.ts). UK long codes can't MMS — the personalized image travels via email embed / link. Compliance enforced in code: send-to-all only, incentive-word lint, PECR attestation gate. Docs: PLAN.md, ARCHITECTURE.md, REVIEWHARVEST_MAP.md, FINAL_REPORT.md. Receptionist intact behind existing flags; reviews clients get flag `reviews`. **Integrations directory live (2026-07-23)**: `/integrations` in the client app (data in `src/features/reviews/integrations.ts`). Webhook & Zapier card is live TODAY (surfaces the `review_settings.inbound_token` trigger URL — `api/reviews/trigger` existed but the token was never shown in UI). Verified API statuses: ServiceM8/simPRO/Joblogic/Jobber/GoCardless/QuickBooks/Xero = real public APIs (coming soon); Commusoft = partner-gated docs; Tradify/Powered Now/CleanManager = NO public API and NO Zapier app (Tradify workaround = Xero/QBO invoice-paid). Next for ServiceM8: register as Development Partner (OAuth App ID/Secret — env `SERVICEM8_CLIENT_ID/SECRET` when built).

- **VSL funnel tracking + notifications (2026-07-26)** — all nine signals captured, timestamped, notified. Migrations `20260727000001/2/3`.
  - **Was broken:** `calc` beacons were rejected by the `wk_vsl_events` CHECK and the insert never read `error` — silent since launch. All three inserts now log it.
  - **New events:** `link_click` (server-side in `api/vsl/page.ts` — Hugo kept the pretty link, so the page request IS the click), `play`, markers `[10,25,50,75,90,100]`, `ended`, and a `pagehide` flush of exact coverage.
  - **Watch % is `video.played` coverage, NOT `currentTime`.** The page has a seek bar; playhead-based % let a lead drag to the end and register a full watch, tripping `completed_at` and the "saw you watched the video" nudge. `cov()` sums the decoded ranges. E2E asserts a drag scores <90.
  - **Preview fetchers are excluded by REQUEST HEADERS, not User-Agent.** iMessage previews with a stock Safari UA the instant the SMS lands. Gate = `sec-fetch-dest: document`, no prefetch, GET only. Bots are logged with `meta.bot` (visible in the drawer) and never notify.
  - **`wk_vsl_advance` now takes `p_link_click`/`p_play`/`p_completed` and RETURNS `pct_before` + `first_*` flags** computed under its row lock → `crossedMilestones()` makes each milestone notify exactly once. **The `revoke` after the DROP is load-bearing** — it is SECURITY DEFINER, so without it anon could set any page to `paid`.
  - **Beacon HMAC** (`VSL_BEACON_SECRET`, hour-bucketed, verified via `crypto.subtle`). Forged beacons previously flipped state → real nudge SMS to real leads. Fails OPEN if unset.
  - **Notifications:** `wk_notifications` (RLS `agent_id = auth.uid() or wk_is_admin()`, service-role writes) → bell + desktop pop-up + email. `notifyFunnelEvent()` writes the row only; **email drains from `/api/cron/notify-drain` every minute** — never inline (no `waitUntil` in this stack; `sendEmail` throws on a Resend 429; a blank sales page beats a late email). Per-event toggles in the settings drawer; `deepMerge` must list `notify` or one save wipes the rest.
  - **Seen at:** funnel board (conversion strip from `wk_vsl_funnel_summary`, per-stage stamps, activity drawer = the first reader of `wk_vsl_events`), lead timeline (inbox + contact detail), leaderboard **Calls | Video funnel** toggle, bell. Board preview links carry `?p=1` so internal viewing doesn't burn a lead's first touch.
  - **Counts come from the `*_at` columns, never `state`** (forward-only: a paid lead is not in `opened`). Leaderboard roster widened to include admins holding VSL pages, or Hugo's own numbers were invisible.

- **Property deals: TWO BRAINS + the overnight machine (2026-08-11).** Founding case: Holloway Head B1, a 2-bed ex-council tower flat asking 100k, "worth" 293,296 off luxury new-build comps 100m away, queued to Pedro at a 95,000 opener. Fixes, both sides:
  - **VPS**: `valuation.py` re-anchors the band to asking when its own opener lands near asking (`cmv_far_above_asking_reanchored`); NEW `deal_auditor.py` (second brain) judges every priced deal and kills `valuation_not_credible` / `stale_bargain` (only when NOT same-street-backed; week-seven listings are the strategy) / `opener_at_asking` / `conversion_adds_no_value`. Both send paths run it; kills live in `rm_audit_rejects`, re-judged nightly. `/root/scraper/CLAUDE.md` carries Hugo's law (brain not scraper, green light to refactor, quota honesty).
  - **Repo**: `api/properties/ingest.ts` refuses `pursue:false` and un-forced audit kills (422). `worth_after_bed` (the engine GDV) now reaches `custom_fields`, script tokens, the coach, and the admin table (nested-shape fix at `PropertiesPage`). Evidence sentences come from `deal.cmv.audit` rows (raw sold price, never adj) — the flat `deal.evidence` key does not exist in the nested shape and was printing "no sold comparables on file" beside a real valuation. Best-deal-first sorts read `deal.offer.max` (RPC migration `20260811000002` + `property-branches.mjs`).
  - **Call history = the whole deal**: "Full deal" on any property call opens `DealSnapshotDrawer` (same OfferStrip Pedro sees, evidence, flags, call outcome, and the `computeDeal` sums ADMIN-ONLY; `dealMaths` moved to `src/core/lib/`, boundary re-pinned in `tests/deal-calculator.test.ts`). E2e `tests/e2e/deal-snapshot-drawer.spec.ts` proven on prod.
  - **A branch that has been called is NEVER dealt again (2026-08-11 evening).** Pedro, mid-shift: *"the leads repeated, this one I have already spoken earlier to she said"*. He was right. The only duplicate guard the assign script had was "is there a `pending` row", which is false the second he finishes a call, so a re-run handed him back exactly the offices he had just worked, ABOVE the 58 nobody had rung. 17 branches were dialled twice or three times that day; McDonald of Bispham said no at 15:03 UK and was dealt back at 16:26 and rung again at 17:30. Now `scripts/lib/redial-policy.mjs` decides, on every run, from `wk_calls` history: called once means held back (facts still refreshed, new listings still filed, no queue row). `--redial-unanswered` re-deals the no-answers after 20 hours, `--redial-all` re-deals the lot, and both go to the **back** of the queue. `Ballpark` was missing from the "they spoke to us" list, so the one outcome where a branch actually named a figure was the one eligible for a cold re-ring. Pinned by `tests/property-redial.test.ts`.
    - **Same fix, second hole:** `--refresh` used to load `call_channel='human'` INSTEAD of `'ai'`, and the overnight machine's only assign step is `--refresh --apply`. So the nightly run was structurally incapable of queueing a branch it had never seen: every house the scrape found sat unqueued until somebody ran the script by hand. `--refresh` now loads both. Only a listing filed AFTER the last call reopens a branch (and only after the 20-hour gap), which is what stops the rule from slowly starving the queue as every office gets rung once.
  - **Overnight**: `property-overnight.timer` 00:30 UK → scrape 33 searches (20 terraced towns added; county REQUIRED in region match, bare "St Helens" resolves to the Isle of Wight), floor plans, Gemini read, postcodes (Nominatim fallback when no `GOOGLE_GEOCODE_KEY`), `fast_comps`, value+audit+send, `/root/elsie-assign` queues Pedro (`--refresh --apply`; COPIES of the assign script, re-copy on change), `morning_report.py` emails Hugo (Resend needs a User-Agent or Cloudflare 1010s). Purge tool: `scripts/prune-audit-killed.mjs` (also strips stale money fields off emptied branch contacts, so a History redial can never coach dead numbers).

### What's next
1. First real Zernio GBP connect (needs a Google Business Profile login) + Zernio card-on-file for review webhooks
2. New Unipile key (receptionist inbox down; also unlocks the WhatsApp review channel later)
3. First paying reviews client via the closer runbook (FINAL_REPORT.md §5)
4. v2: multi-location "Add Business", FB/IG social posting, automated gift-card payouts

---

## Identity — do not confuse with other projects

This is **Elsie** (formerly Poppy), not Lemlin. Never reference Lemlin, instagrapi, iProyal, GHL, Fly.io workers, or any Lemlin-specific concepts. Hugo runs multiple projects — keep them separate.

---

## Agent behavior principles

Rules for any AI agent working on this project — apply every task, every session.

**Act when ready.** When enough information exists to act, act. Do not re-derive established facts, re-litigate decided questions, or narrate options you won't pursue. If weighing a choice, give a recommendation — not a survey.

**Lead with the outcome.** The first sentence after finishing work should answer "what changed" or "what did you find." Supporting detail follows. Never open with process narration.

**Don't scope-creep.** Don't add features, refactor, or introduce abstractions beyond what the task requires. A bug fix doesn't need surrounding cleanup. Don't design for hypothetical future requirements. Don't add error handling for scenarios that can't happen. Trust framework guarantees — only validate at real system boundaries.

**Only pause when genuinely needed.** Pause only for: a destructive or irreversible action, a real scope change, or input only the user can provide. For reversible actions that follow from the original request, proceed. End a turn only when the task is complete or you are genuinely blocked.

**Ground progress claims.** Before reporting something is done, verify it against an actual tool result from this session. If a step is not yet verified, say so. If something failed, say so plainly.

**Assessment before action.** When the user is describing a problem, asking a question, or thinking out loud rather than requesting a change, the deliverable is your assessment — report findings and stop. Don't apply a fix until asked.

**Escalation beats guessing.** Every agent will hit a case it can't handle. When uncertain on something consequential: say so and ask, rather than guess and proceed. Silent failures cost more trust than honest "I don't know."

**Narrow scope outperforms broad scope.** A focused agent that does one thing reliably beats a broad agent that does five things unpredictably. When in doubt, do less — more reliably.

**Memory: record corrections AND confirmed approaches.** When saving to memory, capture why something matters — not just what. A confirmed approach that worked is as worth recording as a correction. Don't save what the repo or chat history already records.

**Keep memory current — always.** After any substantive change, decision, or discovery, update the Claude memory dir (`~/.claude/projects/-Users-hugo-Whats-Poppy/memory/`) and its `MEMORY.md` index BEFORE ending the task, so the next agent starts from live state — not a stale snapshot. Prefer updating an existing memory file over creating a near-duplicate.

**Don't reproduce internal reasoning in responses.** Don't write prompts or instructions that tell the model to echo or explain its internal reasoning as output text. Output should be the answer, not the working.

**Self-verify on complex builds.** After finishing anything more than a small edit, check the work against what was asked before reporting done.
