# Finding sub-100k properties at 20% off, using Rightmove and nothing else

Built 2026-08-24 on Hugo's instruction: *"find me properties under 100k, could be
flats as well, and 20% discount. Forget everything you know from the past. The
comparisons of the sold properties have to come from Rightmove. Three strong
comparables. Find me 20 of those."*

Result: 20 properties, average 32.7% under, cheapest asking GBP 50,000, none
under offer. Page: https://claude.ai/code/artifact/b6768591-b673-4577-820d-3f50cc28ca7d

This document is the method, the reasoning behind each filter, and the honest
ceiling on how many of these exist.

---

## 1. What made this work, and why it beat the old approach

The old pipeline values a property by building it a comp set from the Land
Registry, then gating it on a floor plan, a sized comp set and a comps tier. It
finds roughly 7 houses at 20%+ out of 67,000 judged. The bar is right; the
problem is that only about 6% of properties can clear the evidence needed to
even be judged.

This uses a different source: **the "recently sold nearby" panel Rightmove prints
on the listing itself.** Rightmove has that panel for about 82% of properties, so
the same 20% bar can be applied to thirteen times more stock. Each sold record
carries the bedroom count, the property type, the full address, the distance and
the date, which is everything needed to decide whether it is a like-for-like
comparable. The Land Registry gives a price and a postcode and leaves you
guessing.

**The second thing that made it work is not a data source, it is a habit: read
the advert.** Sixty-four candidates survived the arithmetic. Eleven of them were
destroyed by their own sales particulars, and not one was a maths error. That
step is where a plausible list becomes a real one.

**The third is measuring against the cheapest comparable, not only the median.**
A median is one number and one large sale can carry it. Every property here is
also tested against the single cheapest matching sale on its own street, and
nine were thrown out on that test alone.

---

## 2. How long it took

| | |
|---|---|
| First script written | 11:57 |
| Final twenty selected | 12:04 |
| Machine time for all five passes | about 6 minutes |
| Whole job, request to finished page | about 20 minutes |

The expensive-looking step, opening 65 live Rightmove pages to confirm each one
is still for sale, took under two minutes on eight threads. Rightmove serves the
VPS directly, so there is no proxy cost and no per-lookup fee. **The whole
exercise cost nothing but time.**

---

## 3. The pipeline

Five passes, each one narrowing the last. All on margarita-server in
`/root/scraper`, all reading `data/scraper.db`.

| Order | Script | What it does |
|---|---|---|
| 1 | `_find20.py` | Every sub-100k listing against its own Rightmove sold comps. Writes `_find20_out.json`. |
| 2 | `_verify20.py` | De-duplicates, and scans the stored description for red flags. Writes `_find20_clean.json`. |
| 3 | `_livecheck.py` | Opens every candidate on rightmove.co.uk today. Confirms still listed, reads the current price, lease, service charge, size. Writes `_find20_final.json`. |
| 4 | `_read_adverts.py` | Reads each property's own sales particulars and throws out the impostors. Writes `_find20_read.json`. |
| 5 | `_pick20.py` | Applies the lease and service-charge floor, removes anything under offer, ranks on evidence quality, takes twenty. Writes `_the20.json`. |

⚠️ **These are still throwaway `_`-prefixed files and are not committed to the
`hrds100/property-scraper` repo.** They will survive a reboot but not a cleanup.
Productionising them is a decision for Hugo, see section 7.

### The matching rule

A sold record counts as a comparable only when **all** of these are true:

- same bedroom count, exactly
- same property family (house, flat, bungalow, studio each judged separately)
- within 500 metres
- sold within the last five years
- the subject's own bedrooms and type are known

That last line matters more than it looks. An earlier version of the sold-comps
reader treated an unknown bedroom count as "same beds", and the 20%-under list
came out topped by a beach hut priced against a street of houses. **Not knowing
is not a match.**

The discount is `1 - asking / median(comparables)`.

---

## 4. The filters, and the real property each one caught

This is the part worth keeping. Every filter below exists because a specific
property with a perfectly correct discount turned out to be worthless.

### Retirement and age-restricted

Only over-55s can buy it, so the sold prices on that street are not its market.
**Caught:** an age-restricted seafront development in Teignmouth with a 24-hour
Careline (23.5% under), a supported-living scheme in Middlewich with a restaurant
and a salon (33.6%), a warden-assisted flat in Worthing (20.8%), a retirement
block in Barton under Needwood (37.5%), and Harold Road in Margate (20.7%).

