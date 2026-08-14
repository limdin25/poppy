# How the property machine works, end to end

*Written 2026-08-14 from the live code. Every number below is read out of the
files, not estimated. For the strategy behind it (what a deal IS, and why the
discount is compulsory) read `/Users/hugo/Whats/scraper/BRRR_STRATEGY.md`, which
is the single source of truth. This document is the plumbing.*

---

## The one-paragraph version

We never buy a house. Every night a machine reads the property portals, works
out what a house is really worth, works out the lowest price that would still
work for an investor, and puts the best ones in front of Pedro. Pedro rings the
estate agent twice: once to ask questions, once to agree a price. When an agent
accepts, we sell that agreed deal to a property investor for GBP 3,000 to 5,000
plus VAT. The investor does the buying, the building and the renting.

---

## Stage 1. The overnight scrape (00:30 every night)

**What runs it:** `property-overnight.timer` on the server, which starts
`overnight_pipeline.sh`. It works in rounds until 06:10 London time.

**What it searches:** 117 saved Rightmove searches (one per town), plus 20
Zoopla searches. Every search runs every night, there is no rotation. All
searches are capped at **GBP 200,000**.

**Where:** the old industrial belt, the coalfields, the coast and the Welsh
valleys. Hull, Doncaster, Grimsby, Preston, Blackpool, St Helens, Wigan,
Barnsley, Rotherham, Sunderland, Stoke, Burnley, Blackburn, Tyneside, Teesside,
and twelve Welsh valley towns. **Scotland is deliberately out** (different legal
process). The nine big city-centre searches were removed on 2026-08-13 after
producing thousands of listings and zero passing deals.

**Refused straight away, before any maths:** auctions, tenanted, retirement or
age-restricted, shared ownership, a lease under 70 years, no asking price, a
lettings advert wearing a sale price, an offer already on the table, and **any
listing with no agent phone number**. That last one is the biggest single loss:
29,279 of 40,241 stored listings have no phone.

**Zoopla's job is to rescue what Rightmove hides.** If only Zoopla has the floor
plan, the plan crosses over (only when street, postcode district, bedrooms,
exact price and property type all agree). If Rightmove has no phone, Zoopla
supplies the agency name and we look up the number Rightmove already published
for that agency. **Zoopla's own phone number is never imported**, because it is
a tracking number and it would let a branch you just spoke to reappear wearing a
second identity.

---

## Stage 2. Enrichment

- **Floor plans** (`keep_fetching.sh`, running continuously). Without a plan
  there is no size and no deal.
- **Listing history** (`listing_history.py`), a nightly photograph of every
  listing so tomorrow we can see a price cut or a sale that fell through.
- **Crime** (`fetch_area_crime.py`), free from data.police.uk, cached 30 days.
- **EPC floor areas** (`epc_subject_fill.py`), strict address match only.
- **Postcodes** (`backfill_postcodes.py`).
- **Motivation scoring** (`motivation.py`): price cut and still unsold, past the
  90-day agent contract, probate, executors, repossession, vacant, no chain,
  "cash buyers only", "needs modernisation", no internal photos, EPC below C.
  This moves queue order, it does not decide.

---

## Stage 3. Comparables, to the course's standard

`fast_comps.py` searches a local copy of the Land Registry sold-price database
in rings of 200m, 500m and 800m, using EPC records to estimate the bedrooms of
each sold house. No browser, so it is fast and free. `course_comps.py` then
applies the evidence rule.

| Tier | Sold within | Distance |
|---|---|---|
| gold | 6 months | 400m |
| strong | 12 months | 400m |
| good | 12 months | 800m |
| fair | 24 months | 400m |
| last resort | 24 months | 800m |
| below that | refuse to value it | |

**Only gold and strong reach Pedro** (since 2026-08-13). Never relaxed at any
tier: at least 3 comps, same style, within 25% on size, never a new build, same
tenure.

