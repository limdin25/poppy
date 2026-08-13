> # ⚠️ SUPERSEDED 2026-08-13 — DO NOT BUILD FROM THIS
>
> This doc says stop fighting on price and create the value instead. It was
> built, run, and measured on 2026-08-12: **an extra bedroom is worth about 1%**
> at the same square footage on the same street. We went back to fighting on
> price, because the discount is the only lever that closes the refinance gap.
>
> **Current strategy: `/Users/hugo/Whats/scraper/BRRR_STRATEGY.md`.**

# The add-value pivot — stop fighting on price, qualify on the refinance

**Decided by Hugo 2026-08-11, day two of Pedro's real calls.** This doc is the
record of what we are changing, why, and what is still to build. Read it before
touching Pedro's queue, his script, or the offer maths.

---

## Why we are changing

Pedro made 165 calls on 10-11 Aug. The script is not the problem. From reading
the live transcripts of 45 real conversations:

- **78% reached the money question.** He says the "am I in the ballpark or a
  million miles off" line, close to word for word. Delivery is fine.
- **The answers came back "a million miles off"** on nearly every one. Real
  examples: offered £93,500, agent said "a considerable way from the asking
  price"; offered ~£56,000, "she needs as much as she can"; one had already
  gone **above** asking.
- So the offers themselves were too low for the stock, not badly delivered.

Two secondary leaks found in the same transcripts, both still open:

1. **He answers "what is your budget?"** Agents flip the call and qualify him.
   He gave a ceiling number away unprompted. There is no line in the script for
   this and there needs to be. It is the number the whole negotiation is built
   on protecting.
2. **"You must view it before we take an offer"** is the most common blocker he
   hits, and the script has no answer for it, so the call dies there.
3. Two of the four longest calls (14 min, 10 min) ended with Pedro spelling out
   his name, email and the company address, and being added to a mailing list
   as a low-budget cash buyer. No offer made, nothing learned. He also described
   himself as "we purchase for cash and then we rent it", which reads as
   buy-to-let landlord, not a specific negotiation.

## The new strategy

**Stop making the discount carry the deal. Make the extra bedroom carry it.**

Convert the lounge into an open-plan kitchen-living space, convert the existing
separate kitchen into a third bedroom. Offer at or near asking (Hugo: try 10%
off, then 5%, and if the deal still works at asking price then it is still a
deal). The margin comes from the value created, not extracted.

**Hugo's bar for a deal:** after the works, refinancing must return all or
almost all of the money that went in. Leaving ~10% in is acceptable. Breaking
even is acceptable.

### The test

```
money in  = purchase + stamp duty (incl. additional-property surcharge)
          + legals/survey + full refurb + ~6 months holding
money out = 0.75 x after-works value      (75% LTV refinance)
left in   = money in - money out
PASS if left in <= 10% of money in
```

### The honest risk, stated up front

This bar is **harder** to clear than the old one, not easier. Worked example on
a £150,000 house at 10% off: ~£135,000 purchase, ~£11,000 buying costs,
~£25,000 refurb = £171,000 in. To pull that back out at 75% LTV it must revalue
at **£228,000**, roughly +50%. Adding a bedroom typically adds 10-20%.

So we should expect **fewer qualifying properties, not more.** Hugo's
expectation was "a lot more acceptance". Acceptance on the *call* will rise.
Volume will fall, probably sharply. The deals that survive will cluster in
postcodes where the 2-bed to 3-bed gap is unusually wide.

**And acceptance is not the win.** The money arrives when an investor buys the
deal and it completes. Offering near asking on houses that do not stack would
move the failure from the call (visible, immediate) to the investor stage
(quiet, slow). The money-out test is what prevents that, so it must be enforced
rather than treated as guidance.

## The thing that will most likely be got wrong

**The after-works value must be computed per property from local same-bedroom
sold comps.** It cannot be a general uplift percentage.

Proof, from our own `rm_comps` (all comps, avg sold price by bedroom count):

| Beds | Comps | Avg |
|---|---|---|
| 1 | 1,111 | £107,625 |
| 2 | 5,551 | £120,664 |
| 3 | 8,100 | £109,331 |
| 4 | 3,836 | £106,540 |

A 3-bed averaging **less** than a 2-bed is not a market signal, it is proof the
comps pool spans many towns. Any uplift rule derived from pooled averages is
worthless. Same street or same postcode sector, then widen, and if there are
fewer than 3 usable same-bedroom sold comps nearby the property must FAIL as
"cannot value".

## Data we already have and were not using

`rm_floorplan_ai` on the margarita VPS has scored **2,702** properties:

- **2,069** flagged `can_add_bedroom`
- 160 vetoed
- Each with a written `conversion_idea` (mostly "move the kitchen into the
  lounge, convert the old kitchen to a bedroom")
- `uplift_score` 0-10: 204 score 7+, ~1,500 score 4+

None of this currently affects which properties reach Pedro or what he says.
**That is the gap this pivot closes.**

Note: `uplift_score` is a floorplan opinion only. It never checked whether the
numbers work. It is a reason to call, never a number to promise anyone.

## Automatic fails

- Kitchen already open-plan (no separate room to convert, no bedroom to gain)
- Proposed bedroom would have no window or natural light
- Auctions (Hugo, 2026-08-10: "I don't wanna send the auction ones")
- Fewer than 3 usable same-bedroom sold comps nearby
- Retirement / age-restricted (see below), short-lease flats
- Works that plainly need planning rather than permitted development, unless
  flagged clearly as a risk

**Retirement properties were considered and rejected 2026-08-11.** The course
never covers them; the one mention is the Property Engine tool *excluding* them
automatically. They cannot be converted or let, carry heavy service charges and
event/exit fees, and have a small resale pool. No value can be added, so there
is nothing for this strategy to work with.

## Build order (status 2026-08-11)

1. **[IN PROGRESS] Run the qualifier over the 2,069.** Deterministic maths
   against existing comps. Output: how many PASS, and which postcodes they
   cluster in. This is the go/no-go number for the whole pivot.
2. **[PENDING] Rebuild Pedro's queue** from the passes only, ordered by margin.
   Existing pipeline: `send_to_elsie.py --apply` on the VPS, then
   `scripts/assign-properties-to-pedro-houses.mjs --apply` in Poppy to group by
   branch. Note this is **not automatic**, comps finishing does not move the
   queue.
3. **[PENDING] Rewrite Pedro's script for the new pitch.** He is no longer
   arguing a discount down, he is offering near asking on a house he can
   improve. Must also add the two missing lines found in the transcripts:
   an answer to "what is your budget" (never give the ceiling) and an answer to
   "you must view before offering". Coach objections need the same update.
4. **[PENDING] Re-call the already-called properties** that now pass. Coming
   back with a *higher* number is welcome to agents, so those calls are not
   wasted.

## Open items not part of this pivot

- **The registered address Pedro reads out** (currently 483 Green Lanes, London
  N13 4BS) is unconfirmed. Hugo said something different by voice on 2026-08-10
  and has not confirmed. He is reading it on live calls now.
- **Marr's login and Pedro's closer login are banned in Supabase Auth** until
  2126. Neither can sign in. Nobody has confirmed whether that is deliberate.
- Pay day moved to Saturday by Wise (agreement v3), but Pedro signed v2 which
  says Monday. Hugo is telling him verbally.
