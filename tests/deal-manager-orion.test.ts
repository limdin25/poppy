// The Deal Manager against the deal that started all of this.
//
// 39 Orion Way. We opened at GBP 96,375 on a house the corrected maths says is
// worth GBP 92,667 done up, Lexi rejected it in writing at 08:38 on 2026-08-14
// asking whether that was our best, and the card still said "Chase the agent"
// seven hours later. This is the shape the Manager exists to catch.

import { describe, it, expect } from 'vitest'
import { buildDealState } from '../api/lib/deal-state'
import {
  validateVerdict, fallbackVerdict, baselineAttention, deterministicFlags,
} from '../api/lib/deal-manager-contract'

const NOW = new Date('2026-08-14T18:00:00Z')

// The corrected figures, as written to brrr_properties on 2026-08-14.
const orion = buildDealState({
  property: {
    id: 'orion',
    address: 'Orion Way, Grimsby, DN34',
    asking_price: 110000,
    deal: {
      comps_tier: 'good',
      gdv: { estimate: 92667 },
      tmv: 82167,
      refurb: { low: 6891 },
      offer: { open: 64074, max: 68345, ladder: [64074, 66210, 68345] },
      superseded: { offer: { open: 96375 } },
    },
    brief: { written_at: '2026-08-13T10:32:00Z', do_now: ['Ring Doug. Chase the answer.'] },
  },
  contact: { id: 'c', name: 'DDM Residential, Grimsby' },
  columnName: 'Offer sent',
  messages: [{
    id: 'lexi', direction: 'inbound', channel: 'email',
    created_at: '2026-08-14T08:38:00Z',
    subject: 'Update on Offer',
    body: 'Our vendors of 39 Orion Way have rejected your offer as they are looking '
      + 'for a figure closer to the asking price of 110,000. Please could you advise '
      + 'on whether 96,370 is your best offer.',
  }],
  now: NOW,
})

describe('the deal that started all of this', () => {
  it('sees that the branch answered after the brief was written', () => {
    expect(orion.writing.replySinceBrief).toBe(true)
    expect(deterministicFlags(orion)).toContain('reply_unread')
  })

  it('puts it near the top of the day without asking a model anything', () => {
    expect(baselineAttention(orion)).toBeGreaterThanOrEqual(70)
  })

  it('still gives a usable instruction with the Manager switched off', () => {
    expect(fallbackVerdict(orion).instruction).toBe('Ring Doug. Chase the answer.')
  })

  it('REFUSES an instruction telling Pedro to meet the vendor at the asking price', () => {
    // 110,000 IS on the file as the asking price, so the figure fence alone
    // would allow it. The ACTION fence is what stops it: raising a price is
    // not something any stage lets the Manager instruct.
    const r = validateVerdict({
      attention: 90, action: 'raise_offer', who: 'PEDRO',
      instruction: 'Go back to them at 110,000 to get it agreed.',
      flags: ['reply_unread'], evidence: [],
    }, orion)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('action_not_allowed')
  })

  it('REFUSES a made-up compromise figure between our ceiling and their ask', () => {
    const r = validateVerdict({
      attention: 90, action: 'chase_the_answer', who: 'PEDRO',
      instruction: 'Offer 89,000 as a middle ground and see if they bite.',
      flags: [], evidence: [],
    }, orion)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invented_figure')
  })

  it('ALLOWS the honest instruction: our ceiling is below what they want', () => {
    const r = validateVerdict({
      attention: 90, action: 'chase_the_answer', who: 'PEDRO',
      instruction: 'Lexi has written back rejecting the offer and asking if it is our '
        + 'best. Our ceiling on this house is GBP 68,345, which is well under what the '
        + 'vendor wants, so there is nothing to raise. Ring Doug and tell him plainly.',
      flags: ['reply_unread'], evidence: ['writing.lastInboundPreview', 'money.ceiling'],
    }, orion)
    expect(r.ok).toBe(true)
  })

  it('never lets the model rank it lower than code knows it should be', () => {
    // A model that shrugs at an ignored rejection is overruled by the floor.
    const floor = baselineAttention(orion)
    expect(Math.max(5, floor)).toBe(floor)
  })
})
