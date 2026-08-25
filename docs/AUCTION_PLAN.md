> # ⛔ SUPERSEDED 2026-08-23. DO NOT USE THE NUMBERS IN THIS FILE.
>
> **The single source of truth is now [AUCTION_DEAL_METHOD.md](AUCTION_DEAL_METHOD.md).**
>
> Three figures below are wrong and one of them is dangerous:
>
> | This file says | Correct | Why |
> |---|---|---|
> | max bid = **62%** of finished value | **42% to 47%** | this file omits the bridge, the six-month rule, JV legals and holding costs. On a £190,000 house 62% means bidding £117,800 when the ceiling is £82,692. **A £35,000 error.** |
> | finished value must be **2.2x** the hammer | **2.4x minimum, 2.7x is what winners paid** | measured on 5,186 real refurbishments in HM Land Registry |
> | fee of **£3,000** | **£10,000 minimum** | 22% of real deals had room for £10,000+ |
> | 85% bridge, 5 months, 80% refinance | **75% bridge, 7 months, 75% refinance** | corrected against `brrr uk/07_BRIDGING_LOANS.md` |
>
> What is still valid here: the Liverpool stress-test failure, the capital-threshold
> work, and Hugo's rejection of the course's auction ban. Everything numeric is dead.

# The auction plan

**Status: researched and stress tested 2026-08-22. NOT started, and the Liverpool
version of it FAILED the stress test.** This is the reference document. When Hugo
says "the auction plan", "our auction plan" or anything auction, read this first.

Interactive model, with every lever live:
https://claude.ai/code/artifact/5d677d07-4ff1-4263-8e8a-ccc52f9fcd21

Hugo's framing, 2026-08-22: stop calling estate agents, buy at auction instead, do
the analysis with AI, bid with certainty, recycle the money, charge a £3,000 fee and
give a JV partner 40%. He has **£30,000** liquid. **Forget the Fontaine course and
`docs/THE_STRATEGY.md` §6 on this: Hugo explicitly rejected the course's auction ban
and the pre/post-auction private treaty suggestion. Do not re-raise them.**

---

## 1. The two tests. A deal must pass BOTH.

The first draft of this analysis got this wrong by leading with the discount, and
Hugo caught it. Record the correction, not just the conclusion.

| Test | Question | Answered by |
|---|---|---|
| **1. Can I complete?** | Do I have the cash on the day and at completion? | The **discount to true value**. Cashflow. |
| **2. Do I get my money back?** | Does the refinance return every pound? | The **finished value**, and nothing else. Value creation. |

A deal can pass Test 1 and fail Test 2 badly. **In practice Test 2 binds far more
often.** The discount gets you IN. The uplift gets you OUT.

### The field rule (fitted to the solver, worst drift £3.5k on heavy refurbs)

> **Max bid = 62% of finished value, minus the refurb, minus £11,000.**

Stated the other way, which is the more useful form:

> **The finished value has to be about 2.2x the hammer price.**

| Pay | Refurb at 25% | Finished value needed | Multiple |
|---|---|---|---|
| £50,000 | £12,500 | £114,695 | 2.29x |
| £70,000 | £17,500 | £154,447 | 2.21x |
| £100,000 | £25,000 | £214,078 | 2.14x |
| £150,000 | £37,500 | £314,182 | 2.09x |

The £11,000 is fixed cost drag: 5% company SDLT, auction fee, both legals, lender
valuation, arrangement fee, holding costs. **On a £70,000 purchase total costs are
about £21,900, which is 31% of the price.** They barely move with the price of the
house, so cheap stock is punished twice: brutal proportional costs AND less absolute
value to create. **This is a real argument for £90k-£130k stock, not £50k stock.**

---

## 2. The money, on Aria Finance's real terms

Broker: **Joseph Aston, Sales and Commercial Director, Aria Finance**
(Joseph.Aston@ariafinance.co.uk). Terms given by email 22 May 2026. Use these, not
published rate cards.

- ~**1% a month**, rising to ~1.1% under £50-60k loans
- **2% lender arrangement fee, NO exit penalties at all**
- **Interest is retained** (a £70k facility hands over ~£62k on day one)
- Most lenders have a £100k minimum but **he has a small-loan option**, so £65-70k works
- Works funded in **staged drawdowns in arrears**, interest only on money drawn, so
  Hugo floats about one stage (a third) at a time
- **Written lender terms before auction day** and 28-day completion is "absolutely the norm"
- More than one bridge at a time, no real limit
- SDLT is charged on hammer price **plus the buyer's fee** (HMRC SDLTM03740)

### The one line that unlocks £30,000

Joseph verbatim: *"there are bridging lenders who will lend higher LTV against
purchase price, so long as the loan stays below 75% of the true value."*

> **Buy at 25% below true value and 75% of true value IS 100% of what you paid.**
> Worth £93,333, bought for £70,000. 75% of £93,333 = £70,000.

⚠️ **UNCONFIRMED AND LOAD-BEARING.** He said he would "explore" it. The standard
lender objection is that a price achieved in open competitive bidding IS market
value, which is much harder to argue at auction than off-market. **Without it, £30k
caps you at ~£53,500 with no refurb float, or ~£38,000 with one.**

### Five questions still outstanding with Joseph

1. Will a lender accept an auction hammer price as below market value? Which lender,
   and what evidence of true value (a RICS valuation is another £700 and a delay)?
2. Small-loan lender: actual minimum loan AND minimum property value?
3. Minimum arrangement fee in cash? 2% of £52,500 is £1,050; £2,000 floors are common.
4. Will the lender consent to a shareholder change mid-term? (decides the JV timing)
5. **Is retained interest refunded pro rata on early redemption?** If yes, always take
   the longest facility. If no, the term you pick is money spent.

### ⚠️ THE REAL 6-MONTH TRAP IS THE PRICE CAP, NOT REFUSAL

**Most lenders do not refuse a sub-6-month remortgage. They cap you at the LOWER of
purchase price or valuation, which silently deletes the entire uplift.** Buy £70k,
spend £20k, worth £150k, and a price-capped lender at 75% hands you £52,500 instead of
£112,500. The valuer may well have agreed £150k. **That is a policy cap, not a down
valuation, and it is by far the most common way a BRRR exit fails.**

**So the exit lender is chosen BEFORE the bid, not after the works.**

