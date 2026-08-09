# BUILD BRIEF: Website Factory

Paste-ready brief for a coding agent working in this repo. Written 2026-07-28.

---

## 0. Where you are

Repo: `/Users/hugo/Whats/Poppy`. Product is **Elsie** (app.heyelsie.com). Not Lemlin,
not NFStay. React 19 + Vite + TypeScript + Tailwind v3, Supabase (Postgres, Auth,
Realtime, Storage), Vercel serverless in `api/*`, Retell AI + Twilio for voice,
Anthropic for AI, Stripe for billing, Resend for email. CRM tables are prefixed `wk_`.

Read `CLAUDE.md` first, then `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
`docs/PLUMBER_LEADS_PIPELINE.md`.

## 1. The situation, plainly

This SMS is **already going out** to real UK plumbers with no website
(`scripts/blast-maria-website-opener.mjs`, copy approved verbatim by Hugo):

> Hey {first}, this is Pedro. I saw you on Google and noticed you dont have a website. I know this is kinda random, but I built you one :). Wanna see it?

Nothing is built. When the lead replies "yes", or when a call ends and the rep
promises it, we need a **finished, genuinely beautiful website for that specific
business** ready to send as one link, in seconds, with no human design work.

That website is the demo that sells. It has to look like something they would pay
for, not like a template with their name pasted in.

## 2. Phase 0: audit and propose. Write NO feature code yet.

Your first and only deliverable right now is `docs/WEBSITE_FACTORY_PLAN.md`.
Hugo reads it and says yes before you build anything.

Read these before you propose, because most of what you need already exists in
some form and must be reused, not reinvented:

| File | Why it matters |
|---|---|
| `supabase/migrations/20260725000001_vsl_funnel.sql` | `wk_vsl_pages` / `wk_vsl_events`. This is the exact shape of "one personalized public page per lead, with forward-only funnel state". Your site table should mirror it. |
| `api/vsl/page.ts` | Server-rendered per-lead page on a pretty slug, real OG tags for the SMS preview, HMAC-signed tracking beacons, bot filtering by request headers. Copy this pattern. |
| `api/vsl/track.ts` + `supabase/migrations/20260727000002_vsl_funnel_tracking.sql` | How view events advance state and notify exactly once. |
| `src/features/crm/pages/VideoFunnelPage.tsx` | The existing funnel board. The websites board should feel like its sibling. |
| `api/widget/[type].ts` | Existing public embeddable widget: edge runtime, settings via query string, server-embedded data, no auth. Precedent for the chat widget embed. |
| `api/lib/trades.ts` | The ONE definition of a trade. Site copy must resolve trade from here, never hardcode "plumber". |
| `api/numbers/provision.ts`, `api/numbers/request.ts`, `src/integrations/retell/`, `src/integrations/twilio/` | Voice provisioning as it works today. |
| `supabase/migrations/20260727000011_ai_reply_reviews_prompt.sql` | How an editable AI prompt is stored today. |
| `supabase/migrations/20260727000006_stage_history.sql`, `wk_pipeline_columns` | Stage moves are already stamped and audited. Reuse this, do not build a parallel pipeline. |
| `scripts/blast-maria-website-opener.mjs` | The live promise, and the correct CRM send path. |
| `tests/message-copy.test.ts` | The punctuation rule is machine enforced. |

Your plan doc must answer, with real file paths and real DDL:

1. Table design (site record, content document, events, extension mapping).
2. How generation works end to end, and what it costs per site.
3. The renderer and how many templates ship at launch.
4. How the public URL is shaped and what the SMS link looks like.
5. How the receptionist extension routes a real inbound call to the right business.
6. How the chat widget works and where its conversations land.
7. What our internal admin looks like, screen by screen.
8. How it shows in the CRM so a rep can follow the sale.
9. What the owner's own admin looks like, screen by screen, field by field.
10. Phase order, with a test at every phase.
11. The open questions in section 10 below, answered or asked.

## 3. Generation

Input is a `wk_contacts` row. The lead pipeline already populated `custom_fields`
with `owner_name, town, trade, reviews, rating, rank, website, google_search_url,
competitor_1/2, plumbers_ahead, total_plumbers`. Use it.

**Architectural rule, not a suggestion: the model fills a typed content document,
it does not write HTML.** Claude produces JSON validated against a strict schema
(sections, headlines, body copy, service list, colour token choice, image slots).
The renderer is fixed React or server-rendered components. Reasons:

- Quality stays consistent instead of drifting per generation.
- Every field in the document maps to one field in the owner's editor. Free-form
  HTML would make the owner admin impossible to build.
- A bad generation is re-runnable and diffable.

Generation must always carry **their** business name, owner first name, town and
trade through the copy. The site should read as if it was made for them.

### Truth rules, non-negotiable

Never invent, in generated copy or images:

- review counts, star ratings or review quotes we did not pull from Google
- Gas Safe numbers, NICEIC, insurance, certifications, memberships, awards
- years in business, team size, staff photos, van photos, job photos
- prices, guarantees, response times, service areas we were not told

Anything unknown is either omitted or rendered as a clearly marked placeholder the
owner fills in their admin. A plumbing site claiming Gas Safe registration it does
not hold is a legal problem, not a copy problem.

## 4. The quality bar

The **cinematic-ui** skill is installed at `~/.claude/skills/cinematic-ui`
(open source, MIT, `github.com/akseolabs-seo/cinematic-ui`). In Claude Code invoke
it with `/cinematic-ui`. Use it to design the templates: director-and-film driven
art direction, storyboard-first section planning, real motion direction. It writes
`decisions.md`, `storyboard.md` and `compiled-spec.md` before implementation, so the
template decisions end up documented instead of improvised.

Constraints on top of the skill:

- Mobile first. Most leads open the link on a phone, from an SMS.
- Fast. Server rendered, no external CDN, no webfont round trips, inline critical CSS.
- Self-contained. No external hosts for scripts, fonts or images.
- Accessible: real contrast, real focus states, alt text.
- Trade-appropriate. A plumber site is not a fashion lookbook. Cinematic means
  considered light, type and pacing, not dark artsy nonsense that reads as broken.

Build a small set of templates (propose the number, 3 or 4 is likely right) and map
them to the trade profiles in `api/lib/trades.ts`.

## 5. The public demo page

**URL is decided, do not re-open it.** `heyelsie.com/site/{slug}`, slug derived from
the business name, for example `heyelsie.com/site/kevinplumbing`. Hugo's call,
2026-07-28: the existing domain already delivers through UK carriers on bulk SMS and
a fresh domain would be unproven exactly when the first blast goes out.

Build it so moving later is free. The base URL is **one env var** read in one place,
and the slug shape never changes. When a paying customer wants the site on a neutral
or their own domain, that must be a DNS change plus a config change, never a rewrite
and never a broken link. Say in the plan how you guarantee that, including what
happens to links already sitting in leads' phones.

- One clean link, short enough that the SMS copy stays GSM-7 and one segment.
- Real OG title, description and image so the iMessage preview looks deliberate.
- Tracking, mirroring `api/vsl/page.ts`: link click logged server side on the page
  request, then open, scroll depth, phone tap, chat opened, extension dialled.
- Exclude preview fetchers by request headers (`sec-fetch-dest`, no prefetch, GET
  only), not by User-Agent. iMessage previews with a stock Safari UA the instant the
  SMS lands, and a bot must never trip a "they looked at it" notification.
- Internal previews carry a flag so our own viewing does not burn the lead's first touch.
- **No colour controls, no editing controls, no "customise this" UI on the public
  page.** Hugo was explicit. The public page is the finished article. All editing
  lives in the owner admin behind a login.

## 6. Receptionist number and unique extension

This does not exist today. Design it.

The site header shows a phone number and an extension unique to that business, for
example "Call 07xxx xxxxxx, extension 35". The lead dials it to hear their own AI
receptionist answer for their own business. That call is the demo.

- One shared inbound number for demos, IVR gathers the digits, digits map to the
  site record and its business context. Recommend one Retell agent with dynamic
  variables injected per extension rather than one provisioned agent per lead, and
  say why in the plan (cost, provisioning time, cleanup).
- Extensions must be short (2 or 3 digits), unique among **live** demos, and
  reusable after a demo expires. Say how you guarantee uniqueness under concurrency.
- Every demo call logs against the lead in the CRM, with transcript and recording,
  and notifies the owning rep immediately. A lead phoning their own website is the
  strongest buying signal in this funnel. It must never sit unseen.
- Twilio geo-permissions apply. See `CLAUDE.md` on error 21408 before assuming a
  country works.

## 7. Chat widget

- Lives on the generated site, answers as that business's receptionist.
- Its prompt and greeting are stored per site, editable by **us** in our admin and
  by the **owner** in theirs. Follow the storage pattern in
  `20260727000011_ai_reply_reviews_prompt.sql`.
- Conversations must land somewhere a human sees them and must notify. Say where:
  CRM inbox thread on that lead, or a demo-chat log on the site record.
- The AI prompt itself must be told the punctuation rule in as many words. A model
  copies the punctuation it is shown, and this text can end up in an SMS.
- Same truth rules as section 3. The widget does not invent prices or certifications.

## 8. Our admin, and CRM tracking

**Websites board** in our admin: every generated site, with lead name, town, trade,
stage, generated at, sent at, views, chat messages, demo calls, last activity.
Actions: preview, regenerate, edit, publish, unpublish, copy link, send the link by
SMS **through the CRM send path**, expire.

**CRM tracking** so a rep can follow the sale without leaving the CRM:

- A website pipeline using the existing `wk_pipeline_columns` and stage stamping.
  Proposed stages: Generated, Sent, Viewed, Engaged (chatted or called), Interested,
  Won, Lost. Forward-only, moved by automation, with the source recorded.
- Counts come from the timestamp columns, never from a single `state` string. The
  VSL work learned this the hard way: a won lead is not still in "viewed".
- A website panel on the contact detail page and events on the inbox timeline,
  exactly as the VSL funnel surfaces today.
- Realtime on the board, so "viewing now" lights up.

## 9. Access and handover

- The lead receives **only** the public link. No admin URL, no login, no credentials
  in the SMS, ever.
- When they buy, they get their own admin: emailed login via Resend, Supabase Auth,
  RLS scoped so a business can read and write only its own site. Test the isolation.
- The owner's admin must be usable by a plumber in a van on a phone:
  - one screen, sections listed down the side, live preview beside it, one big Save
  - plain English labels, zero jargon, no hex codes, no code, no markdown
  - colour scheme chosen from named preset swatches, not a colour picker
  - editable: business name, tagline, phone, email, address, opening hours, service
    list with prices, about text, photos (upload to Supabase Storage), logo, colour
    scheme, chat greeting and chat prompt, whether the receptionist number shows
  - every publish is versioned, and a bad edit is one click to revert
- Custom domain is a later phase. Say in the plan how the design allows it.

## 10. Questions to answer or ask Hugo in the plan

Already decided, do not ask again: sites live at `heyelsie.com/site/{slug}` (section 5).

1. One shared demo receptionist number, or one per rep?
2. Does a demo expire, and after how long?
3. Price of the website product, and does it bundle the receptionist?
4. How many templates at launch?
5. Does the site generate automatically for every imported lead, or only on a "yes"?
   (Cost per generation times 11,744 leads is the deciding number. Show it.)
6. What moves when a customer pays and wants the site on their own domain? Design
   for it now (section 5), build it later.

## 11. Hard rules

1. **No long dashes anywhere.** No em dash, no en dash, no curly quotes, no ellipsis
   character. Code, comments, commits, docs, UI copy, generated site copy, AI
   prompts. `tests/message-copy.test.ts` fails the build for lead-facing copy. One
   long dash drops an SMS from 160 characters a segment to 70.
2. Read a file before editing it. Never guess at code you have not opened.
3. Never `sed` a `.ts` or `.tsx` file. Use proper edit tools.
4. Features never import other features. Shared code goes in `src/core/`, third
   party wrappers in `src/integrations/{name}/`.
5. No hardcoded secrets. Env vars only.
6. Zero TypeScript errors. `npx tsc --noEmit && npx vitest run` before every commit,
   plus a Playwright e2e for anything user facing.
7. Every bulk or lead-facing send goes through the CRM path, never the Twilio API
   directly, or the reply lands as an orphan with no thread and the
   one-agent-per-lead lock never sets.
8. Do not touch `vite.config.ts`.
9. The receptionist product and the reviews product are both live. Do not break
   them. New work goes behind a feature flag.
10. Do not revert, reformat or overwrite existing styles or approved copy unless the
    task explicitly requires it.
11. Do not add features nobody asked for.
12. Update `docs/` and the Claude memory dir before ending a task, so the next agent
    starts from live state.

## 12. Output for Phase 0

`docs/WEBSITE_FACTORY_PLAN.md`, then stop and report:

- the plan, section by section, matching sections 3 to 9 above
- the DDL you propose, as real SQL
- the phase order with the test that proves each phase
- the six questions in section 10, answered where you can and asked where you cannot
- anything in this brief you believe is wrong, and why

Do not start building until Hugo says yes.
