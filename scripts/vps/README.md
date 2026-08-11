# Scripts that live on the scraper VPS

These run on **margarita-server** at `/root/scraper`, not in this app. They are
checked in here because they were written on 2026-08-11 to unblock the property
pipeline and would otherwise exist only on one box with no history.

Deploy is a copy:

    scp scripts/vps/fast_comps.py margarita-server:/root/scraper/

## What each one is for

**`backfill_postcodes.py`** — the biggest unlock of that night. The comps
fetcher skips any property whose address has no postcode, and **1,450 of 1,618
candidates had none**, so they could never be valued and `send_to_elsie` refuses
anything unvalued. Google geocodes the street text to a point, postcodes.io
turns the point into the real postcode. 1,400 resolved in 1.8 minutes.

**`fast_comps.py`** — replaces `POST /api/comps/fetch` for the sold-comps half.
That route drives a proxied browser at 3 to 6 seconds a property with up to 45
EPC lookups each, and on 2026-08-11 it hung with no database write for over an
hour. Almost none of it needs a browser: Land Registry is a local SQLite lookup
and only EPC is a network call, so this caches EPC by postcode across the whole
run and threads it. 484 properties in 18 minutes.

**`pipeline_loop.sh`** — runs score, mark, geocode, comps and send every 20
minutes, so branches accumulate while the floor plan fetch is still going
instead of arriving in one lump at the end. Every stage is resumable and skips
what it has already done, which is what makes re-running it safe.

## Two traps that cost hours

1. **`import env_loader` FIRST.** `CompsFetcher.EPC_API_TOKEN` is a class
   attribute read at import time, so importing the scraper before the secrets
   are loaded pins the token to `""` for the life of the process. Every EPC
   lookup then fails silently and every property comes back with zero usable
   comps while looking like it worked.
2. **`maxDaysSinceAdded` only accepts 1, 3, 7 or 14.** Setting it to 90 made all
   13 searches return nothing. Removing the parameter entirely is valid and
   returns every matching listing regardless of age, which is what you want.
   And remember `POST /api/rightmove/start` calls `save_config()` with whatever
   body it is handed, so a trimmed request silently replaces the stored searches.
