# The add-value pivot: the go/no-go number

**Run 2026-08-11 against `rm_floorplan_ai` + `rm_comps` on the margarita VPS.
Read-only, nothing in `scraper.db` was changed.**

Script: `/root/scraper/addvalue_qualifier.py`
Full results: `exports/addvalue_qualifier_results.csv` (all 2,069), 
`exports/addvalue_qualifier_PASSES.csv` (the 27), 
`exports/addvalue_qualifier_results.json` (every number, every comp used).

---

## 1. The headline

Out of **2,069** properties flagged `can_add_bedroom`:

| | Count |
|---|---|
| Pass the money-out test on the raw numbers | **27** (1.3%) |
| Of those, survive a basic sanity check on the valuation | **12** (0.6%) |
| Of those, have a proper same-bedroom cross-check behind the valuation | **2** (0.1%) |

Of the 12 that survive the sanity check: 5 pass at full asking, 4 at 5% off,
3 at 10% off.

**The honest answer is that effectively nothing passes.** The 27 are not a
pipeline. They are the noisiest 1% of a noisy valuation, and they thin out to
almost nothing the moment you ask the comps to agree with each other.

---

## 2. Why, in one line

**To pass this test a property must be worth about 1.79x its asking price after
the works. In our own data one extra bedroom actually adds a median of 5%.**

The measured gap:

| | |
|---|---|
| After-works value **needed** to pass at asking | **1.79x asking** (median) |
| After-works value **actually achieved** from local comps | **1.07x asking** (median) |

And measured on the 341 properties where we have both a same-bedroom valuation
and a finished-bedroom valuation from local sold comps, here is what the extra
bedroom is really worth:

| What the extra bedroom adds | Properties | Share |
|---|---|---|
| Negative (the bigger house sells for less locally) | 127 | 37.2% |
| 0 to 10% | 73 | 21.4% |
| 10 to 20% | 52 | 15.2% |
| 20 to 30% | 32 | 9.4% |
| 30 to 50% | 29 | 8.5% |
| 50 to 76% | 12 | 3.5% |
| **76%+ (the level that would pass at asking)** | **16** | **4.7%** |

Median: **+5.1%**. That is in line with the doc's own expectation of 10-20%,
and nowhere near the ~79% the test demands.

---

## 3. The structural problem: it is not a targeting problem

This is the part that decides the pivot. Buying at **full market value**, here
is the uplift the test requires, by price bracket:

| Property value | Uplift needed to pass |
|---|---|
| £60,000 | +123% |
| £90,000 | +93% |
| £120,000 | +78% |
| £150,000 | +69% |
| £200,000 | +61% |
| £300,000 | +53% |
| £500,000 | +48% |

Adding a bedroom does not add 48%, let alone 123%. So **at no price point, in
no postcode, does buying at market value pass this test.** Pointing Pedro at a
different town does not fix it.

Turned round the other way: given a realistic bedroom uplift, how far below
market value do you still have to buy?

| Bedroom adds | £90k property | £150k property | £250k property |
|---|---|---|---|
| +5% | 64% below value | 48% below | 38% below |
| +10% | 61% below | 44% below | 34% below |
| +15% | 57% below | 41% below | 30% below |
| +20% | 55% below | 37% below | 26% below |
| +30% | 47% below | 29% below | 19% below |

Compare that with the **old** strategy (buy, light refurb, refinance, no
conversion), which needs:

| | £90k | £150k | £250k |
|---|---|---|---|
| Discount needed, old strategy | 41% below | 35% below | 31% below |