| Lender | Day one at market value? | Note |
|---|---|---|
| **Aldermore** | **YES** | Own example: auction buy £135k cash + £12k works, MV £180k, lends 80% = **£144,000**. Min 1 month ownership, panel solicitor mandatory under 6 months |
| **CHL** | **YES** | Market value where uplift explained by works. Bridge lender must be FCA registered |
| **Shawbrook** | **YES** | "No minimum length since time of purchase" |
| **Fleet** | **YES** | Market value if significant improvements evidenced |
| **West One** | **YES** | Uplift needs valuer commentary |
| **Foundation** | Conditional | **An AUCTION PURCHASE ALONE unlocks market value, even with no works done.** Private-individual bridge excluded |
| **Zephyr** | Conditional | Materially improved = MV **capped at 75% LTV** |
| **Paragon** | Conditional | Needs schedule of works + evidence, 12-month clock, capped 70% |
| **TMW, BM Solutions** | **NO** | Hard refusal. BM: "appeals on present condition market value are not permitted" |
| **Precise, Kent Reliance** | **GONE** | **Left BTL entirely Nov/Dec 2025**, replaced by **Rely**. Any criteria you hold is dead paper |

Nobody publishes a minimum uplift %. Nobody excludes auction purchases; Aldermore,
Foundation and Shawbrook treat them favourably. **Foundation and Vida both refuse to
refinance a bridge from a private individual** (must be an FCA-registered lender).

### ✅ ANSWERED: unused retained interest IS refunded

Bridging Finance Solutions, verbatim: *"any remaining months and days of interest will
be credited back to your account in the calculation of the settlement figure."* It
arrives as a smaller redemption figure, not a cheque.

**But there is a floor: a minimum interest period of 1 to 3 months.** Shawbrook "no
minimum term or interest period"; MT Finance, West One, Precise = 1 month;
Funding 365 = 3 months then rebates daily.

**Two changes because of this:**
1. **No lender publishes the refund policy in the product guide, it lives in the
   facility agreement. Get it into the heads of terms in writing.**
2. **Ask for ROLLED-UP rather than RETAINED interest.** Removes the question, gives more
   day-one cash, and is genuinely cheaper: on £100k at 1% over 12 months, rolled-up
   costs £12,683 vs retained **£13,636**, because retained is charged on the grossed-up
   figure.

### Land Registry is a TWO WEEK problem if you expedite

Half of all register updates take ~8 months and 37.7% take over 3 months. **But
expediting is FREE, a pending remortgage qualifies by name, and HMLR's own annual
report records 424,000 fast-tracked applications with 95.6% done within 10 working
days.** The catch nobody models: **the expedite must be filed by the PURCHASE
conveyancer (not the remortgage one) with the mortgage offer letter attached.** Build
that step in the moment the BTL offer is issued. Registration must be done before
completion, but not before application.

### Cycle time: model 6 to 9 months, not 4

Floor is 4-5 months with the exit lender agreed before you buy. Refurb is only ~8 weeks
of it; the rest is lender queueing. **Bridging Trends: 10% of bridging loans are now
refinanced by ANOTHER BRIDGE**, which is the market's own measure of exit slippage.

### Down-valuations: do NOT use the "46%" figure

It is a Bankrate consumer survey from **October 2020**, republished undated with no
sample size. Defensible: 19-25% in 2022, one brokerage reporting ~20% in 2025, **nothing
published for 2026**, average shortfall **under £10,000**. **Remortgage risk is roughly
DOUBLE purchase risk** and that holds across 2014, 2022, 2024 and 2025 sources.
Context: TwentyCi Q2 2026 says the average new listing is priced **11.6% above its AVM
value, up from 5.7% a year earlier**, and RICS July 2026 shows a price net balance of
-30%. Appeals go to the lender not the surveyor, need 3+ sold comps, and the one
documented win was on specialist defect reports rather than comparables.

### Two physical risks to screen BEFORE bidding

- **Spray foam in the loft.** Only ~25% of lenders will lend. **Accord refuse even where
  it has been removed.** PCA's own survey of 500+ properties: divergence from protocol
  in 79%, defects in 35%.
- **Single-skin rear addition.** Victorian terraces often have a 4.5 inch single-storey
  rear outrigger, and that is exactly where a new kitchen or bathroom goes. Lenders
  commonly **exclude the single-skin area from the valuation entirely**.
- Also: **strip out any second kitchen** (reads as two dwellings, refused by Paragon and
  Leeds), and **never fill movement cracks before the valuation** (it removes the
  valuer's ability to date the movement, pushing them to "monitoring required", which is
  an outright decline). **"Wind and watertight" is NOT a BTL criterion**, it is a
  self-build drawdown term; the real test is a working kitchen and bathroom, and EPC E
  is already a hard mortgage condition.

### Refinance timing: the 6-month rule is lender policy, not law

Hugo was right and 9 months was too conservative. Aldermore's own broker document:
*"Landlords can apply to remortgage their buy to let properties to Aldermore the day
after purchase, based on market value."* Foundation: *"early remortgage is available
on all BTL products except for Specials."*

But it is not "as soon as the value goes up" either. Three real gates:
1. Works finished and the house **mortgageable** (wind and watertight, working kitchen
   and bathroom, building regs certs for structural work and new windows)
2. **HM Land Registry registration** evidenced before completion (Aldermore require it).
   The sleeper risk, outside your control, and it can hold a finished house hostage.
3. Valuation, underwriting and legals: 4-8 weeks even when nothing goes wrong

**Every month on the bridge costs about £850 of max bid and £930 of cash.** Model 6
months, not 9. At 6 months the max bid on a £155k GDV is £67,000; at 9 it is £64,500.

---

## 3. The JV. It is NOT criminal. Hugo asked; correct this if it comes up again.

**Nothing about a 60/40 JV is illegal, and bringing a partner in after the property is
secured and the bridge is running is completely normal.** The offence is not the deal,
it is one way of *finding* the partner: communicating an invitation to invest **to
people generally** (WhatsApp broadcast, IG post or story, group post, a list). That is
**s.21 FSMA**, committed the moment the message is sent, before anyone replies.
Up to 2 years and an unlimited fine, and **s.30 lets the partner unwind the agreement
and reclaim every penny even on a profitable deal.**

Analogy that landed: selling your car to a neighbour is fine; standing on the high
street offering investments to passers-by needs a licence.

### The legal sequence, in order

