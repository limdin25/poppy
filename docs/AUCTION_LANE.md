# The Auction lane

Built 2026-09-18/19 on Hugo's order: Pedro moves on to **unsold auction lots**,
on a second, clean CRM called the **Auction desk**. He can still call builders
from Houses.

## What Pedro sees

- A **Houses | Auction** switch at the top of the CRM (only for logins that
  have both desks: Pedro and the admins). Switching rebuilds the whole CRM.
- On **Auction**: only auction offices. No Houses contacts, calls, inbox
  threads, board cards, callback strip items, follow-up timers or bell items.
  The cockpit, find builders, estimator, raw deals and deal process pages are
  hidden. The dialer opens the **Auction - Pedro** campaign and the auction
  script, whatever the URL says.
- **The auction call room**: left, the office and its **Lots** tab (photos,
  auction house, lot, sale date, guide, post-auction price, size, tenure,
  occupancy, our value from strong comps, the sold houses behind it, the lot
  page, legal pack and floor plan links, and the outcome buttons); middle, the
  auction script filled from the selected lot; right, Coach and Messages.
- **Outcomes** (`api/crm/auction-outcome.ts`): Figure given (goes to Hugo),
  Still available call back, Viewing booked, Sold or under offer, Not
  suitable, No answer. A figure alerts Hugo the same way a Houses figure does.

## The inbound rule

A known contact belongs to its own desk and rings only on that desk. A
caller nobody knows is filed on the desk the agent is on and rings.
Hugo's choice: **an old Houses contact who calls while Pedro is on Auction does
not ring**; it goes to voicemail and waits on the Houses callback strip.
Canonical in `api/lib/desk-route.ts`, mirrored in `wk-voice-twiml-incoming`.
New SMS and email senders take the desk the agent is on.

## Where the lots come from (VPS, `/root/scraper/auction/`)

- One adapter per auction house in `auction/sources/` (Auction House, BTG
  Eddisons incl. SDL, Allsop, Clive Emson, Under The Hammer, and more as they
  are added; a new house is one new file). **Status is read from the lot's own
  page**, never from which list it was on.
- `auction/value.py` prices each lot with the **Houses engine**
  (`course_comps.select` at 400m, `street_evidence`, `comp_value`), comps from
  Rightmove sold data and the Land Registry file, every comp sized from the EPC
  register. Same box as Houses: a house (not a flat), price to beat 40k to
  200k, outcode under 1,000 crimes a month, strong/gold/street evidence,
  per-sqm value, **20% or more under value**, not over 60%.
- **Price to beat** = the post-auction price when published, else the top of
  the guide plus 10% (auctioneers set the reserve up to 10% above a single
  figure guide).
- Its own database `data/auction.db`, never `scraper.db`.
- `auction/run.py --send` files passes through `/api/properties/ingest` with
  `desk:'auction'`, and withdraws lots that sold or stopped passing.
- `scripts/assign-auction-lots-to-pedro.mjs` (copy in `/root/elsie-assign`)
  makes one contact per office and queues it. When an office comes back:
  `scripts/lib/auction-redial-policy.mjs` (one call a day, back only for a lot
  not asked about yet, no answer retried next day, three tries then weekly).

## Nightly

`auction-overnight.timer`, **06:45 UK**, runs `auction_overnight.sh`: scrape,
value, send, assign, then emails Hugo "Auction lots overnight". Separate from
the Houses `property-overnight` run on purpose. Logs:
`/root/scraper/logs/auction_overnight_<date>.log`.

## First load, 2026-09-19

Nine auction houses: Auction House, BTG Eddisons (SDL), Allsop, Clive Emson,
Under The Hammer, Pattinson (read with a headless browser, it sits behind
Cloudflare), Town and Country, Sutton Kersh, Bond Wolfe. 896 lots considered,
375 still for sale after a sale in the last 31 days, **17 passed**, filed as
**11 auction offices** in Pedro's queue. Most refusals are honest: sold since
(521), flats (104), land and commercial (82), tenanted (71).

## Window

New lots must have gone under the hammer in the **last 31 days** (Hugo's
"last month"). A lot Elsie already holds is re-judged every night whatever its
age, so it is withdrawn when it sells. Measured 2026-09-19 on three houses:
widening to every unsold lot still for sale doubles the passes (4 to 8); that
is Hugo's call, `--since-days` on the runner.

## Money that does not work

Floor plan reading uses the **Anthropic** backend: on 2026-09-19 both the
OpenRouter and the Gemini keys answered 402 Payment Required.
