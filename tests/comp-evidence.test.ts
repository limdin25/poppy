// The sold-comparables sentence, which gets READ OUT LOUD.
//
// It is a script token, so a bad value here is not a cosmetic bug: on
// 2026-08-14 two live board cards held "[object Object] · [object Object] ·
// [object Object]" and that was what the dialer would have shown Pedro to say
// to an estate agent. The cause was a silent one: the valuation engine moved
// deal.evidence from an array of sentences to an array of comp rows, and
// Array.join() on objects does not throw.

import { describe, it, expect } from 'vitest'
// @ts-expect-error plain .mjs, no types, same as the other script libs
import { compEvidenceSentence, compRows } from '../scripts/lib/comp-evidence.mjs'

// Welwyn Park Road, exactly as the engine filed it on 2026-08-14.
const REAL_DEAL = {
  cmv: { estimate: 129500, confidence: 'high' },
  comps_note: '3 sold comps, same style, within 400m, sold in the last 12 months',
  evidence: [
    { address: '107 WELWYN PARK ROAD', price: 145000, date: '2026-02-20', distance_m: '0' },
    { address: '179 SUTTON ROAD', price: 84000, date: '2025-10-31', distance_m: '244' },
    { address: '18 WELWYN PARK AVENUE', price: 140000, date: '2025-09-08', distance_m: '200' },
  ],
}

describe('the sentence never contains an object', () => {
  it('never returns [object Object], whatever the shape', () => {
    const shapes = [
      REAL_DEAL,
      { evidence: REAL_DEAL.evidence },
      { cmv: { audit: [{ address: 'A', price: 1000, included: true }] } },
      { cmv: { n_used: 4, estimate: 100000 } },
      {},
      null,
      undefined,
    ]
    for (const d of shapes) {
      expect(compEvidenceSentence(d)).not.toMatch(/\[object/)
      expect(compEvidenceSentence(d).trim().length).toBeGreaterThan(0)
    }
  })
})

describe('the engine gets the first word when it wrote one', () => {
  it('uses comps_note, the sentence written to be said out loud', () => {
    expect(compEvidenceSentence(REAL_DEAL)).toBe(
      '3 sold comps, same style, within 400m, sold in the last 12 months, putting it at £129,500',
    )
  })

  it('falls back to the count when there is no note', () => {
    expect(compEvidenceSentence({ cmv: { n_used: 4, estimate: 100000 } }))
      .toBe('4 sold comparables nearby put it at £100,000')
  })

  it('says one comparable in the singular', () => {
    expect(compEvidenceSentence({ cmv: { n_used: 1, estimate: 100000 } }))
      .toBe('1 sold comparable nearby put it at £100,000')
  })
})

describe('the rows, when they are all we have', () => {
  it('reads address, RAW sold price and date', () => {
    const s = compEvidenceSentence({ evidence: REAL_DEAL.evidence })
    expect(s).toBe(
      '107 WELWYN PARK ROAD sold for £145,000 (2026-02-20) · '
      + '179 SUTTON ROAD sold for £84,000 (2025-10-31) · '
      + '18 WELWYN PARK AVENUE sold for £140,000 (2025-09-08)',
    )
  })

  it('never puts a distance in it, because ring_used is an index not metres', () => {
    expect(compEvidenceSentence({ evidence: REAL_DEAL.evidence })).not.toMatch(/244|200m|within 1m/)
  })

  it('caps at three, a phone call is not a spreadsheet', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ address: `H${i}`, price: 100000 + i }))
    expect(compEvidenceSentence({ evidence: many }).split(' · ')).toHaveLength(3)
  })

  it('still reads the old flat shape, which is live in the wild', () => {
    expect(compEvidenceSentence({ evidence: ['two doors down sold for £105k'] }))
      .toBe('two doors down sold for £105k')
  })

  it('takes only the audit rows the engine included', () => {
    const rows = compRows({
      cmv: {
        audit: [
          { address: 'IN', price: 100000, included: true },
          { address: 'OUT', price: 999999, included: false },
        ],
      },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].address).toBe('IN')
  })
})

describe('nothing on file is a real answer', () => {
  it('says so plainly rather than inventing evidence', () => {
    expect(compEvidenceSentence({})).toBe('no sold comparables on file')
    expect(compEvidenceSentence({ evidence: [] })).toBe('no sold comparables on file')
    // A row with no price proves nothing and must not become "sold for £0".
    expect(compEvidenceSentence({ evidence: [{ address: 'somewhere' }] }))
      .toBe('no sold comparables on file')
  })
})
