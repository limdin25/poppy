# The strategy, end to end

**Written 2026-08-15.** This is the one page that says what we do and why.
Where it disagrees with an older document, this one wins. The engineering
record of how each piece got here is [DECISIONS_LOG.md](DECISIONS_LOG.md)
rows 60 to 79; the property business rules live in
[BRRR_STRATEGY.md](BRRR_STRATEGY.md).

---

## The one sentence

Find houses already advertised well below what the same kind of house sold
for on their own street, ring the agent to find out why, and offer the price
at which the investor gets all their money back.

---

## 1. What reaches Pedro, and why

A property is only worth a phone call if the discount is **already visible
before anybody dials**. That is the whole screen, and it deliberately uses
only hard facts:

| Test | Why it is that number |
|---|---|
| Asking at least **15% under** the local sold median | Under this there is nothing to source: it is priced like its neighbours |
| Not more than **45% under** | Past this the cause is almost never a desperate vendor. It is a comp set that does not belong to the house |
| At least **3 sold comps** | Fewer than three and one odd sale sets the price |
| Within **400 metres** | The course's quarter mile |
| Sold within **24 months** | Older than that and the market has moved |
| **Same style and same bedroom count** | See the trap below |

**THE TRAP THIS EXISTS TO AVOID.** Comparing a 2-bed terrace against 3-bed
semis makes a house look 45% underpriced when it is merely smaller. That is
the Orion Way mistake and the Doulton Street mistake, and it is why a comp
must match on style (end-of-terrace prices with terraces, a bungalow is its
own thing) and on bedroom count, or it does not count at all.

**What this screen does NOT use, on purpose:** no refurb estimate, no
condition read, no floor plan. Those were the three numbers that were wrong
on Granton Avenue, so the screen routes around all of them.

Then hard excludes: no auctions (see section 6), no flats, no leasehold,
£40k to £200k, crime cap, one property per branch, and no branch rung in the
last 14 days.

**Ranked by** the size of the discount, then by motivated-seller wording in
the agent's own advert (sold as seen, cash buyers only, probate, must be
sold, in need of), then by price cuts. **Top 150 branches a night.**

---

## 2. Call one: find out why it is cheap

Pedro **never names a figure**. That is not a style choice, it is the
structure: at this point nobody has priced the works, and a number said out
loud cannot be unsaid.

What he must come away with:

- **The big four**: roof, damp, electrics, boiler
- **Is it dry**: leaks, staining on ceilings
- Why they are selling, and how long it has been on
- **Any offer already rejected, and at what level.** The rejected number is
  the vendor's floor and agents give it up readily
- What it would let for
- Who he spoke to, and an email address

And one thing he **leaves behind on every call**, first or second: our email,
with a standing brief. *Anything that comes in needing plenty of work, or where
the price has to come down, send it straight to me and I'll come back to you the
same day.* Two things only, because that is what a negotiator can spot, and said
after the email he sends on the call has landed so our address is in front of
them. It is not their mailing list, which is every house on Rightmove and is a
brush-off. This is the only part of a call that still pays when the house does
not: most branches have nothing today, and every one of them gets a scruffy one
eventually.

A live AI coach listens and prompts him. The checklist is **house-aware**: it
only shows questions the machine could not already answer for that house, so
a well-documented listing gets a short call.

---

## 3. The ballpark: the machine does the homework

Pressing **Fetch ballpark** is where the real work happens, and it only runs
on houses a human has already spent four minutes on, so it can afford to be
expensive.

1. **Hears the call.** Reads the transcript and Pedro's typed notes.
2. **Looks at the house properly.** Every photograph on the listing, with
   what the agent said shown alongside, and told to trust the agent over its
   own reading where they contradict. The nightly scan reads three photos;
   this reads all of them.
3. **Compares the two reads** and warns on screen when they disagree by two
   condition bands or more, because that is a house nobody understands yet.
4. **Prices the works** from the line-item rate card, always at the low end,
   at our own crew's labour rate.
5. **Re-checks the comparables** to the course standard and **estimates the
   rent**.

---

## 4. The offer: all the money comes back