> **Enforced in two places since 2026-08-14, on purpose.** The engine has always
> checked it (`shortlist_gate.py` `require_comps_tier`), but 110 of the 180
> houses on the board were fair, good or last_resort, because they arrived on
> the retired hand push which bypassed the gate. The rule is now repeated at the
> last gate before the phone call (`scripts/lib/evidence-standard.mjs`), and the
> run prints what it held back. A rule enforced in one place holds only until
> somebody finds another door.

**Since 2026-08-14 comps are priced per square metre** (`comp_value.py`), not by
raw price, and a comp whose rate sits above 1.6x or below 0.6x the others is
thrown out and recorded. This came from 39 Orion Way in Grimsby, where one comp
at GBP 3,500 per sqm on a GBP 1,650 street pushed the value to GBP 139,000 on a
house nearer GBP 92,000.

---

## Stage 4. The eye (the condition read)

`property_brain.py` makes one AI vision call per property that reads the floor
plan and three photographs, and answers into one of five bands: **turnkey,
cosmetic, modernisation, full_refurb, derelict** (plus unknown, which fails).

Two rules matter. **The eye never sees a price**: every figure is stripped out
of the advert first, because a model shown a price values to it. And the eye
never sets a number, it only reports what is physically there.

About GBP 0.0032 per property, capped at 400 a round, and it only ever looks at
houses that already passed everything free.

---

## Stage 5. The valuation and the offer maths

```
True Market Value (TMV) = GDV - (refurb + 5% contingency)
Pedro opens at          = TMV x 0.75
Pedro never goes above  = TMV x 0.80
```

GDV is what it is worth done up, from sold comps. Refurb is priced line by line
from the course's builder rate card (`refurb_model.py`). **The asking price
appears nowhere in the calculation.**

**Why the discount is compulsory.** The investor refinances and the bank lends
**75% of the finished value**. On Sussex Street, Cleethorpes (GDV GBP 95,000):
the bank lends GBP 71,250, and buying at GBP 63,375 plus GBP 10,500 of work
costs GBP 73,875, so nearly all the money comes back. Pay the GBP 72,500 asking
price instead and the investor is GBP 11,750 short, stuck in the wall forever.
**You cannot buy at market value and pull your money out.** No amount of
building work closes that gap. That is the entire reason a discount is required.

The refurb model **refuses** rather than guesses: unknown condition, derelict,
roof, windows, damp or structural work, and implausible floor areas all fail.

---

## Stage 6. The gate, the auditor and the canary

**The gate** (`shortlist_gate.py`) asks the sourcer's real question: how far
below asking do I have to get them? Under **25% off** is an ordinary negotiation
and it gets rung. Over 25% waits. Below zero is treated as a broken valuation,
never a bargain.

**The three musts.** A house reaches Pedro only with a **floor plan**, **21 days
or more on the market**, and **gold or strong comparables**. A price cut is the
queue rule, not a fourth must.

> **Live exception:** the 21-day rule is **off until 2026-08-28** to get Pedro to
> volume. It snaps back on its own. The floor plan and the comps standard never
> bend.

Also killed here: outcodes over **1,000 recorded crimes a month within a mile**,
valuations below medium confidence, and any house where an independent estimate
contradicts the first.

**The auditor** (`deal_auditor.py`) is a second brain that never prices
anything, it only asks whether the answer survives contact with the world. Kills
include `valuation_not_credible`, `valuation_over_2x_asking`, `stale_bargain`,
`opener_at_asking`, `no_cross_check`, `comps_disagree`, `cost_disputed`. It was
built after Holloway Head B1, an ex-council flat asking GBP 100,000 that came
out "worth" GBP 293,296 because the nearest sales were luxury new-builds 100
metres away.

**The batch canary** (`batch_canary.py`) judges the shape of the whole night:
pass rate between 1% and 25%, median GDV over asking between 1.0 and 1.8, no
postcode area holding over 25% of passes, median comps behind a pass at least 4,
zero passes without a cross-check. **If any check is red, nothing ships at all.**

---

