# The auction deal method

How a UK auction lot goes from a catalogue entry to a bid you are allowed to make.
Written 2026-08-23. Every rule below exists because something in this repo or this
session got it wrong first.

> **Scope.** This is Hugo's own auction sourcing, funded by a JV partner. It is NOT
> the BRRR property pipeline Pedro calls estate agents about. That lives in
> `/Users/hugo/Whats/scraper/BRRR_STRATEGY.md` and is a different business with
> different rules. Do not merge them.

---

## 0. The one sentence

**Find a house whose finished value, proved by same-street same-size sales, is far
enough above the hammer price that a bridge and a refinance return every pound the
partner put in, and pay Hugo a fee on top.**

Everything else is the arithmetic of that sentence.

---

## 1. The money model

One shared model, used identically for screening and for the final calculator.

| Term | Value | Note |
|---|---|---|
| Bridge gross LTV | **75%** of purchase | ⚠️ **corrected 2026-08-23.** Was 85%. Market is 70&ndash;75% of open market value |
| Arrangement fee | 2% | capitalised |
| Interest | 1.07% a month | rolled up, not retained |
| Exit fee | 1.07% | |
| Term to refinance | **7 months** | ⚠️ **corrected.** Was 5. The six-month rule usually forces it |
| Refinance | **75%** of finished value | ⚠️ **corrected.** 75% is the market ceiling, not 80%. Also capped by the rent |
| Refinance costs | £300 | free valuation and free legals on the products used |
| Fixed costs | £5,595 | own solicitor, searches, lender's solicitor, bridge valuation, broker, insurance |
| Auction fee | 1.75%, min £2,500, plus VAT | so £3,000 on anything under about £143,000 |
| Deposit | greater of 10% or £10,000 | **this is why Hugo's £30,000 goes further than it looks** |
| JV and company paperwork | £2,500 | SPV, JV deed, lender consent |
| Holding while empty | £230 a month | council tax, insurance, standing charges |
| Running costs once let | **£135 a month** | ⚠️ **corrected.** Was £45. Maintenance ~£100 plus insurance £30&ndash;40 |
| Letting management | **12%** | ⚠️ **corrected.** Was 10%. It is 10% **plus VAT** |
| Stamp duty | 5% additional-property rate, nil under £40,000 | the £40,000 cliff makes £40,000 itself a dead bid |

### The closed form

```
P_max = [ LTV·V − 300 − R·(1.02 + r·m/2) − FIXED − AF − JVL − HOLD·m − fee ]
        ─────────────────────────────────────────────────────────────────────
                        1 + s + L·(A + r·m + EXIT)
```

**The denominator contains no `m` for months retained and no term for whether the
arrangement fee is deducted or capitalised.** Retained versus rolled-up interest, and
deducted versus capitalised fee, have **zero effect on the maximum bid**. They change
only the day-one cash. Do not let a broker's presentation of those two things change
what you are willing to bid.

### 85% gross is not 85%

Once the 2% fee and six months of interest come off the top, the net advance is
**77.84%**. The real deposit is 22.16%, not 15%. Never quote the gross number to Hugo
as if it were cash arriving.

---

## 1b. Four corrections from `brrr uk/`, found 2026-08-23

Hugo built a 210-video, 640,000-word research folder at
`/Users/hugo/Whats/scraper/brrr uk/`. Checking this method against it found **four errors, every
one of them optimistic**. Read `00_UK_FACTS.md`, `06_ALL_MONEY_OUT.md` and `07_BRIDGING_LOANS.md`
there before trusting any number here.

| I had | The market | Why it matters |
|---|---|---|
| 85% bridge on purchase | **70&ndash;75% of open market value** | more cash needed on day one |
| 80% refinance | **75% ceiling**, and the rent can cap it lower | several "deals" only worked at 80% |
| 5 months to refinance | **the six-month rule**: most lenders use the **purchase price**, not the new value, for six months. Only ~15 day-one lenders, and they want a schedule of works, contractor invoices, before-and-after photographs and comparables | two extra months of bridge, and the exit may not exist at all |
| £45/month running costs | **~£135**, plus management at 10% **+ VAT** | quietly overstated every yield |

**The 1.33x rule.** All money out needs `finished value ÷ everything you spend ≥ 1.33`. Below that
it is arithmetically impossible, whatever the spreadsheet says. Use it as the first gate.

