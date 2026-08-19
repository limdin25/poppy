# The Deal Manager: a plan, not a build

*Written 2026-08-14. Nothing in this document is built. It is an audit of what
exists today and a proposal for the AI brain that manages Pedro through every
step of a deal, from the house landing in his CRM to the deal being sold to an
investor. The pipeline process itself does not change. Hugo decides whether and
when to build it.*

---

## 1. The audit: what already exists, and where nobody is watching

The property machine already has several brains, but every one of them is a
one-shot tool that fires once and forgets:

| Brain | When it fires | What it does | What it cannot do |
|---|---|---|---|
| `next-step-brief.ts` | the moment Pedro presses an outcome | writes the deterministic brief onto the house | goes stale the second anything else happens |
| `followup-assessment.ts` | when someone books a follow-up | writes the follow-up note from the file | only when a human opens the modal |
| `draft-offer-email.ts` | when someone clicks draft | writes the offer email | does not know if the offer should go yet |
| `spoken-email.ts` / `spoken-name.ts` | during the call | fills the To box and the name | call time only |
| the live coach | during the call | feeds Pedro lines | forgets the deal when the call ends |
| the overnight machine | 00:30 | prices, audits, queues | knows nothing about what happened on the phone today |

**The gaps, in the order they cost money:**

1. **Nothing watches a deal between events.** A card can sit in Ready for
   call 2 for four days and nothing notices, because every brain fires on a
   human action. The brief says "ring them back at the booked time" and then
   nobody checks whether that happened.
2. **An inbound email does not re-assess the deal.** The branch's reply lands
   on the card (built 2026-08-14), but the brief written before that reply
   still stands. The single most important new fact a deal can get, the branch
   answering in writing, changes no instruction anywhere.
3. **The overnight machine and the day shift do not talk.** A price cut lands
   at 00:30 on a house Pedro spoke about yesterday. The saved figures refresh,
   but nobody tells Pedro "this branch you already know just cut the price,
   ring them first."
4. **The board past Ballpark agreed is unmanaged.** Viewing booked (formerly Needs viewing) has a builder
   roster that is empty and no VA. Offer accepted onward (the investor pack:
   numbers, three sold comps, one rent comp, photos, written acceptance) exists
   only as a paragraph in BRRR_STRATEGY.md. Nothing checks a pack is complete,
   because there is no pack.
5. **Pedro's day has a queue order but no priorities.** The nightly assign
   script orders the queue once. During the day, overdue follow-ups, fresh
   branch replies, booked call-twos and new discovery calls all compete, and
   Pedro decides by eye.

Everything below is designed to close those five gaps without touching how a
deal moves. The stages, the outcomes, the fences, the redial policy and the
offer maths all stay exactly as they are.

---

## 2. The one rule the whole design hangs on

**The AI decides attention and words. Code decides money and moves.**

- The Manager may decide WHICH deal Pedro looks at next, WHAT the instruction
  says, and WHEN somebody gets nudged.
- The Manager may NEVER move a card, send a message, name a figure that is not
  already on the file, or override the deterministic brief. Those four things
  stay with the code and the humans, behind the fences that already exist.

This is the same law the codebase already lives by (`brrr-offer.ts` reads and
refuses to derive, the brief is deterministic, call one's email can never carry
a figure). The Manager is a layer on top of that law, never a way around it.

And the deterministic brief is the **fallback**. If the Manager is down, wrong,
rate-limited or switched off, the system is exactly what it is today, which
works. That is the safety story in one sentence: turning the Manager off
changes nothing except that Pedro is managed by Hugo again.

---

## 3. The design, four layers

### Layer 0: what exists today, untouched

The brief, the offer engine, the redial policy, the outcome route, the fences.
No file in this layer changes. A kill switch (one flag in `platform_settings`,
`deal_manager.enabled`) returns the product to today, byte for byte.

### Layer 1: the eyes. One deal-state assembler, no AI