1. **SPV Ltd, Hugo 100%.** Not a trust, not an LLP. CIS Order 2001 Sch. para 21 puts a
   closed-ended body corporate outside the collective-investment-scheme definition.
2. **Hugo's cash goes in as a DIRECTOR'S LOAN, not share capital.** Most important
   paperwork in the plan: a loan is repayable tax free at any time; share capital needs
   a buyback taxed as a distribution at up to 39.35%. Free to do right, thousands to fix.
3. Buy at auction, draw the bridge, start works. No partner exists yet, so no promotion.
4. **Lender's WRITTEN consent before any share moves.** Doing it quietly is an event of
   default and on a bridge the remedy is redemption on demand.
5. **Approach ONE named person privately**, who has signed, **dated BEFORE the pitch**,
   an art. 48 certified high net worth statement (£100k income or £250k net assets ex
   home/pension/life) or art. 50A self-certified sophisticated statement. Thresholds are
   those reinstated 27 Mar 2024. The promotion must name the business.
6. **Issue NEW shares** (no stamp duty) rather than transfer (0.5%, nil under £1,000).
   No SDLT either way. Watch employment-related securities if he becomes a director.
7. **Partner's money in as a SHAREHOLDER LOAN + small share subscription; the company
   repays Hugo's director's loan with it.** Both are repayments of principal, neither
   taxable. **That is the flywheel in one line.**
8. **£3,000 is an ARRANGEMENT fee, not a sourcing fee**, disclosed in the JV agreement,
   declared under CA 2006 s.177. Since Hugo already owns it there is no client and no
   introduction, so the Estate Agents Act does not apply. ⚠️ BUT if the partner said
   "find me a deal and I'll fund it" BEFORE the purchase, it IS estate agency work
   whatever it is called after. Order of events is the whole case.

### Recycling at month one (Hugo's request, 2026-08-22)

Bringing the partner in at month 1 instead of waiting for the refinance:
**6.2 deals a year instead of 1.2.** Cost: ~£113,000 of partner capital tied up at
steady state, about **4 partners at £30k each**.

**The blocker is lender consent, not maths.** Three workarounds, in order:
1. Ask Joseph to source a lender that permits it, before drawing.
2. **Partner comes in as a LENDER only**, with a written right to 40% that completes
   when the bridge is redeemed. No shares move while the charge is live, so there is
   nothing to consent to. Keep his loan unsecured and subordinated.
3. Partner in the SPV from incorporation. Cleanest, but he must be committed before
   the bid, which is the speed problem Hugo was solving by using his own money.

---

## 4. THE LIVERPOOL STRESS TEST: the plan FAILED

### Start here: what Liverpool terraces ACTUALLY achieve at auction

1,034 lots scraped across all 11 Sutton Kersh auctions Feb 2025 to Jul 2026. Of 409
Liverpool terraced lots offered, **193 have a published achieved price**. These are
hammer prices, not guides.

> ## Median achieved price for a Liverpool terraced house at auction: **£98,000**
> - Under £70,000: **7 of 193 (3.6%)**
> - Under £60,000: **1 of 193**
> - Under £50,000: **ZERO**
> - 2025 median £97,000, **2026 median £99,000. The market is NOT softening.**
> - Cheapest in 18 months: £55,000 (24 Linacre Lane, Bootle L20)

| District | n | Median achieved | | District | n | Median achieved |
|---|---|---|---|---|---|---|
| L5 Everton | 4 | £85,000 | | L13 Old Swan | 23 | £103,000 |
| L6 Kensington | 30 | £90,000 | | L7 Edge Hill | 7 | £107,000 |
| L8 Toxteth | 18 | £90,000 | | **L15 Wavertree** | **21** | **£114,000** |
| L9 Walton | 10 | £90,000 | | **L17 Aigburth** | 8 | **£190,000** |
| L20 Bootle | 10 | £91,500 | | **L18 Mossley Hill** | 5 | **£225,000** |
| L4 Walton | 16 | £93,500 | | CH41 Birkenhead | 3 | £78,000 |

⚠️ **This kills the "go to a better postcode" answer, including the one I first gave.**
The nice postcodes come to auction CONSTANTLY. **L15 produced 21 terraced sales, more
than L4's 16.** They are simply not discounted: L17's cheapest in 18 months was
£138,000, L18's was £186,000. **There is no postcode where cheap stock and a high
ceiling overlap.**

The 7 that cleared under £70,000, complete list: 79 Holt Rd Birkenhead CH41 £55,000;
24 Linacre Lane Bootle L20 £55,000; 9 Appleton Rd Litherland L21 £60,000; 10 Wendell St
L8 £60,000; 101 Methuen St L15 £61,000; 72 Parton St L6 £65,000; 39 Rydal St L5 £68,000.

**Also informative: the cheap lots that FAILED to sell** at the 16 Jul 2026 sale:
12 Millvale St L6, 46 Pansy St L5, 15 Smollett St L20, 14 County Rd L4, 39 Irvine St L7,
1 Lincoln St L19, 34 Kenmare Rd L15.

### 🔑 THE SENTENCE THAT EXPLAINS EVERYTHING: the prices caught up with the model

Six specific houses from Hugo's own Zoopla search, priced against Land Registry sales on
their OWN streets, size-matched by EPC floor area. **All six fail.** But the same streets
worked for people who bought earlier:

| Same address, bought and sold | Bought | Sold | Months | Net after refurb + fees |
|---|---|---|---|---|
| 98A Woodchurch Rd | £80,000 | £150,500 | 4 | **+£34,500** |
| 23 Newling St | £51,400 | £110,000 | 14 | **+£27,600** |
| 233 Woodchurch Rd | £130,000 | £184,000 | 21 | **+£18,000** |
| **75 Junction Lane** | £70,000 | £116,000 | 11 | **+£10,000** |
| 213 Woodchurch Rd | £125,000 | £159,000 | 10 | -£2,000 |
| 55 Newling St | £45,000 | £71,500 | 5 | -£4,500 |
| 54 Junction Lane | £64,000 | £81,500 | 27 | -£13,500 |
| 50 Junction Lane | £39,999 | £56,000 | 2 | -£19,999 |

**75 Junction Lane: bought £70,000, sold £116,000 eleven months later, netted £10,000.**
That is almost exactly what is asked for 46 Junction Lane today. **The entries that
worked were £45k-£80k on streets now ASKING £65k-£70k. The model is not broken. Hugo is
two or three years late to these streets.**