Match on `retirement`, `age-restricted` (**with the hyphen**, the first version
missed it), `over 55`, `warden`, `house manager`, `careline`, `supported living`,
`assisted living`, `sheltered`. Note from an earlier build: **do not blocklist on
agency names.** "Churchills Estate Agents" is an ordinary Yorkshire high-street
agent and blocking "churchill" throws away real deals.

### A studio priced against one-bedroom flats

Rightmove files some studios as one bedroom. The comparables then come back as
genuine one-bed flats and invent a 30% discount out of a size difference.
**Caught:** North Street Atherstone, Scott Road Norwich, Hill Lane Southampton,
Augusta Gardens Folkestone, The Paddock Fulwood. Five of them.

### A covenant you cannot sell out of

**Caught:** a house in Longridge whose own advert said *"Discounted by 30% Below
Market Value"*. That is a Section 106 discounted-market home. The discount is
real, permanent, and travels with the property when you sell it, so it is not
yours to capture. Match on `shared ownership`, `shared equity`, `staircasing`,
`discounted market`, `section 106`, `first homes`, `% below market value`.

### A short lease

Under 80 years and the extension costs marriage value, which is exactly the size
of the apparent discount. **Caught:** a flat in Mountain Ash with **28 years**
left reading 26.9% under, one in Worthing with 61 years reading 65.5%, Bognor
Regis at 62, Moortown at 59, The Oaks Southampton at 77.

### A service charge that eats the asset

On a cheap flat this is decisive. The rule used: capitalise the annual charge at
8% and reject if that figure exceeds a quarter of the asking price.
**Caught:** The Leas in Folkestone, **GBP 5,560 a year on a GBP 100,000 flat**.
Also South Western House Southampton (4,132), Marine Court St Leonards (3,874),
Fore Street Ipswich (3,300), Ledgard Wharf Mirfield (2,722), Bismuth Drive
Sittingbourne (2,467).

### One big sale carrying the median

**Caught:** Church Street in Bishop Auckland read 34.1% under the median while a
**GBP 28,000** sale sat on the same street. Also Eldon Road Huddersfield, St
Marys Road Portsmouth, Lynwood Avenue Darwen and five more. Nine in total.

Every surviving property therefore carries two numbers: the discount against the
median, and the discount against the cheapest comparable on its street. The
second is the honest one.

### Already sold or under offer

Hugo, same day: *"dont do SOLD STC anymore."* Anything sold subject to contract,
or carrying a published Notice of Offer, leaves the list. It is not available at
the asking price. This removed 7, including Andersons Road Southampton, which had
been the top-ranked property on evidence quality.

### Still on the market at all

The database was up to nine days stale. One candidate had gone (HTTP 410) and two
had cut their price, which the live pass caught and re-scored.

---

## 5. A trap that cost a run

**Scanning the whole page HTML for "retirement" or "auction" killed all 65
candidates at once.** Rightmove's own navigation and its "similar properties"
rail carry those words on every page. Read
`page_model.property_data(html)['text']['description']` and `keyFeatures`, never
the raw HTML.

---

## 6. The funnel, and what it says about yield

| Stage | Count |
|---|---|
| Sub-100k listings, after removing auction, tenanted, shared ownership, retirement | 6,306 |
| Of those, with Rightmove sold-nearby data loaded | 928 |
| At 20%+ under the median of their own matching comps | 72 |
| After removing duplicate listings of one property | 65 |
| Still listed today | 64 |
| After reading every advert | 53 |
| After the lease and service-charge floor | 41 |
| After removing sold STC and offers already accepted | 34 |
| Also under their cheapest comparable | 25 |
| Ranked, delivered | 20 |

Two rates come out of this and both are needed for any forecast:

- **7.8%** of properties that have sold comps reach 20%+ (72 of 928)
- **35%** of those survive every honesty filter (25 of 72)

So roughly **2.7% of sub-100k stock with comps loaded becomes a real candidate.**

---

## 7. CORRECTION, same day: the first version of this section measured our scrape and called it the market

Hugo, reading section 7 below: *"We're not talking about a few cities, a few
towns. We talk about the entire UK."* He was right and the section was wrong.
Everything below counted what our own scraper had already collected and
presented that as the ceiling of the method. It is the ceiling of our coverage.

