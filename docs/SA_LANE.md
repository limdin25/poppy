# The Serviced Accommodation lane

Built 2026-09-23 on Hugo's order. Pedro rings letting agents about city-centre
flats advertised to rent, on a third clean CRM called the **Serviced
Accommodation desk** (SA).

## What we are doing on the call

**We are the middleman. We do not take the flat.** Hugo:

> "we're gonna find the agent that'll say yes, not the landlords, the actual
> agent. Agent or landlord to say yes, doesn't matter. And then after that,
> we're gonna find a service accommodation company that will rent from the
> landlord."

So the call wants one thing: a **yes in principle**, from the agent or the
landlord, that the flat could be let to a serviced accommodation company on a
company let (3 to 5 years, full asking rent every month, booked or not). Hugo
then appoints an agent and brings the company. **No negotiation**: the company
pays the asking rent. Pedro never agrees a date, a contract or a viewing, and
never names an operator.

London and Scotland are in. Hugo: the strategy is short stays within the
limits and longer stays the rest of the year. The script says the company
works within the local rules (London's 90 nights, a Scottish licence) and
promises nothing legal beyond that. Note for Hugo: under the London rule, a
stay counts towards the 90 nights if it is under 90 consecutive nights, so a
20-night stay still counts; that is why the script does not claim otherwise.

## What Pedro sees

- A **drop down** at the top of the CRM: Houses, Auction, Serviced
  Accommodation (was a two-way switch). Only logins with more than one desk see
  it (Pedro and the admins). Locked during a call.
- On SA: only SA agencies, calls, inbox threads, board cards, callbacks and
  bell items. The dialer opens the **SA - Pedro** campaign and the SA script,
  whatever the URL says.
- **The SA call room**: left, the agency and **The flat** (photos, rent, beds,
  city, available date, listing link, earlier answers from this agency, and the
  outcome buttons); middle, the SA script filled from the flat; right, Coach,
  **Email** (the company-let email, Pedro presses send) and Messages.
- **Outcomes** (`api/crm/sa-outcome.ts`): Yes in principle (needs a name,
  alerts Hugo), Checking with the landlord, Said no, Never do company lets
  (the agency is never dealt again), Already let, No answer.
- Board **Serviced Accommodation**: SA: yes in principle, SA: checking with
  landlord, SA: said no, SA: no company lets, SA: already let, Voicemail, No
  pickup.

## Where the flats come from

`scripts/sa-scrape-and-assign.mjs` with the rules in `scripts/lib/sa-listings.mjs`
(tests: `tests/sa-listings.test.ts`, `tests/sa-desk.test.ts`).

- Rightmove **to-rent** search, plain GET, no browser, no proxy. The search page
  carries the agency name and phone on every row.
- **City centres only**: `SA_AREAS` (72 postcodes in 39 cities, London W1 to
  NW1, Liverpool L1 to L3, Manchester M1 to M4, Edinburgh, Glasgow, and so on).
- Kept: flats (flat, apartment, penthouse, duplex, maisonette), 1 to 3 beds,
  not let agreed. Dropped: student lets, rooms, build-to-rent blocks, houses
  (a postcode that runs into the suburbs), anything already a short let or
  serviced, portals and national operators (OpenRent, Accommodation.co.uk,
  housing associations).
- **One flat per agency** (agency = its phone), the newest. After an agency is
  dealt a flat it **rests 14 days**, then can come back with a different flat.
- A phone already on Houses or Auction is skipped, never moved.
- The day is spread across the country: one agency per city in turn.
- Listings live in their own table `sa_listings`, never in `brrr_properties`.

## Every morning

`sa-overnight.timer` on the VPS, **06:30 UK**, runs `/root/scraper/sa_overnight.sh`,
which runs the COPY in `/root/elsie-assign/scripts/` with `--apply --target=100`:
it tops the queue back up to 100 waiting agencies. Re-copy
`scripts/sa-scrape-and-assign.mjs` and `scripts/lib/sa-listings.mjs` there when
they change. Log: `/root/scraper/logs/sa_overnight_<date>.log`.

## First load, 2026-09-23

3,114 rentals read across 72 postcodes in 8 seconds, 2,018 kept, 879 different
agencies, **100 queued** for Pedro (2 or 3 per city). Refused: build to rent
562, houses 295, portals 165, short lets and rooms 49.

## Found on the way

The dialer room read its campaigns from a second hook
(`src/features/crm/caller-pad/hooks/useDialerCampaigns.ts`) that the Auction
build never filtered by desk. Campaigns sort by name, so every desk opened on
"Auction - Pedro": read from the code, Pedro's Houses dialer would have opened
on the auction queue since 2026-09-19 unless he picked another campaign. Fixed
and pinned in `tests/auction-desk-isolation.test.ts`.