A single pure function, `assembleDealState(propertyId)`, that gathers into one
object everything the system knows about a deal:

- the house: `brrr_properties` row, `deal` JSON, brief, Hugo's pinned note, status
- the calls: every `wk_calls` row for the branch, outcomes, the transcripts
- the writing: every email and SMS in and out (`wk_sms_messages`), and whether
  the branch has replied since the brief was written
- the board: current column, when it moved there, hours sitting in it
- the diary: booked follow-ups, due and overdue
- the checklist: the 16-question qualification as it stands
- the builder: roster matches for the outcode, viewing booked or not
- the clock: last touch, time since, and what the redial policy says

Deterministic, fully testable with fixtures, zero AI, and useful on its own
(the admin drawer could render it tomorrow). This is also the ONLY thing the
Manager is ever shown, which is what makes the guardrails in section 5
checkable: if a figure is not in the state object, the Manager never saw it.

### Layer 2: the brain. One assessor, structured output only

One server route, `api/crm/deal-manager.ts`, calling Claude through the
existing `callLLM` and `anthropic-content.ts` (the reader that survives
thinking blocks). It receives the state object and must answer in a strict
JSON shape:

```
{
  attention: 0-100,          // how urgently this deal needs a human today
  action: <one of a CLOSED LIST>,
  who: 'PEDRO' | 'HUGO' | 'VA' | 'NOBODY',
  instruction: <2-4 plain sentences>,
  flags: [<one of a CLOSED LIST of problems>],
  evidence: [<the state fields this rests on>]
}
```

The **closed action list is the pipeline, spelled out**. Per stage, the Manager
may only choose from the actions that stage already allows, for example:

