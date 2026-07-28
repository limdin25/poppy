# The video's Google search: what may appear on screen

Read this before touching `api/leads/rank-frame.ts`, `video/scripts/prep-lead.mjs`
or `scripts/scrape-trade-leads.mjs`.

Written 2026-07-28 after two leads sat in the video funnel behind a red card that
gave the wrong reason and a retry button that could never work.

---

## The one rule

The video shows a Google search with the lead near the bottom, and the baked
voiceover says:

> "there you are, near the bottom ... and the only reason they're up there is
> more reviews"

`GoogleScrollV` prints every row's review count next to its name. So a business
may appear **above** the lead only if all of these are true:

1. It is **real**. Never an invented name, when a real one can be found.
2. It is **in the UK**.
3. It is **a tradesman**, not a shop.
4. It genuinely has **more reviews than the lead**.

If fewer than `MIN_REAL_ABOVE` (3) businesses clear all four, the render is
**refused rather than faked**. That refusal is correct behaviour, not a bug.

All four rules live in one place: **[api/lib/uk-places.ts](../api/lib/uk-places.ts)**,
with an `.mjs` twin at [scripts/lib/uk-places.mjs](../scripts/lib/uk-places.mjs)
for the scraper, which cannot import TypeScript. `tests/uk-places.test.ts` pins
both and fails if they drift.

---

## What went wrong, and why it was hard to see

Two leads wore this card:

> Google didn't return enough real businesses above them to build a truthful
> search, so the video was refused rather than faked.

Google had returned **six** businesses for Bite Back Pest Control (Bridlington)
and **eight** for AL Security Ltd (Stirling). The refusal was real. The reason
printed on the card was the opposite of the truth, so the agent had nothing to
act on, and "Try the video again" re-ran a deterministic sum that could only fail
the same way.

Underneath were four faults, all the same shape: **two parts of the repo each had
their own idea of who counts as a competitor above the lead, and they
disagreed.**

### 1. Position measured two different ways

`scrape-trade-leads.mjs` qualifies a lead on **position**: `rank >= 4`, with the
comment "needs >=3 real businesses above". `rank-frame` then threw that position
away and re-derived it from **review count**.

For a well-reviewed lead in a thin market the two answers differ wildly:

| Lead | Real Google rank | Businesses above (scraper) | Position rank-frame computed |
|---|---|---|---|
| Bite Back Pest Control | 5 of 6 | 4 | 2 (only 1 above) |
| AL Security Ltd | 4 of 7 | 3 | 2 (only 1 above) |

The lead passed selection and failed the render, ten minutes and one agent click
apart. 3 of 30 sampled leads (10%) hit this.

### 2. `region=uk` is a bias, NOT a filter

This is the one to remember. On a Places search, `region=uk` only *nudges*
results. It does not restrict them.

"pest control in Scarborough" comes back **four-sevenths Canadian**, because
Scarborough is also a district of Toronto. Measured over 727 real result rows
from 60 town searches: 6 were non-UK, and 4 of those 6 landed on one lead.

Two consequences, one worse than the other:

- The video would name Toronto companies as a Yorkshire firm's local rivals.
- Worse, **the scraper had the same hole**, so foreign businesses inflated the
  stored `rank` and `plumbers_ahead` of every UK lead below them. Those numbers
  are interpolated into the dialer script and **read out loud to the lead on the
  phone**. A Scarborough firm was stored as "8 businesses ahead of you" when most
  of the 8 were in Ontario.

**How to restrict properly:**

| API | Restricts to the UK? |
|---|---|
| Places Text Search `region=uk` | **No.** Bias only. |
| Geocoding `components=country:GB` | **Yes.** Hard restriction. |
| Places Nearby Search `location` + `radius` | **Yes**, by construction, around a GB point. |

So the search is anchored on a `components=country:GB` geocode, and the address
of every text-search row is checked with `inUk()`.

`inUk()` reads the **country suffix**, not the postcode shape, because Canadian
postal codes ("M1J 3C9") are the same shape as British ones. Google omits the
country when it matches the region bias and names it when it does not, so a UK
address ends in its postcode (which has a digit) and a foreign one ends in its
country name (which does not).

