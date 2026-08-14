// Reading what the branch actually said.
//
// Hugo, 2026-08-14: "now I can see Lexi has replied, but the templates is
// suggesting a follow up ... they already replied so we don't have to ask for
// a follow up on the price offer. The system has not synchronized."
//
// The webhook filed her email and did nothing else. Seven hours later the
// board still said "Chase the agent" while the answer sat unread.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  classifyByRules, figuresMentioned, validateReading, summarise, stepForInbound,
  INBOUND_KINDS, DEAL_CHANGING, type InboundReading,
} from '../api/lib/inbound-classify'

// Lexi Collins, DDM Residential, 2026-08-14 08:38, verbatim.
const LEXI = {
  subject: 'Update on Offer',
  body: `Good morning,

I hope you're well.

Our vendors of 39 Orion Way have responded to us in relation to your offer.
Unfortunately, they have rejected your offer as they are looking for a figure
closer to the asking price of £110,000.

Please could you advise on whether £96,370 is your best offer or if you are
able to increase any further.

Please respond to Doug, who has been cc'd into this email.

Kind Regards,
Lexi Collins`,
}

describe('the email that started this', () => {
  const r = classifyByRules(LEXI.subject, LEXI.body)

  it('reads it as a counter-offer, not an ordinary chase', () => {
    // A rejection that names a figure is a door opening at a price, which is a
    // different conversation from a door closing.
    expect(r.kind).toBe('counter_offer')
  })

  it('knows it changes what we do next', () => {
    expect(r.changesTheDeal).toBe(true)
  })

  it("pulls out the branch's figures", () => {
    expect(r.figuresMentioned).toEqual(expect.arrayContaining([110000, 96370]))
  })

  it('says plainly what happened, and warns the figure is not agreed', () => {
    expect(r.summary).toContain('110,000')
    expect(r.summary.toLowerCase()).toContain('not treat that as agreed')
  })

  it('needs no model to reach any of that', () => {
    expect(r.by).toBe('rules')
  })
})

describe('the shapes that matter', () => {
  const cases: Array<[string, string, InboundReading['kind']]> = [
    ['plain rejection', 'The vendor has rejected your offer.', 'rejection'],
    ['declined', 'They declined, sorry.', 'rejection'],
    ['acceptance', 'Good news, the vendor has accepted your offer.', 'acceptance'],
    ['proof of funds', 'Could you send your proof of funds please.', 'document_request'],
    ['not interested', 'The property is now under offer.', 'not_interested'],
    ['viewing', 'When are you available to view the property?', 'viewing_response'],
    ['info supplied', 'Please find attached the floor plan.', 'info_supplied'],
    ['a bare question', 'Can you confirm your position on this one', 'question'],
    ['a question with a mark', 'Where are we up to on this?', 'question'],
    ['please advise, no question mark', 'Please advise on the position.', 'question'],
    ['any update', 'Any update on this one for us', 'question'],
  ]

  it.each(cases)('%s', (_label, body, expected) => {
    expect(classifyByRules('', body).kind).toBe(expected)
  })

  it('an acceptance asks for it in writing, because that is the rule', () => {
    const r = classifyByRules('', 'The vendor has accepted your offer.')
    expect(r.summary.toLowerCase()).toContain('in writing')
  })
})

describe('an out of office must never look like an answer', () => {
  it('is caught even when it quotes the whole thread underneath', () => {
    // The trap: an autoreply quoting our own offer email would otherwise match
    // every keyword in it.
    const body = `I am out of the office until Monday.

    > Our offer of £64,074 is subject to our builder viewing.
    > Please confirm whether the vendor has rejected it.`
    const r = classifyByRules('Automatic reply', body)
    expect(r.kind).toBe('out_of_office')
    expect(r.changesTheDeal).toBe(false)
  })

  it('does not raise the alarm for a holiday autoreply', () => {
    expect(classifyByRules('', 'On annual leave until the 3rd.').changesTheDeal).toBe(false)
  })
})