## Stage 7. Sending to the CRM

`send_to_elsie.py --apply` posts each pass to `/api/properties/ingest`,
authenticated by a shared secret. It recomputes nothing, so the number Pedro
reads is the number the canary judged.

The ingest route refuses a deal the engine says not to pursue. A deal the
auditor killed is **filed, not deleted**, with status `auditor_killed`, so call
history still shows what was withdrawn and why. A kill is a verdict about
today's data, never a tombstone: if the comps improve or the price drops, the
house comes back. A human outcome always outranks a machine one.

---

## Stage 8. Reaching Pedro

`scripts/assign-properties-to-pedro-houses.mjs --refresh --apply` runs at the end
of the night. It groups houses **by branch, not by house**: one office listing 12
houses is one phone call about 12 houses. Price-cut branches go first.

**A branch that has been called is never dealt again.** On 2026-08-11 seventeen
branches were dialled twice or three times in a day because the only guard
looked at the queue rather than the call history. Now `redial-policy.mjs`
decides from `wk_calls`:

- Somebody answered: off the queue for **14 days**.
- Nobody picked up: back after **20 hours**, and only with `--redial-unanswered`.
- A redial always goes to the **back** of the queue.

`--refresh` also rewrites the saved figures on branches he already holds, so the
live coach reads tonight's numbers, not last week's. This is the path used to
correct every board figure on 2026-08-14.

---

## Stage 9. The two calls

**Call one is discovery and never contains a number of ours.** If pushed:
*"Honestly, I don't want to give you a number I'd have to take back. Let me do
the work properly and I'll come back to you tomorrow."*

He asks: vacant or tenanted, why they are selling, offers and fall-throughs,
time listed and price cuts, floor area, tenure, and the golden question, *"has
anything on that street sold recently that was done up, and what did it go
for?"*

**Condition is four questions, not one.** "It needs a bit of work" is not an
answer, because that sentence covers a GBP 5,000 tidy-up and a GBP 40,000
strip-out, and the gap between them is our offer. Cosmetic or full refurb? The
big four (roof, damp, electrics, boiler)? Age of kitchen and bathroom, double
glazing? Has anybody priced the work up?

**Water gets its own question on every house**, even one described as
immaculate. The governing rule: **a leak is not a reason to walk away, it is the
reason the price comes down.**

**The email is asked for separately and sent while they are on the phone.**
**Call one's email can never carry a figure**, and there are three fences behind
that.

**Call two floats the confirmed figure:** *"If we were to offer around GBP
63,000, am I in the ballpark, or am I a million miles off?"* He climbs one rung
at a time toward the ceiling and **stops dead there**. The ceiling is never said
out loud. Never a formal offer on the phone, never a viewing before the ballpark
is agreed.

---

## Stage 10. After the call

Pedro presses one of seven outcomes: `qualified`, `figure_obtained`, `deciding`,
`follow_up`, `not_qualified`, `callback`, `no_answer`.

**The ballpark is rebuilt from the call itself** (`reprice.py` on the engine,
built 2026-08-14). This is the number that matters, and it is deliberately not
the overnight one:

| | The overnight number | The ballpark |
|---|---|---|
| Built from | photos and sold comps | what the agent said on call one |
| Knows the condition? | guessed from photographs | heard, in their words |
| Knows the size? | often not at all | the agent has the particulars |
| Job | decide who is worth ringing | the figure Pedro floats on call two |
| Said out loud? | never | yes, on call two |

It rebuilds GDV from the comps, prices the works from the condition the agent
described (**at the low end**, because the budget is what we hand the builder,
not a prediction), then TMV, open and ceiling. A condition nobody established is
a **refusal**, not a zero, because an unknown condition priced at zero is a
turnkey. A derelict asks for a builder rather than being priced.

**The money is computed on the engine and nowhere else.** The CRM extracts the
facts from the call, which is language work, and sends them over. It never does
the arithmetic: `api/lib/brrr-offer.ts` reads figures and refuses to derive
them, and a test fails the build if anybody reintroduces a shortcut.