**Stop promising all money out.** The honest operators, including the Fontaine material, treat
leaving **£5,000 to £15,000 in** as a normal good result. Their own flagship case study left
£13,250 in on an £85,000 purchase and they call it *"not an all money out deal, but a very good
deal."* Gate on **return**, not on money left in.

**Unsold lots are the way to buy below the hammer.** A lot that failed in public has a motivated
seller and no competition, and the auctioneer must pass your offer on. Auction House publishes them
at `auctionhouse.co.uk/unsold` (the guide is in the `twitter:data1` meta tag, HTML-encoded).
Checked 2026-08-23: 58 lots, almost all flats, commercial and land, **no freehold houses worth
pricing**. Worth re-checking after every sale cycle, roughly every 6 to 8 weeks.

---

## 2. Where the value comes from, and the three ways it goes wrong

**The rule: the subject's own street, same property type, HM Land Registry Price Paid,
Category A only, size-matched by EPC floor area.**

### 2a. Category B is not a sale

Category B covers repossessions, portfolio transfers and other non-market
transactions. They print in Price Paid looking exactly like real sales. Filter
`cat='A'` always. On Pembrook Road, number 23 sold at £148,000 as Category B and would
have dragged the median down by thousands.

### 2b. Outcode comps are a lie, street comps are the truth

Auction stock sits on the bad roads inside a good outcode. In L4, Ivernia Road reaches
£175,000 while Stonehill Street tops out at £105,000. Same postcode district.
**Never price a lot off outcode or sector deciles.** If the street has fewer than three
Category A sales since 2023, that is not a reason to widen the net, it is a reason to
drop the lot.

### 2c. Size mismatch is the single biggest killer

**This is the step that decides everything, and it is the one everybody skips.**

The EPC register gives the floor area of the subject *and* of most comparables, free.
Pull both. Keep only comps within **±20%** of the subject's floor area.

Measured on the six lots screened on 2026-08-23:

| Lot | GDV before size matching | After | Change |
|---|---|---|---|
| 125 Thompson Avenue | £227,500 | £190,000 | **−16%** |
| 6 Church Road, Hayling Island | £382,500 | **no matched comp** | **dropped** |
| 171 Cheriton High Street | £254,875 | **no matched comp** | **dropped** |
| 32 Pembrook Road | £179,625 | £168,000 | −6% |
| 6A Eastfield Drive | £191,250 | £177,500 | −7% |
| 42 Ingleborough Road | £214,438 | £207,500 | −3% |

Two of six lots died at this step. Hayling Island looked like the best deal in the
country at 1.28x until its only real comparable turned out to be a 118 sqm house
against a 91 sqm subject.

**A lot with no size-matched comparable is dropped, never estimated.**

---

## 3. Guide prices are fiction, and the fiction is auctioneer-specific

A guide price is a marketing number. Measured against real results:

| Auctioneer | Hammer ÷ guide, median |
|---|---|
| Auction House | 1.15x |
| Savills | 1.47x |
| Allsop | 1.94x |
| **Under The Hammer** | **2.75x** |
| Bond Wolfe | 3.43x |

**Never model a bid off the guide.** A £29,000 Under The Hammer guide is a £79,750
house. Pricing off guides once produced a shortlist where a £30,000 bid would have won
**zero of 231 lots**.

---

## 4. Refurbishment: read the EPC first, then the photographs

### 4a. The EPC register does half the survey for free

`find-energy-certificate.service.gov.uk` publishes, per property: total floor area,
main heating, hot water, window type, wall and roof construction. Two fields carry most
of the cost risk.

**Main heating**
- `Boiler and radiators, mains gas` → it has central heating. Baseline rate.
- `Room heaters, mains gas` → gas fires only, **no central heating**, add £75/sqm
- `Electric storage heaters` / `No system present` → same, add £75/sqm

**Window**
- `Fully double glazed` → no window budget needed
- `Single glazed` / `Partial double glazing` → add £40/sqm

This turned a blind £400/sqm guess into a rate per lot, and it is checkable in seconds.

**Pembrook Road's EPC said `Room heaters, mains gas` and `Fully double glazed`.** The
photographs independently showed gas fires, electric panel heaters and no radiator in
any room, and the rear elevation showed uPVC windows. **The register and the pictures
agreed.** That is the confirmation you want before trusting either.

### 4b. Then the photographs, and they always find more