describe('figures the branch named', () => {
  it('reads a currency-marked or comma-grouped price', () => {
    expect(figuresMentioned('they want £110,000 or 105,000 at a push'))
      .toEqual(expect.arrayContaining([110000, 105000]))
    expect(figuresMentioned('GBP 96370 is our best')).toEqual([96370])
  })

  it('ignores years and small numbers', () => {
    expect(figuresMentioned('listed in 2025, 3 bedrooms, 2 receptions')).toEqual([])
  })

  it('ignores the phone numbers in a branch signature', () => {
    // Found on Lexi's real email: "01472 358671" and a mobile were being read
    // as GBP 358,671 and GBP 3,844,565. A phone number quoted back as a price
    // in a notification is worse than missing a figure.
    expect(figuresMentioned('Office 01472 358671 | Mobile 07958 3844565')).toEqual([])
  })

  it('still reads a real price out of the same email', () => {
    const real = 'they want closer to £110,000. Office 01472 358671'
    expect(figuresMentioned(real)).toEqual([110000])
  })

  it('de-duplicates', () => {
    expect(figuresMentioned('£110,000 ... the 110,000 figure')).toEqual([110000])
  })

  it('is empty on an email with no money in it', () => {
    expect(figuresMentioned('Thanks, I will chase the vendor today.')).toEqual([])
  })
})

describe('a model reading is validated, never trusted', () => {
  const fallback = classifyByRules(LEXI.subject, LEXI.body)

  it('accepts a well-formed reading', () => {
    const r = validateReading(
      { kind: 'rejection', summary: 'The vendor turned it down.' }, fallback,
    )
    expect(r.kind).toBe('rejection')
    expect(r.by).toBe('model')
  })

  it('takes the figures from the TEXT, never from the model', () => {
    // A model that mis-transcribes a price into a notification is worse than
    // no reading at all.
    const r = validateReading(
      { kind: 'counter_offer', summary: 'They came back.', figuresMentioned: [999999] },
      fallback,
    )
    expect(r.figuresMentioned).toEqual(fallback.figuresMentioned)
    expect(r.figuresMentioned).not.toContain(999999)
  })

  it.each([
    ['a kind nobody defined', { kind: 'vibes', summary: 'ok' }],
    ['no summary', { kind: 'rejection', summary: '  ' }],
    ['an essay', { kind: 'rejection', summary: 'x'.repeat(301) }],
    ['a long dash', { kind: 'rejection', summary: 'They said no — again.' }],
    ['not an object', 'rejection'],
    ['nothing', null],
  ])('falls back to the rules read on %s', (_label, raw) => {
    expect(validateReading(raw, fallback)).toEqual(fallback)
  })
})

describe('the contract holds together', () => {
  it('every deal-changing kind is a real kind', () => {
    for (const k of DEAL_CHANGING) expect(INBOUND_KINDS).toContain(k)
  })

  it('every kind has a summary that is not empty', () => {
    for (const k of INBOUND_KINDS) expect(summarise(k, []).length).toBeGreaterThan(5)
  })

  it('only an autoreply and an unreadable one change nothing', () => {
    // Everything else, including a branch SUPPLYING what we asked for, makes
    // the instruction on the card out of date.
    const inert = INBOUND_KINDS.filter((k) => !DEAL_CHANGING.includes(k))
    expect(inert.sort()).toEqual(['other', 'out_of_office'])
  })

  it('never throws on rubbish', () => {
    expect(classifyByRules('', '').kind).toBe('other')
    expect(() => classifyByRules(undefined as never, undefined as never)).not.toThrow()
  })
})

describe('what the reply does to the next step', () => {
  it('a rejection stops the card saying chase, and asks for a decision', () => {
    // The Lexi case exactly: the answer arrived, so "follow up until you get
    // an answer" is the one instruction that is certainly wrong.
    expect(stepForInbound('rejection')).toBe('Renegotiate')
    expect(stepForInbound('counter_offer')).toBe('Renegotiate')
  })

  it('an acceptance asks for it in writing, never treats verbal as done', () => {
    expect(stepForInbound('acceptance')).toBe('Get it in writing')
  })

  it('a closed door clears the step', () => {
    expect(stepForInbound('not_interested')).toBe('')
  })

  it('leaves the tag alone when the next step is NOT obvious', () => {
    // A wrong instruction is worse than a stale one. Pedro reads these out loud.
    for (const k of ['question', 'document_request', 'viewing_response',
                     'info_supplied', 'out_of_office', 'other'] as const) {
      expect(stepForInbound(k)).toBeNull()
    }
  })

  it('every tag it can write is a real step in the deal process', () => {
    const src = readFileSync(
      resolve(__dirname, '..', 'src/features/crm/components/templates/dealProcessSteps.ts'),
      'utf8',
    )
    for (const k of INBOUND_KINDS) {
      const tag = stepForInbound(k)
      if (tag) expect(src, `${k} -> ${tag}`).toContain(`tag: '${tag}'`)
    }
  })
})