That writes a **next-step brief** onto the house (`api/lib/next-step-brief.ts`):
what the house is, asking versus our offer, why it holds, what Pedro does next,
what is in the way, the ladder, the board column and a confidence level. It is
deterministic, every figure is read from the engine rather than worked out
again, and a missing fact becomes a blocker rather than an assumption. Your own
**pinned note** sits above it.

**When the branch writes back, the card reacts** (built 2026-08-14). The
webhook reads the email rather than just filing it: a rejection or a
counter-offer moves the instruction off "chase the agent" and onto
"Renegotiate", an acceptance becomes "Get it in writing", and anything less
obvious raises the card's attention and leaves the tag to a human. It never
moves a board column and never sends anything. Any figure the branch named is
recorded as **theirs** (`branch_stated_figure`), never as a price we agreed.

**The board, in order:** Discovery done evaluating → Ready for call 2 → Ballpark
agreed → Needs viewing → Offer sent → Offer accepted → Sent to investor → Deal
closed.

---

## Stage 11. How a deal becomes money

1. Ballpark agreed on call two.
2. The offer goes over **by email, subject to our builder viewing** (never
   "subject to survey").
3. The viewing happens only once the ballpark is agreed, and **the builder is
   the viewer**, confirming the refurb number on site. A roster matches a builder
   to a house by postcode area.
4. Acceptance confirmed **in writing**, with address and price.
5. We package it: numbers, three sold comps and one rent comp as clickable
   links, photos.
6. We sell it to an investor for **GBP 3,000 to 5,000 plus VAT**, half on
   reservation, half at exchange. A high builder quote is renegotiation room,
   not a dead deal.

---

## What is proven, and what is not

**Proven:**
- The formula reproduces three published Dealers Club deals to two decimal
  places (Grimsby 25.88%, Northampton 20.91%, Nottingham 30.20%).
- Adding a bedroom is worth about **1%** at the same size on the same street.
  Price follows square metres, not room count. Measured and abandoned 2026-08-12.
- You cannot buy at market value and refinance your money out.
- Pedro connects on **93%** of calls, 73 money conversations in three days.
- First green run 2026-08-13: **14 passes from 851 judged**, median 9 comps each.

**Not proven, and nobody should pretend otherwise:**
- **Whether Pedro can win a 25% discount. No offer has been accepted yet.**
- Refurb costs are estimates, not builder quotes. One pound of refurb error
  moves the maximum offer by about GBP 1.05.
- **No investor has seen a deal. The fee is a plan, not income.**
- The builder roster is built but **empty**, and nobody has decided who the VA is.

---

## Where the weak points are today

1. **The legal side is not in place.** AML supervision, ICO registration, a
   redress scheme and professional indemnity insurance are all required to take
   a sourcing fee in the UK. This one can stop the business, not just slow it.
2. **Refurb is the softest number in the chain** and it multiplies through
   everything. The rate card assumes our own crew at 65% of trade labour, which
   makes our offers higher than a trade-rate crew could deliver.
3. **The 21-day rule is off until 2026-08-28.**
4. **Missing phone numbers are the biggest single loss.**
5. **Floor area is still unknown on about 70% of judged properties**, so most
   houses are valued without knowing their size, which is exactly what the
   per-sqm pricing needs. EPC fills only 9.5% of the gap (394 of 4,160 lookups).
   `floor_area.py` now runs every night (it did not before 2026-08-14) and the
   cache went from 1,485 to 1,893 properties, but **3,779 floor plans we already
   hold are still unread**, and about 36% of a read yields an area. Reading them
   is the biggest remaining lever on valuation accuracy.
6. **A comps valuation is not a survey.** The cross-checks are two blunt second
   opinions and cannot see a whole postcode being wrong.
7. **The 14-day branch cooldown is protective but expensive.**
8. **Discovery rests on the floor plan**, which arrives on a background drain
   that can run behind by more than one night.
