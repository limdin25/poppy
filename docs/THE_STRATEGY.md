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

### The rule is checked again at the door, and unverified is a refusal

Added 2026-08-16 after Hugo audited the dialer and found four leads that should
never have been in it (10.5%, 6.7% and 3.0% under, plus one house that had left
our listing table).

The engine's own gate was correct and had always worked. But **it only guarded
the moment a property was pushed to the CRM**, and the script that fills Pedro's
queue read from a table still holding rows written before that gate existed. It
had no discount check of its own at all. A rule added at the front door did
nothing about what was already inside the house.

So the measured discount now **travels** with the deal (`local_discount_pct`),
and **both** assign scripts re-check it as the last thing before a queue row is
written. **A missing measurement is a refusal, not a pass.** Treating "we never
measured it" as "probably fine" is exactly how those four got in front of him.

**What that audit actually exposed.** Once every property in the CRM was
measured where it stood, only **52 of 181 met the 15% rule**. The median was
9.4% and the worst was asking **46.7% above** its own local median. Hugo's
instinct about the queue was right on a far larger scale than the four he could
see. `tests/queue-discount-rule.test.ts` pins the fence, including that both
scripts report how many they held back, because a silent filter is how you find
out months later that the queue has been quietly empty.

**The 14-day cooldown is separate and untouched.** A branch that spoke to us
stays off the call list for a fortnight. The follow-up round Hugo runs from the
CRM contacts side is a different path and is not governed by this rule.

**Ranked by how hard the call will be, easiest first.** Changed 2026-08-15,
and it was the single worst thing about the old list.

The screen used to rank on the raw discount and read no condition at all. Take
two houses both asking £85,000 into a £100,000 median:

| Work needed | Most we can pay | Talk-down required |
|---|---|---|
| £15,000 | £73,800 | **13%** |
| £30,000 | £61,200 | **28%** |

The old ranking put the second one **first**, and 28% is exactly the lowball
the course spends a module telling you never to make. The top of Pedro's list
was systematically the part he could not close.

Now: the condition band is read from the **advert's own words** (free, no
photos, no floor plan), priced through the rate card, and the list is ordered
by the **talk-down the deal actually requires**, then by motivated-seller
wording, then by price cuts.

**Measured before the threshold was set** (492 branches): the required
talk-down runs from **minus 32% to 48%, median 10.2%**. A negative number means
we could pay *more* than they are asking and it still works. A 25% cap drops
only **8 of 492**, so be honest about it: the value is in the **ordering**, not
the cut. It is not tightened to 15%, which would throw away 29% of a pool that
is already the binding constraint on 150 calls a night.

A guessed refurb can therefore **reorder** the list or **drop** an impossible
house. It can never let one in: the 15% gate above is still built from two
hard facts and nothing else.

**Top 150 branches a night.**

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
4. **Prices the works twice.** The **trade rate** sets the offer; our own
   crew's rate is the **budget the builder is handed**. See section 4.
5. **Re-checks the comparables** to the course standard and **estimates the
   rent**.
6. **Uses the two facts the desk cannot know**, both captured on call one and
   both, until 2026-08-15, thrown away:
   - **The done-up sale the agent quoted.** The course calls this the best
     question on the call and it is: same street, same stock, finished
     condition, which is exactly what the Land Registry cannot tell us. It is
     believed in **one direction only**. Lower than our figure, we take theirs.
     Higher, it is recorded and changes nothing, because the witness is the
     person selling us the house and believing one sentence upward is how
     Orion Way reached £293,000.
   - **Any offer the vendor has already refused.** Their floor. If it sits
     above our ceiling the ballpark says so in plain English. It can kill a
     deal and it can never lift our number.

Both travel to the engine as **numbers, not prose**. Anything inside the call
notes goes only to the photo-reading model and is money-redacted first, so
"number 12 went for £118k" was arriving as "number 12 went for [price removed]".

---

## 4. The offer: all the money comes back

**The target is not a discount. It is the price at which the investor's
capital all returns on refinance.** The discount is the consequence, not the
aim, which is why a house needing heavy work gets a deeper offer
automatically.

