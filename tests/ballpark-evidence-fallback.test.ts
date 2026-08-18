// A discovery card shows the homework's sold comparables.
//
// Friars Close, 18 Aug: the discovery lane files no deal (by design, call one
// never says a figure), so the Houses panel said "no sold comparables on
// file" while ballpark_preview held four good comps, and Hugo, tired, called
// the CRM broke. Facts about OTHER houses' sold prices break no call-one
// rule; only OUR band stays behind the human press (applyBallpark).
//
// The rows below are the real Friars Close evidence as stored on
// ballpark_preview.engine.evidence that evening.

import { describe, it, expect } from 'vitest'
import {
  ballparkEvidenceSentences,
  ballparkIsReady,
} from '../src/features/crm/hooks/usePropertyListings'

const FRIARS_PREVIEW = {
  ok: true,
  engine: {
    ok: true,
    evidence: [
      { address: '59 FRIARS CLOSE', price: 180000, date: '2026-03-19', distance_m: '0', floor_area_sqm: '89' },
      { address: '6 GREENVILLE CLOSE', price: 252500, date: '2025-08-21', distance_m: '297', floor_area_sqm: '97' },
      { address: '2 VIOLET CROFT', price: 260000, date: '2026-02-19', distance_m: '319', floor_area_sqm: '119' },
      { address: '4 VIOLET CROFT', price: 263000, date: '2025-08-28', distance_m: '319', floor_area_sqm: '119' },
    ],
  },
}

describe('ballparkEvidenceSentences', () => {
  it('turns the Friars Close preview into readable sentences', () => {
    const s = ballparkEvidenceSentences(FRIARS_PREVIEW)
    expect(s).toHaveLength(4)
    expect(s[0]).toContain('59 FRIARS CLOSE')
    expect(s[0]).toContain('£180,000')
    // The 0m distance is the strongest fact on the card and must survive
    // (the engine sends it as the string "0").
    expect(s[0]).toContain('0m away')
    expect(s[0]).toContain('89 sqm')
    expect(s[0]).toContain('2026-03-19')
  })

  it('gives nothing on an empty or refused preview', () => {
    expect(ballparkEvidenceSentences(null)).toEqual([])
    expect(ballparkEvidenceSentences({})).toEqual([])
    expect(ballparkEvidenceSentences({ ok: false, reason: 'nothing_heard' })).toEqual([])
  })

  it('drops rows without a price instead of printing a broken sentence', () => {
    const s = ballparkEvidenceSentences({
      ok: true,
      engine: { ok: true, evidence: [{ address: '1 A ST' }, { address: '2 A ST', price: 100000 }] },
    })
    expect(s).toHaveLength(1)
    expect(s[0]).toContain('2 A ST')
  })
})

describe('ballparkIsReady', () => {
  it('is ready only when the preview AND the engine both said ok', () => {
    expect(ballparkIsReady(FRIARS_PREVIEW)).toBe(true)
    expect(ballparkIsReady(null)).toBe(false)
    expect(ballparkIsReady({ ok: true })).toBe(false)
    expect(ballparkIsReady({ ok: true, engine: { ok: false, reason: 'cannot_value' } })).toBe(false)
    expect(ballparkIsReady({ ok: false, engine: { ok: true } })).toBe(false)
  })
})