### 🔑 THE SCREENING RULE: below ~70 sqm nothing above £30,000 can work

Finished £/sqm is **flat at £1,000-£1,450 across all six streets**, whether Wirral,
St Helens, 2-bed or 3-bed. Only Crosby differs (£1,600-£2,300).
**So Wirral vs Liverpool was never the split. FLOOR AREA is.**

Refurb + fees is a fixed £31,000 (2-bed) / £36,000 (3-bed):

| Finished value | Costs as share | Left for the purchase |
|---|---|---|
| £78,000 | 40% | £17,360 |
| £90,000 | 34% | £24,800 |
| £105,000 | 30% | £34,100 |
| £165,000 | 22% | £66,300 |

> **At ~£1,450/sqm finished you need ~112 sqm to justify a £65,000 entry, and ~90 sqm
> to justify £50,000. Below ~70 sqm, no price above £30,000 works at all.**

10 Lever Avenue is a "3-bed in Wirral at £50,000" and is **69 sqm**, which is why it
fails worst (-£48,700). Woodchurch Road is the only near miss because it is **121 sqm**.
**Screen on floor area before anything else.** Hugo's engine already refuses unsized
subjects, which turns out to be exactly right.

### 🔴 SECTION 21 WAS ABOLISHED ON 1 MAY 2026

Vacant possession of a tenanted house now needs **Ground 1A (sale)**: **4 months'
notice, unusable in the first 12 months of a tenancy, and bars re-letting for 12
months.** **A tenanted house is a house you cannot refurbish.** 4 of the 7 checked are
tenanted; **23 of 58** Merseyside lots in the September catalogue are let, including
three of the four cheapest houses. That is not a discount, it is a lock.

Also: **only 2 of the 6 were actually auction lots** (Woodchurch Rd via Savills,
Lever Ave via Barnard Marcus). The other four are private treaty, three of them tenanted
BTL stock sold by Glasgow portfolio traders, so the guide+21% premium does not apply.
Newling Street is already retracted and was advertised "finished to an excellent modern
standard", so there was never any value to add.

### The six, priced

| Lot | sqm | Asked | Likely pay | Finished | Max bid | Headroom |
|---|---|---|---|---|---|---|
| 39 Woodchurch Rd CH42 (auction, tenanted) | 121 | £65,000 | £78,650 | £150,000 | £54,900 | **-£23,750** |
| 10 Lever Ave CH44 (auction, VACANT) | 69 | £50,000 | £60,500 | £80,000 | £11,800 | -£48,700 |
| 46 Junction Lane WA9 (tenanted, leasehold) | 70 | £65,000 | £65,000 | £95,000 | £22,900 | -£42,100 |
| Yelverton Rd CH42 (vacant) | 55 | £70,000 | £70,000 | £80,000 | £18,600 | -£51,400 |
| 49 Newling St CH41 (RETRACTED) | 56 | £70,000 | £70,000 | £78,000 | £17,360 | -£52,640 |
| 35 Sherlock Lane CH44 (tenanted 7yrs) | 61 | £69,950 | £69,950 | £85,000 | £21,700 | -£48,250 |

The model allows paying **24% to 35% of what is asked** on five of six.
Measured finished/paid ratio: **0.90x to 2.10x** against the 2.2x required.

### ⚠️ CORRECTION: 12 Harrington Road, Crosby L23 5ST

I told Hugo it was Modern Method with a 4.5% reservation fee. **WRONG.** It is a genuine
**traditional unconditional auction**, 16 Sept, **Under The Hammer** (Advanced Nationwide
Ltd, co. 13575944). **£38,000 IS a real guide**, reserve ~£34,500-£42,200.
Fees: **greater of £2,500+VAT or 1.75%+VAT, plus £250 contract signing** (~£3,250 at
£38k, 8.6%), undisclosed on the portals. Deposit 10% **min £10,000**, charged immediately.

**Why it is cheap, all verified:** **EPC F** with the register warning *"It cannot be
let, unless an exemption has been registered"*; **no central heating**, single glazing,
uninsulated solid walls; **tenants in situ, no viewings, one exterior photo**; and
**Land Registry has NO record of number 12 selling since 1995** while 23 other
transactions exist in the postcode. That is the signature of a possible **regulated
tenancy under the Rent Act 1977 = you may NEVER get vacant possession.**

Only one of the seven with paper headroom (+£17,000) **and only at a £25,000 refurb,
which its own EPC contradicts** (£45-60k job; the EPC alone prices internal wall
insulation at £7,500-£11,000). At £45,000 refurb the headroom goes negative.

### 🟢 THE ONE GENUINELY VALUABLE FINDING: auction results are a COMPS source

193 arms-length, competitively bid, dated, postcoded sales **with the exact house
number**, which Rightmove withholds on 96.6% of adverts. Cleaner than any AVM, and free.

**Hugo's real bottleneck is valuation coverage, not supply** (DECISIONS_LOG row 107:
91 of 65,523 pass the priced gate, 0.14%, top refusals all "cannot price this").
**Ingesting auction achieved prices to improve the valuation engine is worth more than
bidding at auction is, and it risks no deposit.** This is the recommended next action.

### Nobody publishes the number that decides a BRRR

A search of PropertyTribes, Property Hub, Reddit and the wider UK property web for a
Liverpool BRRR with a **surveyor-confirmed post-refurb valuation** in L4-L9, L20 or
CH41 returned **not one case**. Every published Liverpool BRRR number is sourcer
marketing quoting gross yield and "GDV" (uncheckable) while omitting the refinance
valuation (the only figure that matters).

- RICS valuer: *"a very recent transaction of the property at a lower price in recent
  months will inevitably raise questions... I have just refurbished a house myself and
  I am fairly confident that the £10k+ spend has not been added to the value."* Some
  lenders instruct on a 90-day marketing basis, which depresses it further.
- Liverpool developer of 10 years, Feb 2026: *"Sourcers don't even seem to have clients
  to sell to, they're posting deals on facebook."*
- Asked about L4/L20 BRRR sourcing May 2026, two replies, both negative, one:
  *"you will most likely lose all of your money."*