**On our actual stock the pivot makes the required discount worse, not better.**
At a realistic +15% bedroom uplift you need 41% off a £150k house, against 35%
off for doing nothing but a tidy-up. The doc predicted this ("this bar is harder
to clear than the old one"). The data confirms it.

The reason is that the refurb is a fixed cost on cheap stock. £38,000 of works
on a £120,000 house is a third of the purchase price, and the refinance only
gives back 75p in the pound of any value it creates. On this price bracket you
lose money on every pound of refurb.

---

## 4. Why the failures failed

| Reason | Count |
|---|---|
| **Failed the money-out test** (got a real valuation, maths did not work) | **526** |
| Auction | 475 |
| Comps too scattered / unusable at the finished bedroom count | 386 |
| Fewer than 3 sold comps at the finished bedroom count nearby | 328 |
| Proposed bedroom would have no window | 241 |
| Shared ownership | 69 |
| Retirement / age-restricted | 7 |
| No refurb cost figure (5, 6, 7-bed) | 7 |
| Bedroom count unusable | 2 |
| No usable asking price | 1 |
| **PASS** | **27** |

Only **553 of 2,069** could be valued at all. **714 failed as "cannot value"**,
and 266 of those had no finished-bedroom sold comp within reach at all. That is
a separate problem worth knowing about: for a third of the stock we currently
have no basis to price a conversion even if the strategy worked.

## 5. How much discount the failures actually need

Of the 526 that got a real valuation and failed the maths:

| Discount needed | Count |
|---|---|
| 10-15% | 8 |
| 15-20% | 13 |
| 20-25% | 11 |
| 25-30% | 13 |
| 30-40% | 45 |
| 40-50% | 103 |
| **over 50%** | **333** |

**Median discount needed: 56%.** A quarter need 45% or more. Only 8 properties
out of 2,069 are within 15% of working.

This is the number the brief asked for, and it is unambiguous: this is not a
list that needs a nudge, it is a list that misses by a factor.

---

## 6. Where the passes cluster

There is no cluster. The 12 credible passes are one property each in 12
different postcode districts: M30, B18, S11, NG7, CH3, CH43, B32, NG8, FY2,
LA1, CV7, CV6. Seven houses, five flats.

Twelve singletons spread across Manchester, Birmingham, Sheffield, Nottingham,
Chester, the Wirral, Blackpool, Lancaster and Coventry is the signature of
random valuation noise, not of a market where the 2-bed to 3-bed gap is wide.
There is nowhere to point Pedro.

---

## 7. What I do not believe about the 27

The 27 were checked by hand. The pattern is the same one already documented in
`valuation.py` (the Holloway Head case, where five luxury new-builds 100m away
"valued" an ex-council flat at 3x its asking price):

- **10 of the 12 credible passes have no same-bedroom valuation at all**, so the
  sanity cap never fired on them. Their entire case is one set of comps with
  nothing to check it against.
- The 15 discarded include a £140,000 Manchester flat valued at £455,849 after
  works, and a £54,000 Coventry flat valued at £330,479.
- The strongest single pass (Branston Street, B18) had a **raw** after-works
  value of £454,697 against a current value of £197,085. It only looks sensible
  because the +30% cap forced it down to £256,210. That is the cap doing the
  work, not the evidence.
- Several are 1-bed flats where "convert the kitchen to a bedroom" would leave a
  flat with no kitchen.

I would not put money on any of them.

---

## 8. The assumptions, so they can be challenged

**Stamp duty** — England/Northern Ireland, checked on gov.uk on 2026-08-11.
Standard bands in force since 1 April 2025: 0% to £125,000, 2% to £250,000,
5% to £925,000, 10% to £1.5m, 12% above. Plus the **5 percentage point
additional-property surcharge** in force since 31 October 2024, giving
5% / 7% / 10% / 15% / 17%. Purchases under £40,000 pay no surcharge (and 0%
standard below £125,000).

**Refurb** — Hugo's own table in `bedroom_uplift.py`, dated 2026-08-11, which
already carries 10-15% contingency inside it:

| Conversion | Budget used |
|---|---|
| 1-bed to 2-bed | £31,500 |
| 2-bed to 3-bed | £36,500 |
| 3-bed to 4-bed | £44,000 |
| 4-bed to 5-bed | £51,500 |

Scaled per property by floor area where known (bounded 0.85 to 1.35 of the
median for that type and bed count), then lifted 5% to guarantee the 15%
contingency the brief asked for. Only 592 of 2,069 rows carry a floor area, so
for most properties the figure is the table value.

**Other money in** — buying costs £3,000 (solicitor, searches, survey, lender
legals); refinance costs £2,000; holding 6% of purchase price (2% bridge
arrangement plus 1% a month for six months on a 75% bridge, the existing
engine's assumption) plus £1,500 running costs over six months.

**After-works value** — sold comps at the finished bedroom count only, same
property-type family, within 800m and 60 months, put through the existing
`valuation.run_pipeline` (median-based, time-adjusted for house price growth,
distress sales filtered, statistical outliers rejected). Capped at 1.30x the
same-bedroom current value where one exists, because no surveyor will back
more than +30% for one bedroom.

**Sensitivity.** Removing the +30% cap entirely moves the answer from 27 to 28.
Using Hugo's *high* refurb figures instead of budget moves it from 27 to 21.
**The refurb assumption is not what is killing this.** The valuation gap is.
Even if refurb were free, a property still needs to be worth ~1.5x asking after
works to pass, and the median is 1.07x.

---

## 9. Recommendation

**Do not rebuild Pedro's queue from this.** There is no queue to build. Twelve
uncorroborated singletons is not a week of calling.

The pivot as specified does not work, and it does not work for a structural
reason rather than a targeting one: the money-out test at 75% LTV needs a ~79%
uplift, and a bedroom gives 5%. Three things could each be true and are worth
Hugo deciding on before anything is rebuilt:

1. **The bar may be too strict for this price bracket.** Requiring near-total
   refinance out of a £120,000 house is arithmetically close to impossible once
   a £38,000 refurb is in it. It is the 75% LTV plus the fixed refurb, not the
   idea of adding bedrooms, that fails.
2. **The stock is wrong for the strategy.** Everything here is £35k-£150k. The
   maths gets less brutal as value rises (48% uplift needed at £500k against
   123% at £60k). If this strategy is to be tried at all, it belongs on more
   expensive stock, which is not what we are scraping.
3. **The comps cannot support the test on a third of the stock anyway.**
   714 properties could not be valued, 266 with no relevant comp at all.

The one thing the data says clearly: whatever Pedro offers, the deal has to come
from buying below value. The pivot does not remove that, it increases it.
