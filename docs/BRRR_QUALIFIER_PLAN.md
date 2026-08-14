# BRRR Property Qualifier — Plan (2026-06-10, v3 same day)

> ## RETIRED 2026-08-09 — the AI caller no longer exists
>
> Everything below describing an **AI voice agent calling estate agents** is
> history. Hugo: *"the robot, it doesn't exist, we don't want to use that any
> more, no more robot calls for the properties, that was just a test, we're not
> gonna do that."* It ran for one month and made 26 calls.
>
> **Estate agents are now rung by a human agent in the CRM dialer**, at
> `/admin/crm/dialer-pro?script=property_call`. See the "Houses for Pedro"
> section of [CLAUDE.md](../CLAUDE.md) and Claude memory `project_houses_pedro`.
>
> **What Pedro actually says, and what happens after the call, is documented in
> [BRRR_STRATEGY.md](BRRR_STRATEGY.md) sections 8 to 8e** (the two calls, the
> condition questions, water, the email sent on the call, the after-call brief,
> and the EPC numbers). That file wins over anything below.
>
> Deleted with it: `api/cron/process-property-calls.ts`,
> `scripts/create-property-qualifier-agent.mjs`, the Vercel cron entry, the
> ingest auto-queue branch and the admin dial button. Pinned by
> `tests/property-no-ai-calls.test.ts`. **Do not rebuild any of it.**
>
> What survives and is still correct: the **scraper**, the **valuation engine**
> (v3 note below), the **ingest endpoint**, the `brrr_properties` /
> `brrr_property_calls` tables, and `pushPropertyToPipeline`.

> **v3 — valuation engine.** The Comps tab's offer maths was fundamentally
> broken (offers were 70–75% of GDV with a default £250/sqft — producing
> offers ABOVE asking). Replaced by a research-backed, test-driven engine:
> `scraper/valuation.py` (+ 26 tests in `scraper/test_valuation.py`, spec in
> [docs/VALUATION_ENGINE.md](VALUATION_ENGINE.md)). Core rules: offers are
> 70–75% of the property's **worth-now value** (median of recency-adjusted,
> distress-filtered same-bed sold comps), **never above asking**, GDV (from
> target-bed comps, no defaults ever) only checks the deal stacks; verdicts
> great_deal / fair / overpriced / insufficient_data; `pursue` flag gates
> auto-queuing so Elsie never calls hopeless listings. Served by
> `GET /api/valuation/<property_id>`; the Comps banner, deal calculator MV
> and the Send-to-Elsie payload (offer_min/offer_max/cmv/gdv/verdict) all
> consume it; Elsie's `offerRange` prefers these numbers over the %-of-asking
> fallback.

> **v2 changes:** the scraper now LIVES inside this repo at `scraper/`
> (launchd service `com.margarita.propertytool`, port 5050 on Hugo's Mac;
> old path `/Users/hugo/Whats/Margarita/scraper` is a symlink). The admin
> panel gained **BRRR → Scraper** (embeds the local scraper) and
> **BRRR → Pipeline** (embeds /leads). "Send to Elsie" now **auto-queues the
> qualification call** — the dial cron holds it until the configured calling
> hours. All call rules are adjustable in **Admin → Properties → Call rules**
> (stored as `brrr_settings` in `platform_settings`): max attempts, retry gap,
> dials per run, calling days/hours, AI offer min/max % of asking. The agent
> asks a 13-point checklist (availability, occupancy/tenants, condition,
> motivation, chain, tenure/lease/charges, interest, offer range, viewings)
> and the admin UI shows every question as answered / not answered.
> `scraper/data/` is gitignored — `elsie.json` + `brrrr.json` hold its secrets.

## What this is

Hugo's Rightmove scraper (`/Users/hugo/Whats/Margarita/scraper`, Flask on port 5001)
finds BRRR candidates. Hugo reviews floor plans, marks the good ones "potential",
and the Comps tab computes the deal numbers (asking price, 75% offer, GDV, refurb,
rent, cash needed).

This feature sends those approved properties into Elsie, where the AI voice agent
calls the listing estate agent, qualifies the property for a BRRR purchase, and —
if it qualifies — drops it into Hugo's deal pipeline so he can call back and book
a viewing himself.

## End-to-end flow