- ⚠️ The sourcer **totalpropertygroup.co.uk is marketing Pendennis Street, Kensington
  L6** as a case study. **Pendennis Street is one of the four named mistakes in
  `docs/THE_STRATEGY.md`.** They also quote an identical £12,758 refurb on two different
  Anfield houses (a template, not a build cost) and quote no refinance valuation at all.

Hugo asked directly whether the GDVs are real and whether the stock exists. Answer:
**no, and no, for the cheap-terrace version of the plan.**

### The decisive evidence: 1,129 same-address repeat sales

Every Land Registry sale in L4, L5, L6, L7, L8, L9, L13, L20 from 2019 to 2026
(22,566 transactions), filtered to the same address selling twice 6-36 months apart.
Size, street and house held constant by construction.

| What they paid | n | Median resale | Over £120k | Over £155k |
|---|---|---|---|---|
| Under £60,000 | 276 | **£75,000** | 7.2% | **1.8%** |
| £60,000-£80,000 | 283 | £100,000 | 28% | 10% |
| £80,000-£100,000 | 254 | £119,500 | 47% | 17% |
| £100,000-£130,000 | 163 | £135,000 | 75% | 21% |
| £130,000+ | 153 | £180,000 | 97% | 79% |

**The relationship runs the wrong way.** The only band that reliably clears £155,000
starts at £130,000. **There is no band that starts cheap and finishes high.**

### Why: the condition premium is £18,000-£23,000, not £50,000+

Net of market drift (Liverpool terraces have run +7.31%/yr, so much apparent profit is
just the tide): **+£17,891 across all cheap buys, +£22,717 on repossession entries.**
**A £20,000 refurb buys about £20,000 of value. The works roughly break even.**

### The mechanism: you cannot buy small and sell big

Purchase price and finished value are both a function of the same square metres.
Liverpool 2-bed terrace = 55-70 sqm, 3-bed = 76-96 sqm.

- 65 sqm 2-bed at £155,000 needs **£2,385/sqm**. Above the top quartile of every cheap
  sector. That is Mossley Hill and Crosby money. Impossible.
- 85 sqm 3-bed at £155,000 needs £1,824/sqm. Reachable in L13 1, L13 3, L7 6, L8 0, L11 7.
- **£120,000 finished requires a 3-bed. 3-beds do not come at £65,000.** The cheapest
  3-bed terrace at auction in the whole city is £85,000.

### The formula against the actual September catalogue

| Lot | Guide | GDV (own street) | Max bid | Likely hammer | Gap |
|---|---|---|---|---|---|
| 132 Grosvenor Rd, Wavertree L15 | £70,000 | £118,000 | £49,000 | £86,100 | **-£37,100** |
| 5 Stonehill St, L4 | £70,000 | £86,000 | £35,500 | £86,100 | -£50,600 |
| 32 Green Lane, Seaforth L21 | £70,000 | £94,000 | £28,500 | £86,100 | -£57,600 |
| 86 Herrick St, L13 | £75,000 | £95,000 | £29,000 | £92,250 | -£63,250 |
| 16 Derby Rd, Birkenhead CH42 | £75,000 | £92,000 | £27,000 | £92,250 | -£65,250 |
| 54 Romley St, L4 | £80,000 | £80,000 | £29,000 | £98,400 | -£69,400 |

**Every one fails at the guide, before anyone bids against you.**

### Guide prices are bait: 123 matched pairs

Sutton Kersh guides reconstructed from Wayback snapshots of the live catalogue 4-6
weeks pre-sale, corrected for the 12 lots revised by addendum, joined to published
results. Auction House NW prints guide and result on the same row.

| Source | Lots | Median | Mean | 20%+ over |
|---|---|---|---|---|
| Sutton Kersh | 79 | **+22.5%** | +31.3% | 63% |
| Auction House North West | 44 | +15.5% | +23.6% | 43% |
| **Combined** | **123** | **+21.4%** | **+28.6%** | 56% |

**Exactly one lot in 123 sold at or below guide.** Extremes: 71 Holmes St L8 guided
£45,000 made £94,000 (+109%); 10 Stockbridge St L5 guided £35,000 made £70,000
(+100%); 166 Long Lane L9 guided £70,000 made £130,000 (+86%).

⚠️ Two honest caveats. Part of the premium is **structural, not competitive**: the
guide convention puts the reserve within 10% above guide, so a lot cannot sell much
below guide by design. And Sutton Kersh only publish a hammer figure for lots sold in
the room (417 of 796), not the 379 sold prior or after, which go nearer guide, so the
true all-sales average is lower than +22.5%. **Auction House NW's +15.5% is probably
the more honest number** because they do publish prior and after sales.

**The datapoint that settles it: 39 Andrew Street L4 guided £70,000 and hammered at
£82,000. L4 two-bed terraces sell for £81,000-£86,500 fully done.** The winner paid
finished value for an unrefurbished house.

### Supply: zero houses under £70,000 in the whole catalogue

Sutton Kersh 10 Sept, 102 lots, 58 Merseyside residential. **Every sub-£70k Merseyside
lot is a flat, studio or student pod**, concentrated in L1/L3 city-centre blocks, which
the strategy excludes. Across all Liverpool auction stock on Rightmove: 211 lots under
£100k but only **32 terraced houses**, floor £65,000, and the twelve cheapest are all
2-beds. **23 of 58** Merseyside residential lots are **tenanted**, including three of
the four cheapest houses (one with an 11-year tenant at £5,400/yr).

### The exit: half the finished houses would have no mortgage at all

BTL minimum property value is **£75,000**. Share of terraced sales below it over 24
months: **CH41 22.9%, L5 17.5%, L20 15.5%, L4 13.4%.** Combined with the repeat-sales
table (buy under £60k, median resale £75k), roughly half of finished houses land at or
below the lender floor. Not a down valuation, **no mortgage at all**.

**Rent is fine and is NOT the constraint.** Liverpool average private rent £905, L4
3-beds ask £945-£1,000, supporting a loan of £110,000-£138,000. The surveyor will only
allow £73,000-£88,000. **The bottleneck is the valuation, never the tenant.**

### The success stories do not repeat: Article 4 killed the mechanism

The paired sales that resold above £155,000 cluster on Kensington L7 2 streets by the
universities: 2 Dell St £65,000 → **£307,000**; 36 Brae St £115,000 → **£335,000** in
15 months; 448 Mill St £62,000 → **£250,000**. **None was a kitchen. They were
house-to-HMO and flat conversions**, valued on rental yield not comparables (464 Mill
St later traded as Apartments 1-3, which proves it).

