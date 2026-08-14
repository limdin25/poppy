// The one line the pipeline card shows.
//
// Hugo, 2026-08-14: "on the card on the pipeline it should be already written
// there, the next step, and then we can click and see it on the notes."
//
// The card is 280px wide, so this picks ONE line out of a paragraph Hugo typed
// by hand. Picking the wrong one is not cosmetic: the headline ("KEEP: DDM
// Grimsby, Orion Way") is already the card's own address chip, so a card that
// shows it says nothing at all and the deal reads as having no next step.

import { describe, it, expect } from 'vitest'
import { pinnedInstruction } from '../src/features/crm/components/shared/BriefLine'

// Hugo's own note on Orion Way, exactly as he pinned it on 2026-08-14.
const DDM = [
  'KEEP: DDM Grimsby, Orion Way',
  'Asking: £110k | Our offer: £96,375 (with the vendor)',
  '',
  'Why it holds: Two houses on the same street sold this winter for £105k and £110k.',
  '',
  'Pedro today: Ring Doug. Chase the answer. Ask again for the video walkthrough.',
  '',
  'Board: Offer sent',
].join('\n')

const ZEST = [
  'KEEP: Zest Hull, Welwyn Park Road',
  'Asking: £125k | Our offer: £103,600 (ready to go)',
  '',
  'Blocker (Hugo, today): Agent will not put the offer forward without proof of funds.',
].join('\n')

describe('the instruction out of a pinned note', () => {
  it('takes the line that says what happens next, not the headline', () => {
    expect(pinnedInstruction(DDM)).toBe(
      'Pedro today: Ring Doug. Chase the answer. Ask again for the video walkthrough.',
    )
  })

  it('a blocker is what happens next when there is one', () => {
    expect(pinnedInstruction(ZEST)).toBe(
      'Blocker (Hugo, today): Agent will not put the offer forward without proof of funds.',
    )
  })

  it('falls back to the first real line when nothing is labelled', () => {
    expect(pinnedInstruction('KEEP: Somewhere\nRing them back tomorrow'))
      .toBe('Ring them back tomorrow')
  })

  it('never returns the KEEP/HOLD/DROP headline on its own account', () => {
    expect(pinnedInstruction('HOLD: Zest Hull')).toBe('HOLD: Zest Hull')
  })

  it('draws nothing on a lead with no note', () => {
    expect(pinnedInstruction('')).toBeNull()
    expect(pinnedInstruction(null)).toBeNull()
    expect(pinnedInstruction(undefined)).toBeNull()
    expect(pinnedInstruction('   \n  ')).toBeNull()
  })
})