**The refurb that sets the price is the TRADE rate, not our crew's.** Changed
2026-08-15 on Hugo's "the offer is reading too high". TMV = GDV minus refurb,
so taking the cheapest possible cost and offering as though it were certain
made every offer too generous, pound for pound. The course is explicit the
other way: *"you'd rather be a bit more over than under."*

The crew rate has not gone; it has changed job. It is the **budget we hand the
builder** ("this is our budget, tell us what you can do around it"), which is a
negotiating position rather than a forecast. **The gap between the two is our
cushion**, and it is why deals do not stick on the shelf. Both numbers are on
the ballpark screen so nobody can mistake one for the other.

```
GDV        what it is worth done up, from gold, strong or fair comps
TMV        GDV minus (refurb at the TRADE rate + 5% contingency)

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

**The quarter mile is fixed. The age is what gives.** Gold is 6 months at
400m, strong is 12 months at 400m, **fair is 24 months at 400m and is now
accepted, labelled "weaker" on screen**. Changed 2026-08-15 because the list
that produces the call accepts 24 months, so a house could pass the screen,
cost Pedro a four-minute call, and then refuse to price.

Closing that needed a change inside the comparable picker, not a filter on its
answer: it widens the **radius** to 800m *before* it widens the age, so
"a quarter mile, whatever the age" was not expressible. **800m evidence is
still refused.**

---

## 7. What we know is still missing

Honesty here is worth more than a tidy document.

- **The price history is wired but empty.** It reads cuts, total drop and
  fall-throughs, but the table only started on 12 August and no price has
  moved in it yet. "Reduced three times" becomes real in a few weeks.
- **Floor area is unknown on about two thirds of properties**, which is the
  main reason we can fully value only a small share of the stock. Improving
  as of 2026-08-15: the advert itself publishes a size on roughly a quarter
  of listings and the browserless read now takes it.
- **The ballpark still does not run the second-brain auditor.** The nightly
  gate does. The auditor needs a current-market value the ballpark never
  computes, and one of its rules kills outright when that is missing, so
  wiring it naively would refuse every ballpark. Deliberately left until it
  can be tested against real deals rather than assumed safe.
- **The national list is not yet what the nightly scrapes.** 305 towns are
  resolved and verified (187,914 live listings against the 40,252 we hold),
  but they drive the browserless reader only. 305 searches through the old
  browser path is about four hours inside a window that ends at 06:10.
- **A sold comparable is never checked for condition.** The Land Registry
  publishes no such field, so a wreck that sold cheap on the subject's own
  street quietly drags the end value down and nothing detects it. The only
  defence is the price-per-square-metre outlier test, which fires at 40%
  below the local rate. Partly unfixable, and worth knowing.
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

**The 16,681 houses nobody could ring.** `no_agent_phone` was the single
biggest refusal in the pipeline, bigger than auction, tenanted and
no-floor-plan **combined**, and it had been treated as a fact of life for
weeks. It was never a parsing bug: those listings had no phone AND no agency
name AND no description, because **the detail page had simply never been
fetched**. That needed a browser, which needed a residential proxy, and the
proxy had been dead since 11 August. An elaborate workaround was built to
recover agency names from Zoopla instead; it recovered **three** phones,
because its own input needed the same dead proxy.

Measured 2026-08-15: **Rightmove answers a plain GET from the server in about
0.3 seconds**, no browser and no proxy, and the whole listing is inlined in the
page. 39 of 40 sampled dead listings came back complete. The **search results
page carries the agent's phone on every single row**, so new stock now arrives
with a number attached and the refusal cannot happen again.

Two traps inside it, both worth remembering: the blob was renamed to
`window.__PAGE_MODEL` with **two** underscores, so the old reader matched
nothing at all; and it is **flattened**, every value being an index into an
array, so parsing it the obvious way returns a tree of integers and no phone
number. The lesson is the first one though: **a refusal that large deserved
somebody asking why, not a workaround.**

**Pendennis Street.** Asking £135,000 where the same kind of house nearby
sold at £103,000, sitting on Pedro's list as a deal, because the old path
compared asking to the **done-up** value. One discount rule now governs both
lanes.