**Liverpool imposed a city-wide Article 4 direction on 17 June 2021** removing PD
rights for house-to-HMO conversion. L7 2 sales over £200,000: 8 in 2021, then 4, 4, 1,
1, 2. **The numbers that make this strategy look good were a planning arbitrage that
no longer exists.**

### Honest deal on real Liverpool numbers

Buy £65,000 + SDLT £3,250 + fees £4,000 + refurb £20,000 + holding £4-8,000 =
**£96,250-£100,250 in**. Realistic finished value (median of 44 real cases)
**£98,500**. Refinance at 75% = **£73,875**. **About £24,000 stuck per house**, and
the house is only just above the lender floor.

**Required 2.2x. Liverpool delivers 1.15x-1.4x.** No negotiating skill closes that,
because it is a fact about the streets, not about the bidding.

---

## 4b. THE 100% CAPITAL RECYCLING ROUTE (verified 22 Aug 2026)

**Brief:** find deals where CASH OUT >= CASH IN on max £30,000 of Hugo's own money.
**Answer: mathematically possible, in a narrow band. Buy £40,000-£45,000, refurb
£18,000-£20,000, must finish at 2.5x the purchase price.**

### The verified financing stack

**EXIT: Aldermore "Day 1 BTL Remo", June 2026.** I downloaded and read this PDF myself
(https://www.aldermore.co.uk/media/uo4hkuyr/day-one-buy-to-let-remortgage.pdf), because
two research agents disagreed about whether it exists. It does. Verbatim:
> *"Landlords can apply to remortgage their buy to let properties to Aldermore the day
> after purchase, based on market value."*
> *"Standard maximum LTV of **80%** will apply for buy to let cases up to £500k loan
> amount with max LTV of 75% up to £1m."*
> **Case study 1:** *"Your client has used a **SPV** to buy the property at auction for
> £135,000 cash... spent £12,000 on improvements... current market value is now
> £180,000... Aldermore will lend 80% of open market value, ie. £180,000 x 80% =
> £144,000 max loan"*

⚠️ Reconciliation: Aldermore's **Nov 2024 press release said 75%**. The **June 2026
product sheet says 80%.** They raised it. Use 80%, cite the June 2026 doc.

**Also in that document, and worth money:** free valuation, **free standard legals**
(panel solicitor mandatory under 6 months), PGs £250+VAT per director. That cuts
refinance costs from ~£3,624 to **£1,224** and is worth ~£2,400 to the deal.
Requirements: flag *"Less Than 6 Months BTL Remo application"* in the portal, supply the
**TR1**, the bridging agreement or auction docs, and **Land Registry registration must be
confirmed before completion** (expedite via the PURCHASE conveyancer).
**Aldermore minimum property value £50,000, minimum loan £25,000.**

**BRIDGE: nobody lends 100% of the purchase price.** Every published structure is a
DOUBLE CAP: UTB *"lower of 90% net PP or 75% OMV"*; Together *"85% of the purchase
price, no more than 75% of the total value"*; Precise *"the lower of the LTV/LTP"*.
So there is always a deposit gap.

**Who actually writes a £30k-£65k bridge** (most of the market has a £50,000 floor,
and **minimum PROPERTY VALUE is the real gate, not loan size**):
| Lender | Min loan | Min property value | Note |
|---|---|---|---|
| **HFBS** (Holme Finance) | **£5,000** | **"We have no minimum valuation"** | Only lender publishing that. 70% on the £5k-£49,999 band, **inclusive of fees and interest**. England/Wales only, unregulated |
| **Lowry Capital** | £25,001 | not published | Nano £25k-£100k. Lends on *"uninhabitable (e.g. no kitchen or bathroom) or even shell condition"*, auction *"in any condition"*, **70% of OPEN MARKET VALUE** |
| **Affirmative Finance** | £10,000 | not published | *"houses with no bathroom, kitchen or plumbing"*, auction bidding facilities |
| **Together** | £26,000 | not published | 1.07%/mo at/below £100k + exit fee of one month's interest |
| **Somo** | £27,500 | not published | 75% **against OMV** |
| Mercantile Trust | £25,000 | **£75,000** | FAILS on value floor |
| **Market Financial Solutions** | n/a | n/a | 🔴 **IN ADMINISTRATION 25 Feb 2026.** Remove from every list |

### THE MATHEMATICAL ROUTE (buy £45,000, refurb £20,000, finish £112,454)

| | |
|---|---|
| Purchase price | £45,000 |
| Open market value (bought 35% under) | £69,231 |
| SDLT (5% surcharge; £0 under £40,000) | £2,250 |
| Auction fee, both legals, searches, disb, val, broker | £8,795 |
| Refurbishment | £20,000 |
| Bridge: 2% arrangement + 6mo at 1.07% + exit | £3,630 |
| Works fee + works interest | £1,042 |
| Holding, 6 months empty | £1,380 |
| **TOTAL PROJECT COST** | **£82,097** |
| Bridge advanced (lower of 85% price / 75% OMV) | £38,250 |
| **Refinance at 80% of £112,454** | £89,963 |
| less refinance costs (Aldermore free val + legals) | −£1,224 |
| less bridge redemption | −£59,701 |
| **MY CASH IN** | **£29,063** |
| **MY CASH OUT** | **£31,462** |
| **CASH RELEASED** | **+£2,399** |

Total cost = **71% of end value** (the same ratio Zach hit in Swansea).
Rent needed: **£529 pcm**, 5yr fix SPV at 125%/5.5%. Easy.

**THE BUY BOX:**
| Buy | Refurb | Must finish at | Multiple | Cash in | Fits £30k |
|---|---|---|---|---|---|
| £40,000 | £18,000 | £101,818 | 2.55x | £27,038 | YES |
| **£45,000** | **£20,000** | **£112,454** | **2.50x** | **£29,063** | YES |
| £50,000 | £20,000 | £119,593 | 2.39x | £30,421 | no |

**Ceiling is a £45,000-£47,000 purchase.** Above that, cash exceeds £30,000.

### 🔑 THE COUNTER-INTUITIVE RULE: a BIGGER refurb makes recycling HARDER

Every pound of refurb must be recovered through a 75-80% mortgage, so it costs £1.25-
£1.33 of end value to fund £1 of work. Buy £50,000, 30% discount, 6 months, 75% refi:

| Refurb | Must finish at | Multiple | What the WORKS must add |
|---|---|---|---|
| £5,000 | £103,174 | 2.06x | **6.3x the spend** |
| £15,000 | £121,845 | 2.44x | 3.4x the spend |
| £20,000 | £131,181 | 2.62x | 3.0x the spend |
| £30,000 | £149,851 | 3.00x | 2.6x the spend |
| £50,000 | £187,194 | 3.74x | 2.3x the spend |

The two columns pull against each other. **Least-bad zone is a £15,000-£20,000 refurb.**
And the works must add **3x their cost**, which decoration never does (Liverpool
evidence: ~1x). **It has to be SPACE, not finish.**

Sensitivity, base buy £50,000 / refurb £30,000 needing 3.07x:
refurb £30k→£20k saves £18,893 · 80% not 75% saves £9,604 · 6mo not 9mo saves £3,819 ·
rate 0.85% saves £1,969. **All four together still needs 2.44x.**

### ALTERNATIVE ROUTE, better economics but needs more cash

**CHL Light Refurbishment**: *"Property does not need to be lettable at point of initial
mortgage advance."* One product, no bridge, no exit fee, one set of legals. Retention
held between pre- and post-works value, *"released upon confirmation by a Valuer
Reinspection of full completion of works as defined within the agreed schedule"*, up to
120 days. Works must be signable under a **Competent Persons Scheme** (FENSA, CERTASS,
NICEIC, NAPIT) so no building-control sign-off is needed.

| | Cash in | Cash out | Net |
|---|---|---|---|
| Route A, bridge then BTL | £29,063 | £31,462 | **+£2,399** |
| Route B, CHL refurb-to-let | £38,465 | £47,613 | **+£9,148** |

**Route B is £9,149 better but needs £38,465 of cash.** Route A fits £30,000.

### STRESS TESTS on the £45,000 deal (each alone)

| | Leaves in |
|---|---|
| Valuation down 5% | £4,574 |
| Valuation down 10% | £9,146 |
| Refurb up 20% | £5,542 |
| Refurb up 30% | £8,314 |
| Bridge runs 9 months | £2,239 |
| Refinance 75% not 80% | £5,717 |

**There is almost no margin. BID BELOW THE MAXIMUM, not at it** (roughly £38,000-£40,000
on a house finishing at £112,000-£115,000).

### 🔴 THE UNINHABITABLE SDLT ROUTE IS DEAD

**Mudan v HMRC [2025] EWCA Civ 799 (27 June 2025)** named this exact fact pattern on the
LOSING side: *"a building which had all those features but required rewiring and
replumbing and the renewal of a kitchen and bathroom"* is still residential property.
HMRC manual **SDLTM00385 (updated 26 May 2026)**: the bar is *"very high"*, and removed
kitchens/bathrooms are expressly NOT enough. HMRC's working view: **~95% of these claims
are wrong.** On a £45k house the prize is £2,250 and the downside is ~£5,500 plus four
years. The one FTT win since (Oakwood, Aug 2026) needed a £2.25m remediation estimate on
a £2.4m house, four years and six expert reports.

**Two REAL levers replace it:**
- **The £40,000 cliff.** £39,999 = **£0**. £40,000 = **£2,000**. Never uprated since 2016.
- **s.116(7) FA 2003: SIX OR MORE dwellings in one transaction are automatically
  non-residential.** Six at £55k = £330,000 → Table B → **£6,000 instead of £16,500**.
  No claim needed. MDR was abolished 1 June 2024 so this is the only bulk route left.

### The "6-month rule" is NOT a rule

UK Finance Mortgage Lenders' Handbook Part 1, clause **5.1.1**, in full:
> *"Please report to us immediately if the owner or registered proprietor has been
> registered for less than six months."*

That is the entire clause. **A reporting duty on the conveyancer. Not a ban.** Part 1
says NOTHING about valuation basis. "The 6-month rule means you must use purchase price"
is pure lender policy, which is why Aldermore can ignore it.
**Hard NOs inside 6 months: The Mortgage Works, BM Solutions.**
**Every lender allowing market value inside 6 months caps LTV at 75% EXCEPT Aldermore
at 80%. That 5% is the reason the deal works.**

### Non-negotiable paperwork

**A schedule of works and evidence of expenditure.** Paragon require it verbatim;
InterBay require it plus *"confirmation that works have been completed to a suitable
standard"*; West One want *"commentary from the valuer, justifying the increase in
value"*; Foundation accept an auction purchase alone. **Without it you are valued at
purchase price and the deal dies.**

⚠️ **The old "wait 12 months then take an indemnity policy" for missing building regs is
DEAD.** Building Act 1984 s.36(4) was extended from 12 months to **10 years** by the
Building Safety Act 2022 s.39(3) (in force 1 Oct 2023 England, 1 Jul 2026 Wales).

**EPC E is the current legal minimum to let** (SI 2015/962 reg 22). **EPC C is NOT law**:
no Act, no SI, government only *aims* to lay one coming into force 2027 for a 1 Oct 2030
compliance date. A refurbished BTL needs BOTH a Part P certificate (works were lawful)
AND an EICR (safe to let, before the tenancy starts). They do not substitute.

---

## 5. What the evidence says to do instead

1. **Buy 3-beds, never 2-beds.** Floor area is the entire game. Model £85,000-£110,000
   entry, not £65,000.
2. **Chase the UNSOLD lots.** Sutton Kersh sold **796 of 1,112 lots across their last
   14 auctions, a 72% rate, and it is FALLING**: 70-80% through 2024 and early 2025,
   then 59%, 65%, 67%, 69% in the last four sales. So ~3 lots in 10 do not sell, and
   they are marketed post-auction at a fixed price with **no bidding competition**.
   That is the only setting where a hard max bid is a strategy rather than a way of
   never winning, and a falling sale rate makes the pool bigger. Still available from
   July: 12 Millvale St L6, 1 Lincoln St Garston L19 (vacant, needs refurb),
   17 Glencairn Rd L13. (Auction House NW runs 89% including "Sold After".)
3. **Go where the ceiling exists: L13 1 and L13 5 (Tuebrook, Old Swan), then L11 7 and
   L6 3.** L13 1: £1,880/sqm median, £2,030 top quartile, +11.1% growth, and **only 3.1%
   of terraces below the lender floor**, the lowest of any cheap district.
4. **AVOID OUTRIGHT: L5, L20 4, L4 5, CH42 5, CH41 4, L21 8.** No ceiling, poor
   liquidity. L5 5 recorded **17 sales in two years**, which is not a market.
5. **Accept leaving £20,000-£25,000 in per deal, or change the strategy.** If the model
   requires all the money out, the model does not describe Liverpool.

### Two input corrections

- **£20,000 refurb is the floor, not the budget.** 2026 Liverpool trade guides put a
  full refurb with rewire, replaster, kitchen and bathroom at **£30,000-£50,000**. A
  Victorian terrace bought unseen is exactly where structural work appears.
- **Liverpool selective licensing is going city-wide** when the current scheme ends in
  March, with twelve proposed fee bands **up to £995 per property**.

---

## 6. Supply and data access (national)

- **114 auction sessions** in 30 days from 22 Aug 2026 (62 online/timed, 36 livestream,
  only **16 in a physical room**), ~3,500 lots. EIG national flow: 4,424 offered / 2,864
  sold in July 2026. 2025: 41,628 offered, ~29,000 sold, £5.87bn.
- Sub-£100k share is northern: North East 89.8%, Yorkshire 77.7%, East Midlands 73.1%,
  North West 64.7%, London 20%. Residential-only cut: **46.6%**.
- **Buyer fees vary 8.9x on the same £90k house:** Pattinson £780, Clive Emson £1,250,
  Barnard Marcus £1,800 flat, Allsop £2,000 flat, Savills £2,100, BTG Eddisons/Pugh
  £2,400, Bond Wolfe £2,700, Auction House £3,275, **iam-sold £6,949** (4.5-4.8% but a
  £6,600 minimum bites, plus £349 pack fee, paid IN ADDITION to the price so it buys no
  equity, and SDLT is charged on it anyway). SDL/Pugh/Network/Mark Jenkinson are all
  **BTG Eddisons** now; old £6,000 SDL figures are stale.
- **Data is cheap and mostly free.** Allsop runs a public JSON API with no key and no
  login (~2,699 lots, and individual **legal pack PDFs download unauthenticated**).
  Auction House exposes a POST price/type filter and an `/unsold` list. Bamboo Proptech
  `_next/data` JSON gives 4,860 lots with postcode, guide, lat/lng, agent email.
  Rightmove: `mustHave=auction` (caps 1,000 results, 40 miles). Sutton Kersh:
  `?section=auction&auctionPeriod=current&perPage=all` returns the whole catalogue.
- ⚠️ **Auction Passport (EIG, ~350 auctioneers, free account) terms forbid exactly the
  use we would want**: no selling on, no subscription use, no republication, *"illegal
  to pass The Information to any third parties."* Hugo's call, not an engineering one.

---

## 7. What the repo already has

~55-60% of an auction pipeline exists. `api/lib/brrr-offer.ts` already contains
`ladderText(deal, band, isAuction)` returning *"AUCTION, your absolute maximum is £X,
never go beyond it"*, with a passing test *"an auction has a maximum, not a ladder"*.
`deal.is_auction` is resolved in `usePropertyListings.ts`, `OfferStrip.tsx` renders an
AUCTION badge, and `brrr_properties.price_qualifier` already says "Guide Price".

The comps engine works on auction lots unchanged: `scripts/vps/fast_comps.py` pulls
Land Registry sold prices in 200/500/800m rings, matches on bedrooms, penalises comps
outside 0.7-1.4x the subject's floor area, and needs 3+ same-bed and 3+ target-bed comps
to count as usable. England and Wales wide, so Liverpool is covered.

**TWO THINGS MUST BE DELETED, NOT TUNED, if this ever runs:**
1. The offer caps *"never above 85% of asking"* and *"never above the asking price
   itself"*. A guide price is not an asking price (pitched ~10% under value, reserve
   within 10%, lots hammer 15-25% above guide). Anchoring a max bid to guide loses
   every lot.