```
Scraper Comps tab ──"Send to Elsie" button──► Flask /api/elsie/send
        │  (listing + agent phone + comps + floorplans + calculator numbers)
        ▼
Elsie POST /api/properties/ingest   (x-ingest-secret header)
        ▼
brrr_properties table  ──►  Admin → Properties tab (admin-only)
        │  Hugo clicks "Call agent"
        ▼
brrr_property_calls row (status=pending)
        ▼
Cron /api/cron/process-property-calls (every 2 min)
   - UK calling hours guard (Mon–Sat, 09:30–17:00 London)
   - atomic claim (same pattern as ai_takeover_queue)
   - max 2 dials per run
   - Retell create-phone-call from +447426495169 with the
     property-qualifier agent + per-call dynamic variables
        ▼
Retell call → estate agent (agent can press IVR digits, asks availability,
condition, why selling, chain, lease, "would the vendor consider ~£X?")
        ▼
Existing Retell webhook → branch on call metadata (type=brrr_property)
   - Claude extracts a structured qualification from the transcript
   - updates brrr_property_calls + brrr_properties.status
   - if QUALIFIED → creates estate-agent contact + deal in Hugo's live
     business pipeline (stage "Qualified" — created if missing)
        ▼
Hugo sees it in Leads pipeline, calls the agent, books the viewing.
```

## Pieces

### Elsie (this repo)

| Piece | File |
|---|---|
| Migration: `brrr_properties` + `brrr_property_calls` (no RLS, admin-only like other admin tables) | `supabase/migrations/20260610000001_brrr_properties.sql` |
| Ingest endpoint (secret header, upsert by source+property id) | `api/properties/ingest.ts` |
| Admin API: list / update / queue call / push to pipeline | `api/admin/properties/index.ts` |
| Outbound dial cron (atomic claim, hours guard, retry w/ max 3 attempts) | `api/cron/process-property-calls.ts` |
| Webhook branch for property-qualifier calls | `api/webhooks/retell.ts` |
| Admin UI tab "Properties" | `src/features/admin/pages/PropertiesPage.tsx` + nav/route |
| One-off script: create the Retell qualifier agent + LLM (no calls placed) | `scripts/create-property-qualifier-agent.mjs` |

### Scraper (Margarita repo)

| Piece | File |
|---|---|
| `POST /api/elsie/send` + `GET /api/elsie/sent` routes | `app.py` |
| `get_listing()` + `rm_elsie_sent` tracking table | `rightmove_storage.py` |
| "Send to Elsie" button on the Comps panel (sends current calculator numbers) | `static/comps_app.js`, `templates/comps.html` |
| Local config holding the ingest secret (NOT hardcoded) | `data/elsie.json` |

### Retell qualifier agent

- Separate Retell agent + LLM, never touched by the sync-prompts cron
  (no `agents` table row — same protection approach as the Rod agent).
- Voice `cartesia-Willa` en-GB (proven cleanest for telephony).
- Per-call `retell_llm_dynamic_variables`: address, asking price, offer price,
  agent name, bedrooms, property type, days on market, target rent.
- IVR: `press_digit` tool so she can "press 1 for sales".
- Honest-AI: calls on behalf of Airbrick Properties, admits being an AI assistant
  if asked, never pretends to be a person.
- She does NOT book the viewing — she qualifies and notes viewing availability.

### Env vars (Vercel)

- `PROPERTY_INGEST_SECRET` — shared secret scraper → Elsie
- `RETELL_PROPERTY_AGENT_ID` — qualifier agent (created by the script)
- `PROPERTY_FROM_NUMBER` — `+447426495169`
- `PROPERTY_PIPELINE_BUSINESS_ID` — `e2593e2f-a78e-4878-8c6c-67539af2f955` (Hugo's live business)

## Statuses

`brrr_properties.status`: `new → call_queued → calling → qualified | not_qualified | no_answer | callback`
`brrr_property_calls.status`: `pending → dialing → completed | failed | no_answer` (3 attempts max, 2h apart)

## Safety rails

- No call is ever placed automatically on ingest — only when Hugo clicks "Call agent".
- Calling-hours guard so the AI never rings an agency at night.
- Max 2 dials per cron run; atomic claim prevents double-dialling.
- Existing inbound webhook behaviour untouched — property calls branch out early
  by Retell call metadata, so PA/Rod call logging keeps working exactly as before.
- The scraper's existing `brrrr-promote-to-pipeline` edge-function flow (other CRM)
  is left completely alone; "Send to Elsie" is a separate explicit button.
