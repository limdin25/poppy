// The email must not ask for what the call already answered.
//
// Pearson Street, Workington, 2026-08-18, all on one recording:
//
//   12:05  Amy: "the vendors just accepted an offer"
//   12:05  Amy: "yeah, the floor plans on the advert"
//   12:06  Amy refuses the walkthrough: "because an offer's been accepted we
//          wouldn't do anything unless it was a buyer themselves"
//   12:08  OUR EMAIL goes out asking for: a video walkthrough, the floor plan
//          and the EPC.
//   12:10  Amy answers all three a second time, out loud, patiently.
//
// Hugo, listening to the recording beside the email: "If there is a floor
// plan, why would you ask for the floor plan on the email? And also the EPC,
// she also mentioned the EPC. So the call didn't hear. And she clearly said
// there was an offer on the property, so the email should be targeting: if
// the offer falls through, email us back, and also email us with your
// properties if you have one."
//
// Three separate holes, three fences here:
//   1. The distilled checklist (what the branch ALREADY answered, with quotes)
//      never reached any email writer. Now it rides on every kind that asks
//      for anything, via body.propertyId.
//   2. The prompts allowed the asks anyway. Now the video prompt refuses to
//      re-ask a refused walkthrough or a located document, and every kind
//      changes job when an offer has been accepted: fall-through + send us
//      your other stock.
//   3. The email that actually went out was the static TEMPLATE, because the
//      auto-draft only fired on a coach-captured address and Amy's was typed
//      by hand. A hand-typed address now triggers the same draft.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { heardFactsBlock, HEARD_KEY, CHECKLIST_KEYS } from '../api/lib/deal-state'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const DRAFT = read('api/crm/draft-offer-email.ts')
const ACTION = read('api/crm/cockpit-action.ts')
const PANE = read('src/features/crm/components/live-call/PropertyEmailPane.tsx')

// The exact shape the call listener wrote for Pearson Street.
const PEARSON = {
  still_available: 'offer just accepted, no longer available',
  condition_band: 'cosmetic',
  tenure: 'freehold',
  [HEARD_KEY]: {
    still_available: { quote: 'the vendors just accepted an offer', call_id: 'k1', at: 'x' },
    tenure: { quote: 'This one is free hold', call_id: 'k1', at: 'x' },
  },
}

describe('1. the distilled answers, rendered once for everything that writes', () => {
  it('one line per answered key, with the words it came from', () => {
    const block = heardFactsBlock(PEARSON)
    expect(block).toContain('still available: offer just accepted, no longer available')
    expect(block).toContain('(they said: "the vendors just accepted an offer")')
    expect(block).toContain('tenure: freehold (they said: "This one is free hold")')
    // An answer with no stored quote still renders, plainly.
    expect(block).toContain('- condition band: cosmetic')
  })

  it('internal keys never leak into the block', () => {
    expect(heardFactsBlock(PEARSON)).not.toContain(HEARD_KEY)
    expect(heardFactsBlock({ _read: { call_id: 'k1' } })).toBe('')
  })

  it('empty in, empty out, so callers can drop the block cleanly', () => {
    expect(heardFactsBlock(null)).toBe('')
    expect(heardFactsBlock({})).toBe('')
  })

  it('walks the checklist vocabulary, not whatever keys happen to exist', () => {
    // A stray key on qualification is not a fact the call established.
    expect(heardFactsBlock({ made_up_key: 'yes' })).toBe('')
    expect(CHECKLIST_KEYS.length).toBe(12)
  })

  it('a quote cannot flood the prompt', () => {
    const block = heardFactsBlock({
      water: 'unknown',
      [HEARD_KEY]: { water: { quote: 'x'.repeat(2000), call_id: 'k1', at: 'x' } },
    })
    expect(block.length).toBeLessThan(400)
  })
})

describe('2. the answers reach the writers', () => {
  it('the draft route loads the checklist when it is told which house', () => {
    expect(DRAFT).toMatch(/propertyId/)
    expect(DRAFT).toMatch(/heardFactsBlock/)
    expect(DRAFT).toMatch(/WHAT THE BRANCH HAS ALREADY ANSWERED/)
    expect(DRAFT).toMatch(/NEVER ask for anything this list already answers/)
  })

  it('every writing kind gets them except address_only, which asks for nothing', () => {
    expect(DRAFT).toMatch(/!isAddressOnly && heardBlock/)
    // And the counter/follow-up branch carries the block too.
    expect(DRAFT).toMatch(/heardBlock \|\| null/)
  })

  it('the cockpit tells the drafter which house', () => {
    expect(ACTION).toMatch(/propertyId: state\.propertyId/)
  })

  it('the mid-call pane and the board modal tell it too', () => {
    expect(PANE).toMatch(/propertyId: offerHouse\?\.propertyId \?\? null/)
    expect(read('src/features/crm/components/contacts/ContactSmsModal.tsx'))
      .toMatch(/propertyId: deal\.propertyId \?\? null/)
    expect(read('src/features/crm/components/live-call/MidCallSmsSender.tsx'))
      .toMatch(/propertyId: offerHouse\?\.propertyId \?\? null/)
    // offerHouseFor carries the id, so both call-room senders have it.
    expect(read('src/features/crm/hooks/usePropertyListings.ts'))
      .toMatch(/propertyId: l\.id/)
  })

  it('the brain reads the same lines off the state', () => {
    const STATE = read('api/lib/deal-state.ts')
    expect(STATE).toMatch(/heard: heardFactsBlock\(q\)/)
  })
})

describe('3. the prompts refuse the asks the call already answered', () => {
  it('a refused walkthrough is never asked for again', () => {
    expect(DRAFT).toMatch(/UNLESS the call shows they have already said no to a video/)
  })

  it('a document the agent located is not asked for', () => {
    expect(DRAFT).toMatch(/on the advert, on the listing or online, DO NOT ask for it/)
    // The old unconditional wording is gone.
    expect(DRAFT).not.toMatch(/If the floor plan or the full EPC came up as missing on the call, ask for those/)
  })

  it('an accepted offer changes the job of EVERY kind that could chase', () => {
    // video_request, follow_up and counter_reply each carry the situation rule:
    // fall-through first, then send us your other stock.
    const hits = DRAFT.match(/OFFER HAS ALREADY BEEN ACCEPTED/g) ?? []
    expect(hits.length).toBeGreaterThanOrEqual(3)
    expect(DRAFT).toMatch(/come straight back to us/)
    expect(DRAFT).toMatch(/needs work or where the price has to come down/)
  })
})

describe('4. the draft fires on a hand-typed address, not only a heard one', () => {
  it('the pane watches the To field go valid during a live call', () => {
    expect(PANE).toMatch(/prevValidRef/)
    expect(PANE).toMatch(/if \(was \|\| !valid\) return/)
    expect(PANE).toMatch(/if \(!currentCallId\) return/)
    // Never over a human's own words, same rule as the heard trigger.
    expect(PANE).toMatch(/if \(drafted\.current \|\| touched\.current\) return/)
  })

  it('the blind template self-qualifies its floor plan ask', () => {
    expect(PANE).toMatch(/not already on the advert/)
  })
})