**The target is not a discount. It is the price at which the investor's
capital all returns on refinance.** The discount is the consequence, not the
aim, which is why a house needing heavy work gets a deeper offer
automatically.

```
GDV        what it is worth done up, from gold or strong comps only
TMV        GDV minus (refurb + 5% contingency)

OPEN AT    the LOWER of:  the all-money-out price
                          TMV x 0.75
           and never above 85% of asking

WALK AT    the LOWER of:  the price where more than 10% of capital stays in
                          TMV x 0.80
           and never above the asking price itself
```

Every constraint is a maximum, so we take the lowest. Opening low is
recoverable; opening high is not.

**The full cost stack**, because a missing cost is an offer that is too
generous by the same amount: purchase, stamp duty with the additional
property surcharge, legals, broker, survey, valuation, the refurb with
contingency, insurance and council tax and utilities while the house is
empty, refinance fees, and our own sourcing fee. Three scenarios, and **the
conservative one decides**. A deal that only works optimistically is not a
deal.

**The hard limit is 10% of capital left in, not a flat sum.** That is the
course's rule.

---

## 5. Call two, and then the builder

Pedro floats the number as a question, never an offer:

> "The next step our end is booking our builder in to price the works, but
> before I set that up I don't want to waste your time or embarrass anyone
> with a silly offer. So if we were to offer around X, am I in the ballpark
> or a million miles off?"

He never makes a formal offer and never books a viewing himself. If they are
in the ballpark, **the builder goes in and quotes inside our stated budget**,
which is the whole point of taking the low end: the budget is what we hand
him, not a prediction.

---

## 6. Rules that are not up for debate

**No auctions.** The course: *"Another thing to avoid is auctions ... we
don't recommend it for deal sourcing because it's too risky ... you have to
commit to buying it."* At the hammer you are legally bound with no survey
clause and no way to pass it to an investor. The course does allow securing
a property **before or after** an auction by private treaty, which is a
different thing.

**No conversions in the offer.** The add-a-bedroom strategy was measured on
2026-08-11 and retired: 2,069 properties, 27 passed on paper, **2 survived a
look**. One extra bedroom adds a median of 5.1%, and on 37% of properties
the bigger house sells for less locally.

**Money is computed on the engine and nowhere else.** The CRM reads figures
and refuses to derive them.

**Only gold or strong comparables may carry a figure.** Gold is 6 months and
400m, strong is 12 months and 400m.

---

## 7. What we know is still missing

Honesty here is worth more than a tidy document.

- **The price history is wired but empty.** It reads cuts, total drop and
  fall-throughs, but the table only started on 12 August and no price has
  moved in it yet. "Reduced three times" becomes real in a few weeks.
- **Floor area is unknown on about two thirds of properties**, which is the
  main reason we can fully value only a small share of the stock. This is
  the bottleneck on how many offers we can put forward, not call volume.
- **No investor list, no compliance, no builder on the roster, and no house
  has been viewed.** Known, and outside this document.

---

## 8. The lessons that cost us something

Each of these was a real mistake, found in real data.

**Orion Way.** A 2-bed ex-council flat asking £100k was valued at £293k off
luxury new-build comps 100 metres away. Comps must match on size and style,
and be priced per square metre with outliers rejected.

**Doulton Street.** Advert said "well-presented"; the machine expected
£56,000 of uplift. Its own street had sold at £85,000 while a road 130
metres away sold at £250,000. The second-brain auditor killed it on
`comps_disagree`, independently of a human reading the same advert.

**Granton Avenue.** The machine judged the condition on **3 photographs out
of 17** and called a house with stripped walls and artex ceilings
"modernisation" at high confidence, pricing the works at £7,839. Two
separate faults: the ballpark now reads every photo, and the rate card had
**no painting line at all in any band**, which made every offer in the
system too generous. Corrected, the works are £15,194 and the offer moved
from 15% under asking to 25% under.

**Pendennis Street.** Asking £135,000 where the same kind of house nearby
sold at £103,000, sitting on Pedro's list as a deal, because the old path
compared asking to the **done-up** value. One discount rule now governs both
lanes.