Screening rate from the EPC gave Pembrook £19,124. Reading all twenty photographs gave
**£26,345**. The photographs found things no dataset carries:

- mock Tudor battens over every wall in two rooms
- a 1970s stone-clad fireplace with a copper hood, heavy, needs a skip
- artex ceilings throughout
- cracking beside and beneath the front bay window
- damp staining at the base of the kitchen wall and around a bedroom window
- a house still full of furniture, wardrobes, carpets and curtains

**So: screen with the EPC rate × 1.30, then photo-verify before bidding.** The 1.30 is
one observation, not a law. Update it as more lots get photo-verified.

### 4c. What the photographs are actually for

Work through them looking for these, in this order:

1. **Radiators.** Their absence is £4,200. Confirm against the EPC.
2. **Surface-mounted conduit** running down walls. That is pre-1970s wiring, £3,200.
3. **Wall coverings that must come off**, battens, cladding, stone fireplaces. Each is
   labour plus a skip plus replastering behind.
4. **Cracks, and specifically where.** Above a bay window means the lintel, and that is
   the difference between £400 and £9,000. Cracks are the reason to book a survey, not
   the reason to walk.
5. **Staining at the base of walls and around windows.** Unflued gas fires produce a lot
   of moisture, so it is often condensation rather than a failed damp course, but budget
   for one wall either way.
6. **What can be KEPT.** This is worth as much as what must be replaced. Pembrook's
   kitchen units and bathroom suite were both sound: **£7,000 saved**, and that £7,000
   is fee.
7. **The roof and the rear elevation.** Ridge line straight, no sag, brickwork sound.
8. **The street.** Parked cars, maintained neighbours, and what is next door. A denture
   laboratory next door on a double-yellow main road is a fact no spreadsheet holds.

---

## 5. The JV structure

Hugo brings the deal and does the work. The partner brings 100% of the cash.

### 5a. Why buying and reselling does not work

Reselling the house to an investor at a mark-up **cannot work**, and the reason is
arithmetic, not negotiation. Buying and selling the same house inside three months
costs about **£18,730** in stamp duty, auction fee, two sets of solicitors, bridge fees
and agent fee. On the Pembrook numbers the buyer's ceiling was £97,503 and Hugo's
break-even was £98,480. **The overlap is empty.** There is no price that works for both.

Every £1 of mark-up costs the buyer **£1.10**, because he pays stamp duty on the
mark-up and borrows against it too.

### 5b. Why the JV does work

The house is bought **once**. No second stamp duty, no second bridge, no second
solicitor. The £18,730 of friction disappears, and that is the entire difference.

### 5c. The fee has a hard ceiling

```
max fee = released at refinance − cash the deal needs
```

The pot is fixed. Whatever the deal does not need, Hugo takes. There is nothing clever
to do about it. Charging below the ceiling is giving money away; charging above it
breaks the all-money-out promise, which is the only thing that makes a partner say yes.

### 5d. The timeline, which is what Hugo always asks

| When | What | Hugo |
|---|---|---|
| Auction day | 10% or £10,000 deposit, plus auction fee | **pays ~£13,000** |
| +28 days, completion | partner funds everything, bridge pays the seller | **repaid in full, plus fee** |
| Months 1 to 4 | refurbishment drawn from the bridge in stages | nothing |
| Month 5 | refinance redeems the bridge, partner repaid | nothing |

**Hugo's money is out before the builder starts.** With the deposit capped at £10,000
he can hold **two lots at once on £30,000**, which is what makes it a monthly business
rather than an annual one.

### 5e. Responsibilities, and why they are load-bearing

The partner must have **genuine joint control**: co-director, two signatures on the
account, both sign off the budget, both decide the exit.

This is not tidiness. **A passive money partner can turn the arrangement into a
collective investment scheme under s.235 FSMA, and operating or promoting an
unauthorised one is a criminal offence.** Section 21 on financial promotions applies to
the invitation itself.

> ⚠️ **UNFINISHED.** The legal research on FSMA s.21 and s.235, on assignment of auction
> contracts, on sub-sale, and on what deal sourcing requires under the Estate Agents Act
> 1979 and HMRC anti-money-laundering registration, **died partway on a session usage
> limit on 2026-08-23 and was never completed.** Nothing in section 5e is verified.
> Finish it before any money moves.

---

## 6. Income: two ways, and the mortgage decides

