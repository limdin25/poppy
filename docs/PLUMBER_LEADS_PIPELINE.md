# Plumber leads pipeline — the one right way to load a lead list

**For any agent (Claude/Cursor/human).** Hugo hands you a plumber-leads CSV and says
where it goes; you run ONE script that does the whole job. This is the canonical
runbook — follow it exactly. Do not hand-roll imports or skip steps.

---

## TL;DR

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GOOGLE_PLACES_KEY=... \
  node scripts/process-plumber-leads.mjs [csvPath] [count] [maxReviews] [agentId]
```

Defaults: `csvPath=~/Desktop/UK_Plumbers_Leads_2026-07-21.csv`, `count=100`,
`maxReviews=65`, `agentId=28dee5a4-e8be-4019-a6ad-e1dcf07b875c` (hugo@lemlin.com).

Secrets come from Claude Code memory (`~/.claude/projects/-Users-hugo-Whats-Poppy/memory/`):
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` → `credentials_supabase.md`
- `GOOGLE_PLACES_KEY` → `credentials_google.md` (key is **referer-restricted** to
  `poppy-henna.vercel.app`; the script already sends the right `Referer` header).

Never hardcode these in code or docs — env vars only.

---

## ⚠️ The `0 reviews` trap — read before touching review counts

The scraper (`/Users/hugo/Whats/scraper`, runs on the margarita VPS) **already**
applies the ≤65-review rule at scrape time. But its filter is
`if rc is not None and rc > max_reviews: skip` — a listing whose review count it
could **not read** is kept, and `export_uk_sheet.py` writes it out as **`0`**.

So a CSV row means one of two things:

| CSV `Number of Reviews` | Meaning | What to do |
|---|---|---|
| a real number `1–65` | our scraper read and checked it | **trust it — costs nothing** |
| `0` or blank | the scraper never read it; could be anything | **drop it**, or Google-verify (`ENRICH=1`, ~$22/1,000) |

Evidence (60-lead sample, 2026-07-24): non-zero counts were **21/22 exact**;
of 19 `0` rows, **11 were really over 65** (279, 183, 153, 151, 137, 129, 95, 86, 76, 68, 68).
Hugo's call 2026-07-24: **drop the zeros, spend nothing** — there are plenty of
verified leads. Only pay for lookups if the verified pool runs dry.

`Match Confidence` grades the owner-name match: `HIGH (own website)` >
`medium (name+city)` > `low (name only - CHECK city)` > `no match` (sole trader,
no name). Fill from the best tier down — a **wrong** first name in the opener is
worse than none.

## What the script does (Hugo's 5 rules, in order)

`scripts/process-plumber-leads.mjs`:

1. **Named-owner rows only** — keeps rows with a non-empty `Owner Name 1 (man)`
   (the opener reads their first name).
2. **Google-enrich reviews + rating** — the scraper's `Number of Reviews` is
   unreliable (defaults to 0 when it can't read it), so each candidate's real
   review count + rating come from Google Places "Find Place from Text"
   (name + town). Enrich happens **before** the filter so the threshold is real.
   Original CSV value is kept in `custom_fields.reviews_csv`; enriched rows get
   `reviews_source=google`.
3. **Keep only ≤ `maxReviews` (65)** — drops high-review plumbers; the "you've
   only got X reviews / you're newer" pitch doesn't fit them.
4. **Import + queue** — upserts to `wk_contacts` owned by `agentId`, into the
   **"Plumbers - test"** campaign (`a414b8e9-…`, pipeline `c2022b21-…`) with UK
   caller-ID **+447460035763** (`c8a0346b-…`), status `pending`.
5. **Order A→Z** — sets `wk_dialer_queue.priority` so the whole pending queue
   dials alphabetically by business name (higher priority = dialed first).

**Idempotent:** upserts by phone (never clobbers existing contacts), queues only
non-pending, and a final sweep deletes any queued lead now over the cap. Safe to
re-run. Each kept candidate = one Google call, so the full ~11.7k list is just a
bigger `count` (mind the API cost/time).

The lead's data lands in `custom_fields` under the keys the sales script reads
per lead — `owner_name, reviews, rating, rank, town, competitor_1/2,
plumbers_ahead, total_plumbers, website, google_search_url` — so the dialer
auto-fills the script for whoever dials it (see `interpolateScript.ts`).

---

## Change the defaults

| Want to… | How |
|---|---|
| Load more/all leads | raise `count` (e.g. `11744` for the whole CSV) |
| Different review cap | pass `maxReviews` (arg 3) |
| Assign to another agent | pass that agent's `profiles.id` as arg 4 |
| Different CSV | pass its path as arg 1 |

To point at a **different campaign / caller-ID**, edit the consts near the top of
the script (`CAMPAIGN_NAME`, `PIPELINE_ID`, `CALLER_ID_NUMBER_ID`).

---

## Verify after running (psql — pooler, creds in `credentials_supabase.md`)

```sql
-- count + review cap holds (max must be ≤ maxReviews)
select count(*), max((custom_fields->>'reviews')::int)
from wk_contacts where owner_agent_id='<agentId>' and custom_fields ? 'reviews';

-- all queued pending
select status, count(*) from wk_dialer_queue
where campaign_id='a414b8e9-22d8-4259-9c8e-b1469ed8089d' group by status;

-- A→Z order (top of the list = highest priority)
select c.name, q.priority from wk_dialer_queue q
join wk_contacts c on c.id=q.contact_id
where q.campaign_id='a414b8e9-22d8-4259-9c8e-b1469ed8089d' and q.status='pending'
order by q.priority desc limit 5;
```

Then browser-check (Kimi) the dialer at `/admin/crm/dialer-pro`: the first lead's
script should auto-fill (owner, business, reviews, competitors, live Google link)
and the left column should show the lead facts.

---

## Permanent (code) vs per-batch (this script)

- **Permanent, automatic for every lead/agent (in the app, deployed):** script
  auto-fill, brown placeholder chips, lead-facts panel, calculator price
  auto-tier, `BulkUploadModal` column aliases, the script wording.
- **Per-batch (run this script):** enrich, ≤65 filter, A→Z order. The **UI**
  bulk-import only maps columns — it does NOT enrich/filter/order. That's this
  script's job. (Wiring the pipeline into a UI/server route would make it
  automatic on upload — not built yet.)

---

## Related

- Script: `scripts/process-plumber-leads.mjs` (supersedes the older
  `import-plumber-leads.mjs` + `enrich-plumber-reviews.mjs`).
- Sales script + token contract: `src/core/content/one-call-script.html`,
  `src/features/crm/lib/interpolateScript.ts`.
- Claude memory: `project_leads_and_script_fill.md`.