### 3. Shops counted as tradesmen

The scraper drops non-traders by name (Screwfix, Rentokil, Timpson). A name list
cannot keep up. "pest control in Taunton" returns, above every real pest
controller:

```
1395  Pets at Home Taunton
1334  Proper Job Taunton
 790  Otter Garden Centre, Taunton
 283  KO-Pest Control Somerset      <- the first actual pest controller
```

Shops collect thousands of reviews; a one-van trader collects forty. Sorting by
reviews puts them straight to the top.

The fix is Google's own `types` field, not more names: shops carry `store`,
tradesmen never do. `isTrader()` rejects a row with a shop/hospitality/school
category **unless** it also carries a genuine trade type, because one real
Crawley electrician is tagged `electrician,establishment,real_estate_agency`.

Pest control has no Google category at all (bare `establishment`), so the rule
may only ever **reject**, never require.

### 4. A retry offered for a failure that could never clear

`canRetryRender()` in `funnelStages.ts` now decides. Exactly one failure is
never retryable: the lead out-reviewing their whole area, which is a fact about
the lead computed the same way every time. Everything else is transient (a
deploy, a dead website) or fixable on the lead (no trade, no town), so the button
stays.

---

## What happens now when a town is too thin

Hugo, 2026-07-28: *"put business with more reviews above from cities near by"*.

Rather than invent names, the search widens to **real businesses in nearby UK
towns**, at 40km then 80km around the GB-restricted geocode, keeping only those
that genuinely out-review the lead. This is also what Google itself does for a
small town: the live Bridlington search already returns firms from Beverley and
Hull.

Verified live on 2026-07-28, all five previously-failing or at-risk leads:

| Lead | Before | After |
|---|---|---|
| Bite Back Pest Control (Bridlington) | refused | renders, 3 above (1 from a nearby town) |
| AL Security Ltd (Stirling) | refused | renders, 17 above (17 nearby) |
| Yorkshire Coast Pest Control (Scarborough) | refused | renders, 3 above (3 nearby, no Toronto) |
| LW Pest control (Taunton) | refused | renders, 3 above (no pet shop) |
| Integrated Pest Solutions (Sale) | refused | renders, 10 above |

**A trap worth naming, because it was walked into while writing this fix:**
Nearby Search returns `vicinity` ("Colonial House, Swinemoor Ln, Beverley"), not
`formatted_address`, and a vicinity has **no postcode**. Running those rows
through `inUk()` rejects every single one, silently emptying the widening and
producing a symptom identical to the original bug. Hence
`realCompetitors(rows, isLead, { radiusBounded: true })` for nearby rows, pinned
by a test.

---

## Refusals, and what the agent is told

The verdict is decided **once**, in `rank-frame`, and returned as
`serp.refusal`. The render and the CRM card both read it, so the three can never
hold three opinions.

| `serp.refusal` | Means | Retryable |
|---|---|---|
| `null` | 3+ real UK traders out-review the lead | renders |
| `no_results` | Google returned nothing at all for this search. Check the town and trade. | yes |
| `thin_market` | The lead out-reviews their whole area. The video's claim would be false for them. Ring them instead. | **no** |

---

## Existing lead data was deliberately NOT repaired

Hugo, 2026-07-28: fix the code only. The ~1000 leads already in the CRM keep the
`rank` and `plumbers_ahead` they were scraped with, **including the values
inflated by foreign businesses and shops**. New scrapes are clean.

So: an agent reading "[plumbers_ahead] businesses are ahead of you" off a lead
imported before 2026-07-28 may be quoting a number that counted Toronto or a
garden centre. Re-scraping those towns is the remedy if it ever matters.

---

## If you change any of this

- Change the rule in **both** `api/lib/uk-places.ts` and
  `scripts/lib/uk-places.mjs`. `tests/uk-places.test.ts` fails if they drift.
- Do not re-derive "who is above the lead" anywhere else. That is the exact
  mistake this document exists to prevent.
- `checkLineStatus` was written, tested and imported by nothing for weeks. Do not
  assume a helper is wired in, grep for it:
  `grep -rn "realCompetitors\|isTrader\|inUk" api src scripts video tests`
