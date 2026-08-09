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
- **BRRR property qualifier live (2026-06-10)** — see [docs/BRRR_QUALIFIER_PLAN.md](docs/BRRR_QUALIFIER_PLAN.md):
  - **The scraper is NOT in this repo** (a partial copy on `main` was deleted in July and would not even import). It runs on **margarita-server** at `/root/scraper`, systemd unit `margarita-scraper`, served at **https://scraper.heyelsie.com** behind nginx basic auth (user `hugo`; password in Claude memory `credentials_scraper_site`). Backed up to the private repo **hrds100/property-scraper**. The Mac launchd job `com.margarita.propertytool` is the retired path. "Send to Elsie" on its Comps tab → `POST /api/properties/ingest` (secret `PROPERTY_INGEST_SECRET`, scraper keeps it in `data/elsie.json`) → **auto-queues the call** unless `call_channel='human'`
  - Admin tabs: **BRRR → Scraper** (embeds scraper.heyelsie.com; `/api/floorplans/stats` is deliberately un-gated so the status badge works, everything else needs the password), **BRRR → Properties**, **BRRR → Pipeline** (embeds /leads)
  - Call rules adjustable in admin (key `brrr_settings` in `platform_settings`): attempts, retry gap, dials/run, days/hours, offer min/max %
  - Tables `brrr_properties` + `brrr_property_calls` (admin-only, no RLS)
  - Admin tab **BRRR → Properties** (`/admin/properties`): numbers, floor plans, "Call agent" button, transcript/recording viewer
  - Outbound qualifier agent: `agent_539daa8b3bedf3d3de876276a2` / LLM `llm_3da4d9ae0e456b8498b09b000b3e` (cartesia-Willa, en-GB, press_digit IVR tool, honest-AI, introduces itself as **Elsie** for Airbrick Properties). NO agents-table row on purpose (sync-prompts would clobber it). **Currently DARK**: `RETELL_PROPERTY_AGENT_ID` and `PROPERTY_FROM_NUMBER` are empty in production, and its Retell webhook points at `legacy.hostunico.com`, not at us. Repoint the webhook BEFORE ever restoring those env vars, or calls fire and every transcript lands in the wrong app
  - Dial cron `/api/cron/process-property-calls` every 2 min: UK-hours guard (Mon–Sat 09:30–17:00), atomic claim, max 2 dials/run, 3 attempts, 30-min same-agency spacing
  - Retell webhook branches on `metadata.type === 'brrr_property'` → Claude extracts qualification → qualified properties become deals in Hugo's live pipeline (stage "Qualified") + email notification
  - Env: `PROPERTY_INGEST_SECRET`, `RETELL_PROPERTY_AGENT_ID`, `PROPERTY_FROM_NUMBER`, `PROPERTY_PIPELINE_BUSINESS_ID`

- **Houses for Pedro — the HUMAN path (2026-08-09)**, see Claude memory `project_houses_pedro`:
  - Same two tables, second channel. `brrr_properties.call_channel` is `ai` or `human` and is set **per BRANCH, never per property** by `scripts/assign-properties-to-pedro-houses.mjs`, because one agency lists many houses and a half-handed-over branch means both channels ring the same switchboard
  - Human call rows are shaped so all four AI queries skip them (`status:'completed'`, `retell_call_id:null`). The ONE deliberate crossover is the cron's 30-minute spacing window, which DOES see them on purpose. Pinned by `tests/property-human-call-isolation.test.ts`
  - Pedro's room: `/admin/crm/dialer-pro?script=property_call`. Offer band **pinned above the script**, right tabs swap to Houses · Coach · Messages
  - Third sales script (`wk_property_call_script` + `src/core/content/property-call-script.html`), third `ScriptKey`, third hook. Separate tables so editing one can never touch the plumber script Pedro and Marr read on every dial
  - `wk_calls.script_key` gained `'property_call'`; `leadFacts` in `wk-voice-transcription` branches on `custom_fields.lead_type === 'estate_agent'`, so the coach stops talking about Google reviews
  - **Offers are never a % of GDV.** One shared module `api/lib/brrr-offer.ts`; `tests/brrr-offer.test.ts` fails the build if anyone reintroduces it

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