**The market was then measured directly.** Walking all 2,911 Rightmove OUTCODE
identifiers with a GBP 100,000 cap and `includeSSTC=false`, which tiles the whole
country with almost no double counting:

> **30,327 properties are for sale in the UK under GBP 100,000 today, spread
> across 2,358 outcodes.** Script: `_national_count.py` on margarita-server,
> output `_national_100000.json`. The sweep took under three minutes and cost
> nothing.

The biggest single outcodes are DN32 Grimsby (176), FY1 Blackpool (162), SR8
Peterlee (148), L1 Liverpool (144) and DL14 Bishop Auckland (134).

At the measured rates in section 6 (42.6% of sub-100k stock survives the clean
filters, 82% of properties have a sold panel, 7.8% reach 20%, 35% survive the
honesty filters) a full national sweep should yield **roughly 300 properties**,
not the 170 claimed below. That is hundreds, in one sweep.

**Why the standing config did not already cover this: it was never the towns, it
was the price band.** `data/rm_config.json.standing` already holds 305 REGION
searches. Every one of them is capped at GBP 200,000 and none was ever paired
with a sold-comps load, so the sub-100k stock outside our chosen towns had simply
never been looked at with this method. The first 80 searches of the national
ingest returned **73% properties we had never seen**.

The national sweep runs from `data/rm_config.json.sub100k_national`, a separate
file. **Never write these searches into `rm_config.json.standing`**: that file
drives the 00:30 machine and therefore what Pedro is handed every morning.

### What is still true from the original section

The sustained daily rate is a different question from the one-off harvest, and
the arithmetic below still holds for it. A standing stock of 30,327 turning over
means on the order of 400 new sub-100k listings a day nationally, so roughly
**10 to 12 a day sustained** once the backlog is taken. The honest summary is
**hundreds once, then a dozen a day**, and the limit there is the UK market, not
our software.

---

## 7b. The original, superseded arithmetic

**The backlog is worth about 170, once.** Only 928 of the 6,306 clean sub-100k
properties have their sold panel loaded, because the loader has mostly run over
more expensive stock. Pointing `fetch_sold_comps.py` at the sub-100k stock is
cheap (about 300 properties in 15 seconds, no proxy, no fee, so the whole 6,306
is roughly five minutes) and at the measured rates yields **6,306 x 7.8% x 35% =
about 170 properties**. That is a one-off harvest of a standing stock, not a
daily flow.

**The daily flow is about 6 or 7.** New sub-100k listings first seen in the last
week ran 390, 201, 174 a day. At the same rates that is 6 to 7 real candidates a
day.

**The ceiling is the scrape, not the method.** The overnight machine searches 33
towns. 305 are resolved and available. Scraping all of them multiplies the daily
intake roughly ninefold, which is **about 60 a day**, not hundreds. To reach 100
a day you would need something like 4,000 new sub-100k listings every day, which
is more than the whole UK market produces in that band.

So the truthful shape of it is: **one sweep gives you around 170 now, then
roughly 6 a day, or roughly 60 a day if the scrape is widened to every town we
can already resolve.** Anyone promising hundreds a day at this evidence bar is
either lowering the bar or counting the junk this document exists to remove.

### What would actually raise the number

1. **Load sold comps across all sub-100k stock.** Five minutes of compute for
   about 170 candidates. This is the obvious next move.
2. **Widen the nightly scrape from 33 towns to 305.** Multiplies the daily flow
   by roughly nine.
3. **Raise the price ceiling above 100k.** Hugo's call, not an engineering one.
4. **Not by loosening the filters.** Every one of them was written against a real
   property that would have wasted a phone call.

---

## 8. What has not been checked

Nobody has stood in any of these properties. Rightmove printed a floor area on
only a handful, so the comparison is like-for-like on bed count and property
type but **not on size**, and size is the mistake that has caught this business
before. A viewing settles it. Prices and availability were confirmed against live
Rightmove pages on 24 August 2026 and will drift.

Related: [docs/VIDEO_SERP_TRUTH.md](VIDEO_SERP_TRUTH.md) on who counts as a
comparable, and the strategy doc at `/Users/hugo/Whats/scraper/BRRR_STRATEGY.md`.