2. `docs/VALUATION_ENGINE.md` §0.6 filters comps below 0.70x cluster median as
   *"suspected distress/auction sale"*, which would delete our own purchases from the
   evidence set.

**Missing entirely (0%):** auction lot sourcing, legal pack ingestion, guide-to-max-bid,
a deadline-driven queue (everything in the repo is cadence-based, not countdown-based),
bidder registration / deposit / completion.

**The ceiling that auctions do not fix:** DECISIONS_LOG row 107, of 65,523 listings
scraped **91 pass the priced gate, 0.14%**, and the top refusals are all "cannot price
this". Auction or estate agent, that number is the business.

---

## 8. AI: what it carries and what it does not

- **Refurb from photos:** within **5%** of a quantity surveyor on a full 11-photo
  gallery, **45% UNDER** on a single photo. Auction photos are seller-curated. Make
  photo count a hard gate that refuses to produce a number.
- **Legal packs are already commoditised.** Auction House partnered with **Docuwise,
  £75+VAT per pack**, under 5 minutes, versus £300-500 and 48-72h for a solicitor.
- **Legal LLM research:** 58-88% hallucination on specific legal queries, plus output
  instability (same pack, two verdicts). Cannot base an automated bid rule on it.
- **Do NOT let an agent price refurbs from web search.** The 2026 UK cost-guide corpus
  is largely AI-generated; two pages presented as real case studies contained none.
- **Diligence economics:** survey 10 lots, win 2, spend £9-20k on houses you do not own.
  **AI's real job is picking which 3 of 200 lots deserve the £1,500 survey**, not
  replacing it. Negative screening is defensible; a positive buy signal is not.
- Never bid without written lender terms. **Average bridging completion is 53 days
  against a 20 working day deadline.** Joseph has agreed to provide terms pre-auction.

---

## 9. Open decisions for Hugo

1. **Does he accept £20-25k stuck per deal, or does he change strategy?** The full-recycle
   version does not exist in cheap Liverpool terraces.
2. **3-beds at £85-110k instead of 2-beds at £65-70k?** That is where the ceiling is.
3. **Unsold-lot negotiation instead of bidding?** The only setting where a max bid works.
4. **A different city?** The stress test was Liverpool only. The same test needs running
   anywhere else before committing.
5. The five questions to Joseph (§2) remain unanswered.
6. One paid hour with a financial services solicitor before any partner's money lands.
