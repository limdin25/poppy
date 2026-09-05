# THE SOLD DATABASE (built 2026-08-30) — read before touching valuation or comps

**Full detail lives in the scraper repo: `/Users/hugo/Whats/scraper/SOLD_DATABASE.md`.
This is the CRM-side summary, so nobody working in Poppy rebuilds what already exists.**

---

## What exists now

**7,085,970 sold houses, Birmingham northwards, every one with a price, a date, a
size, a map point and a Rightmove link.** Comparables come back in under a second.

It lives on the VPS, **not in this repo and not in Supabase**:

| | |
|---|---|
| Database | `margarita-server:/root/scraper/data/sold_all.db` (2 GB) |
| Lookup | `margarita-server:/root/scraper/comps_lookup.py` |

---

## Why this matters to Poppy

Elsie's `brrr_properties.deal` is written by the engine on the VPS and shipped in by
`send_to_elsie.py`. Discovery now reads this database too: `comps_from_sold` in
`discovery_pool.py` on the VPS (wired 2026-08-31). Before that, discovery priced off the
thin Rightmove `rm_comps` scrape and only 71 branches cleared 20% gold/strong. Same night
with this file: 216 unique branches, 199 queued to Pedro.

So when a deal in the CRM shows a GDV or an offer band, the evidence behind it is one
of these 7 million records, with a real distance in metres and a link.

**Do not build a comps fetcher, a size fetcher or a sold-price scraper in this repo.**
It exists, it is finished, and it runs on the VPS where the data is.

---

## The rules that reach the CRM

**Only `street`, `gold` and `strong` evidence ships to Pedro.** Enforced in
`scripts/lib/evidence-standard.mjs` and mirrored from `course_comps.py` on the engine.
`street` means comparables on the subject's OWN road sold inside twelve months and is
the best tier there is — it was missing from this repo's list until 2026-08-30 and 17
passes were being refused because of it.

**Two size columns, never mixed.** `sqm` is a surveyor's measurement from the EPC
register (71% of records). `sqm_est` is the median size of that postcode, used when
the exact house has no certificate. A number built on `sqm_est` is an estimate and
must not be presented as measured.

---

## What is NOT done

- **2,040,161 sold records have no real measurement.** 316,173 of them have a floor
  plan that could be read. **Hugo's decision, 2026-08-30: read plans ON DEMAND only,
  when a specific house needs it. No bulk read.**
- **48,458 for-sale listings cannot be located** because their address carries no
  postcode at all. Geocoding them costs about USD 240 and is **not approved**.

---

## ⚠️ Do not duplicate the VPS in this repo

`api/lib/refurb-read.ts` reads floor plans on Sonnet 5 + Haiku at about 10p a house.
The VPS already reads floor plans on **Qwen 3.7 Flash at about USD 0.0009**, roughly a
hundredth of the cost, in `/root/scraper/floorplan_reader.py`.

On 2026-08-30 the Poppy reader was pointed at 112 extra houses and deployed. Hugo had
not authorised it, it duplicated the VPS, and it was reverted the same day after 6
houses. **Check the VPS before building any new reading, valuing or comping.**

See `/Users/hugo/Whats/scraper/CLAUDE.md` §2b for which folder does what.