- Discovery done evaluating: `wait_for_engine`, `chase_missing_fact`, `escalate_hugo`
- Ready for call 2: `make_offer_call`, `chase_email_reply`, `rebook_followup`
- Ballpark agreed: `send_offer_email`, `chase_written_confirmation`
- Viewing booked: `book_builder`, `chase_video_for_builder`, `escalate_hugo`
- Offer sent: `chase_the_answer`, `hold`
- Offer accepted: `assemble_investor_pack`, `chase_written_acceptance`
- Any stage: `flag_mismatch` (the card's column disagrees with the evidence)

An action outside the list is a validation error, and a validation error means
**fall back to the deterministic brief and log it**. The Manager cannot invent
a step, which is precisely what "without changing the pipeline process" means
in code.

The flags list is closed too: `stale_no_touch`, `reply_unread`,
`figure_mismatch` (a figure in the transcript disagrees with the file),
`stage_mismatch`, `overdue_followup`, `price_cut_on_known_branch`,
`blocked_needs_hugo`, `pack_incomplete`.

**When it runs (triggers, all of them events that already exist):**

1. Pedro presses an outcome (after the brief is written, never instead of it)
2. an inbound email or SMS lands on a deal contact
3. the overnight refresh touches a branch Pedro has already spoken to
4. a follow-up comes due
5. a morning sweep at 07:30 over every live card (the one polling trigger),
   which also catches "nothing happened yesterday and that is the problem"

Each run is keyed by a hash of the state object. Same state, no second
assessment, no second spend, no repeated nudge.

### Layer 3: the face. Where Pedro and Hugo see it

- **Pedro's Today list.** The dialer room gets one ordered list: every live
  deal with attention > threshold, highest first, one instruction line each.
  Pedro works top to bottom. This is the "manage Pedro" part, and it is
  advice on top of the queue he already has, not a new queue.
- **Nudges through the existing bell.** `wk_notifications` already reaches the
  bell, the desktop and email. The Manager writes there like every other
  producer. No new channel.
- **Hugo's lane.** Anything flagged `blocked_needs_hugo`, `figure_mismatch` or
  `stage_mismatch` surfaces to Hugo only. The Manager escalates, it never
  resolves.
- **The drawer shows its working.** Every assessment renders with its evidence
  list, next to (never instead of) the deterministic brief and Hugo's pinned
  note. The pinned note always wins on screen, as it does today.

---

## 4. The steps of a deal, and what the Manager does at each

The process is unchanged. This table is only WHO IS WATCHING each step once
the Manager exists.

| Step | Today | With the Manager |
|---|---|---|
| House lands in CRM | queued by the nightly script | unchanged, Manager notes arrival, no action |
| Discovery call | Pedro rings, coach helps | unchanged |
| Outcome pressed | brief written | brief written, then Manager assesses and sets attention |
| Homework overnight | reprice.py | unchanged, Manager re-assesses when figures refresh |
| Ready for call 2 | brief says ring back | Manager chases the booked time, flags it going stale |
| Ballpark agreed | Hugo emails the offer | Manager reminds, checks the email actually went, chases the reply |
| Viewing booked | roster panel, by hand | Manager prompts the builder booking, chases the video the builder needs |
| Offer sent | nothing watches | Manager chases the answer on a clock, rebooks the follow-up |
| Offer accepted | nothing exists | Manager runs the pack checklist (section 6) and chases each missing piece |
| Sent to investor | nothing exists | Manager tracks reservation and exchange halves of the fee |
| Any step | Hugo's memory | Manager holds the whole board in its head, which is the point |

---

## 5. The guardrails. This is the "very little room for error" section

Each rule below is enforced in code and pinned by a test that fails the build,
the same way the existing fences work.

1. **Figure provenance, the big one.** Every pound figure in any Manager
   output must appear, digit for digit, in the state object it was shown.
   Extract all numbers from the instruction, assert membership, reject the
   whole assessment on the first orphan and fall back to the brief. An AI that
   cannot invent a number cannot put a wrong number in front of an agent.
2. **No board writes.** The Manager's route has no code path that touches
   `pipeline_column_id`. Stage moves stay with the outcome route and human
   drags. `stage_mismatch` is a flag for Hugo, never a correction.
3. **No sends.** The Manager drafts nothing and sends nothing. Where a draft
   helps, it triggers the EXISTING draft routes, which carry the existing
   fences (call one's email can never hold a figure, the proof of funds stays
   redacted, draft-guards run). A human clicks send, always.
4. **Closed vocabularies.** Action and flag outside the lists = schema
   validation failure = fallback. There is no free-text action.
5. **Fail closed, loudly.** Model down, timeout, bad JSON, budget hit: the
   deterministic brief stands, the failure is logged, and a daily count of
   fallbacks reaches Hugo. Silence is the failure mode we refuse.
6. **Idempotent and capped.** State-hash dedupe, a per-day assessment budget,
   and the kill switch. A runaway loop spends the cap and stops, never Hugo's
   card.
7. **Copy rules are inherited.** The long-dash scrub runs on every instruction
   (the same `[–—]` replace the follow-up assessor already does), and the
   message-copy test covers every Manager template.
8. **Nudge etiquette.** At most one nudge per deal per day per person, and
   quiet hours match the ones the product already keeps. A manager that nags
   gets ignored, which is worse than no manager.

---

## 6. The investor pack gate (the one genuinely new checklist)

Past Offer accepted there is no code today. The Manager gets a deterministic
completeness check (code, not AI) mirroring BRRR_STRATEGY.md section 11:

- agreed price confirmed **in writing**, with the address, on file
- the numbers: asking, agreed, GDV, refurb, TMV, all read from the engine
- three sold comparables as clickable links, one rent comparable
- photos and the floor plan
- builder quote from the viewing, itemised, in writing

The AI writes the covering prose. The code refuses to mark the pack ready
while any line is missing, exactly the brief's own law: a missing fact is a
blocker, never an assumption.

---

## 7. Rollout, each phase with its own fallback test

No phase ships until the previous phase's exit test passes. Every phase keeps
the kill switch.

**Phase 0, shadow mode (build first, risk zero).**
The Manager runs on every trigger and writes to a log table
(`wk_deal_manager_log`) that only the admin drawer renders. Pedro sees
nothing. Run it 3 to 5 working days over the live board.
*Exit test:* zero figure-provenance rejections that reached the log (the fence
caught them all), zero schema failures unhandled, and Hugo reads the log and
agrees with at least 8 of 10 spot-checked instructions. If the Manager in
shadow disagrees with what Hugo actually told Pedro, the log shows both, and
that comparison is the whole point of the phase.

**Phase 1, the Today list.**
Pedro sees the ordered list and instruction lines. Nothing else changes, the
brief still renders everywhere it does now.
*Exit test:* e2e proves the list renders from the log, the kill switch removes
it cleanly, and a week of use where Pedro's outcome rate does not fall.

**Phase 2, nudges and Hugo's lane.**
Notifications on, etiquette rules on.
*Exit test:* e2e proves one-nudge-per-day dedupe, quiet hours, and that a
`blocked_needs_hugo` reaches Hugo and never Pedro.

**Phase 3, drafts on demand.**
The Manager's instruction can deep-link the existing draft routes prefilled.
*Exit test:* the existing draft fences all still pass (they already have
tests), plus one new e2e: a Manager-triggered call-one email with a figure in
the state is still refused by the fence.

**Phase 4, builder and investor pack.**
The Viewing booked prompts and the pack gate.
*Exit test:* pack gate unit tests (every missing line blocks), and the first
real deal packaged with every checklist line green.

---

## 8. The test suite, named

- `tests/deal-manager-invariants.test.ts`: schema, closed lists, figure
  provenance (including the adversarial case: a model answer smuggling a new
  figure inside a word like "around 63k"), long-dash scrub, fail-closed path.
- `tests/deal-state.test.ts`: the assembler on fixtures, including a branch
  with two contacts, a dead auditor_killed house, and a deal with no calls yet.
- **Golden corpus**: real deals replayed as fixtures. Orion Way (the size-blind
  valuation), Welwyn Park Road (the comps-count bug), Holloway Head (the
  auditor's founding case), McDonald of Bispham (the redial). Each has a known
  right answer for what the next instruction should have been, because these
  already happened and we know how they went.
- **E2e**: Today list renders, kill switch restores today's UI, nudge dedupe,
  Hugo lane isolation. Playwright, like everything else, run before DONE.
- **The standing comparison**: shadow logging never turns off. Even at Phase 4
  the Manager's assessment sits next to what actually happened, so drift is
  visible for as long as it runs.

---

## 9. What it costs

Sonnet 5 through the existing key. A live board of ~60 branches, roughly 150
to 250 assessments a day after hash dedupe, around 3k tokens in and 300 out
each: **about GBP 2 to 3 a day, GBP 60 to 90 a month** at current prices. The
morning sweep is the biggest block and is capped first if the budget bites.
Shadow mode alone is the same cost, which buys the evidence before any risk.

---

## 10. Open decisions for Hugo (not taken here)

1. **Go or no-go on Phase 0.** Shadow mode changes nothing Pedro sees and
   costs a few pounds a day. Recommendation: yes, it is the cheapest way to
   find out if the brain is any good.
2. **Who is the VA in the builder step?** The roster is empty and the Manager
   can only chase a booking somebody can actually make.
3. **Does the Manager message Pedro directly** (WhatsApp through the CRM) or
   only through the Today list and bell? Recommendation: list and bell only
   until Phase 2 has a clean week. A robot that texts a human employee is a
   relationship decision, not an engineering one.
4. **The legal gap from HOW_THE_MACHINE_WORKS.md still stands.** AML
   supervision, ICO registration, redress scheme, PI insurance. The Manager
   will happily march a deal to "ready for investor" and the business still
   cannot legally take the fee. Worth deciding before Phase 4 matters.