| | Normal let | Airbnb monthly |
|---|---|---|
| Gross | market rent | ~2x market rent |
| Bills | tenant pays | **landlord pays, ~£300/mo** |
| Voids and management | 10% | 15% |
| Mortgage rate | ~5.79% | **~6.75%, specialist product** |
| Furnishing | none | **£7,000 to £7,700, and it goes in the bridge** |

**The furnishing cost comes straight out of Hugo's fee**, because it sits inside the
bridge balance and reduces what the refinance releases. On Pembrook it turned a £1,683
fee into minus £6,375 at 75%, and only worked at 80%.

**Three traps:**
1. A standard buy-to-let mortgage **forbids short lets**, and most forbid serviced
   accommodation outright. Ask the broker before bidding.
2. Council tax stays payable between guests, and it is the landlord's bill.
3. A monthly let to somebody using the house as their only home **is a tenancy in law**
   however it was booked, so the Renters' Rights Act applies.

### Yields to quote, always

- **Gross yield on cost** = annual rent ÷ all-in cost
- **Gross yield on value** = annual rent ÷ finished value
- **Net yield** = after voids, management, insurance, maintenance, before mortgage
- **Return on equity** = annual net cashflow ÷ equity retained

Do not quote a monthly cashflow without the yields beside it.

### The rental stress test

Company SPV, typically **125% cover at 5.5%**. Personal higher-rate, **145% at 5.5%**.

```
rent needed = loan × 0.055 ÷ 12 × cover
max loan the rent supports = rent × 12 ÷ (cover × 0.055)
```

On Pembrook at £950 the test passes with £198 a month spare, so rental cover never caps
the loan. Check it anyway on every lot, because on a low-rent northern terrace it will
sometimes bind before the LTV does.

---

## 7. The screening pipeline as built

Scripts live in `exports/ppd/` (run with `./venv/bin/python`, **not** system python3,
duckdb is only in the venv) and in the session scratchpad.

| Step | Script | What it does |
|---|---|---|
| 1 | fetch the auctioneer catalogue | JSON is inside `self.__next_f.push` chunks on Under The Hammer, unicode-escaped |
| 2 | filter | upcoming, **Vacant**, **Freehold**, house not flat, has a postcode |
| 3 | `epcfetch.py` | floor area for the subject, from the EPC register by postcode |
| 4 | `epcdetail.py` | heating, windows, walls → refurbishment rate per sqm |
| 5 | `score.py` / `score2.py` | street comps from `ppd.duckdb`, Category A, freehold, since 2023 |
| 6 | `sizematch.py` | **EPC area of every comp, keep ±20%.** The step that kills most lots |
| 7 | photographs | verify, then bid |

**Traps, all hit for real:**
- DuckDB column is `cat`, not `category`
- Land Registry street names are uppercase with the house number stripped
- The EPC certificate page is a `<th class="govuk-table__cell">` / `<td>` pair, not a `<dl>`
- `epc.opendatacommunities.org` 301s without auth. The public
  `find-energy-certificate.service.gov.uk` search works with a browser User-Agent
- Savills and Bond Wolfe catalogues are JS-rendered with no reachable JSON endpoint

### The funnel, measured 2026-08-23

| Stage | Count |
|---|---|
| Under The Hammer lots, all statuses | 319 |
| Upcoming | 180 |
| Vacant freehold houses, September onward | 61 |
| Floor area found on the EPC register | 54 |
| Three or more Category A street comps | 32 |
| Pass the max-bid test at 80% refinance | **5** |
| Survive size-matching with 3+ matched comps | **2** |

**Roughly one lot in sixty is worth a survey.** That ratio is the job. Anybody
promising more is skipping section 2c.

---

## 8. Standing rules

1. **Never bid the ceiling.** Stop at least £2,000 below the maximum. The survey always
   finds something.
2. **Never bid on a maybe partner.** The contract binds on the fall of the hammer. No
   completion in 28 days means the deposit is forfeit, the auction fee is gone, and the
   seller can resell and sue for the shortfall.
3. **Decide the ownership structure before bidding.** Buying personally and moving it
   into a company later pays stamp duty **twice**, at market value.
4. **Walking away is a real answer and it is free.**
5. **Report the funnel honestly.** If four of five candidates rest on a single
   comparable, say so. A padded shortlist is worse than a short one.
6. **No long dashes**, anywhere, including here.
