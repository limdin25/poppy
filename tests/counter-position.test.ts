// They came back on price. Raise, hold, or pass?
//
// The decision is code's, never a model's. A model asked "should we go up?"
// finds a reason to say yes, because that is where the conversation is
// pulling, and a number said out loud on a property deal cannot be unsaid.

import { describe, it, expect } from 'vitest'
import { decideCounter, respectsCeiling, effectiveCeiling } from '../api/lib/counter-position'

const strong = { evidenceTier: 'strong' as const }

describe('when they are inside our maximum', () => {
  it('meets their figure', () => {
    const d = decideCounter({ ceiling: 100000, currentOffer: 80000, theirFigure: 95000, ...strong })
    expect(d.position).toBe('raise')
    expect(d.newOffer).toBe(95000)
    expect(d.code).toBe('their_figure_within_ceiling')
  })

  it('meets a figure that lands exactly on the ceiling', () => {
    const d = decideCounter({ ceiling: 100000, currentOffer: 80000, theirFigure: 100000, ...strong })
    expect(d.position).toBe('raise')
    expect(d.newOffer).toBe(100000)
  })
})

describe('when they want more than we may pay', () => {
  it('goes to the maximum and calls it the maximum', () => {
    const d = decideCounter({ ceiling: 100000, currentOffer: 80000, theirFigure: 130000, ...strong })
    expect(d.position).toBe('raise')
    expect(d.newOffer).toBe(100000)
    expect(d.code).toBe('raise_to_ceiling_final')
    expect(d.reason).toContain('maximum')
  })

  it('passes once we are already at the maximum', () => {
    const d = decideCounter({ ceiling: 100000, currentOffer: 100000, theirFigure: 130000, ...strong })
    expect(d.position).toBe('pass')
    expect(d.newOffer).toBeNull()
    expect(d.code).toBe('already_at_ceiling')
  })

  it('passes rather than creeping past the ceiling', () => {
    const d = decideCounter({ ceiling: 100000, currentOffer: 105000, theirFigure: 130000, ...strong })
    expect(d.position).toBe('pass')
  })
})

describe('THE INVARIANT: never propose paying more than the ceiling', () => {
  it('holds across a wide sweep of inputs', () => {
    for (let ceiling = 40000; ceiling <= 200000; ceiling += 7000) {
      for (const current of [null, 0.5, 0.9, 1.0, 1.2].map((f) => (f ? Math.round(ceiling * f) : null))) {
        for (const theirs of [null, 0.4, 0.8, 1.0, 1.5, 3].map((f) => (f ? Math.round(ceiling * f) : null))) {
          const d = decideCounter({ ceiling, currentOffer: current, theirFigure: theirs, ...strong })
          expect(respectsCeiling(d, ceiling), JSON.stringify({ ceiling, current, theirs, d })).toBe(true)
          if (d.newOffer !== null) expect(d.newOffer).toBeLessThanOrEqual(ceiling)
        }
      }
    }
  })

  it('a proposal with no ceiling to check against never respects one', () => {
    expect(respectsCeiling({ position: 'raise', newOffer: 90000, reason: '', code: '', figuresAllowed: [] }, null))
      .toBe(false)
  })
})

describe('the two refusals', () => {
  it('holds when there is no maximum on file, rather than guessing one', () => {
    const d = decideCounter({ ceiling: null, currentOffer: 80000, theirFigure: 95000, ...strong })
    expect(d.position).toBe('hold')
    expect(d.newOffer).toBeNull()
    expect(d.code).toBe('no_ceiling')
  })

  it('holds on evidence we would not have made the offer on', () => {
    // 39 Orion Way: valued on `good` comps, another street or another year.
    // Raising on evidence we already call not good enough is the worst of both.
    for (const tier of ['good', 'fair', 'last_resort', '', null]) {
      const d = decideCounter({ ceiling: 100000, currentOffer: 80000, theirFigure: 95000, evidenceTier: tier })
      expect(d.position, `tier ${tier}`).toBe('hold')
      expect(d.code).toBe('evidence_below_standard')
    }
  })

  it('only gold and strong may negotiate at all', () => {
    for (const tier of ['gold', 'strong']) {
      expect(decideCounter({ ceiling: 100000, theirFigure: 95000, evidenceTier: tier }).position)
        .toBe('raise')
    }
  })
})

describe('the real deal: 39 Orion Way', () => {
  // Lexi, 2026-08-14: the vendor rejected GBP 96,375 and wants nearer the
  // GBP 110,000 asking price. Our corrected ceiling is GBP 68,345, on `good`
  // comparables, which is below our own shipping standard.
  const d = decideCounter({
    ceiling: 68345, currentOffer: 96375, theirFigure: 110000, evidenceTier: 'good',
  })

  it('refuses to raise', () => {
    expect(d.position).toBe('hold')
    expect(d.newOffer).toBeNull()
  })

  it('says why in words Hugo can send', () => {
    expect(d.reason).toContain('below our own standard')
    expect(d.reason).toContain('good comparables')
  })

  it('would still refuse even if the evidence were sound, because we are past the ceiling', () => {
    const sound = decideCounter({
      ceiling: 68345, currentOffer: 96375, theirFigure: 110000, evidenceTier: 'strong',
    })
    expect(sound.position).toBe('pass')
    expect(sound.newOffer).toBeNull()
  })
})

describe('it never throws', () => {
  it('survives an empty input', () => {
    const d = decideCounter({})
    expect(d.position).toBe('hold')
    expect(d.newOffer).toBeNull()
  })

  it('parses money out of strings', () => {
    const d = decideCounter({
      ceiling: '£100,000' as never, theirFigure: '95,000' as never, ...strong,
    })
    expect(d.newOffer).toBe(95000)
  })

  it('treats zero and negative as absent', () => {
    expect(decideCounter({ ceiling: 0, theirFigure: 95000, ...strong }).code).toBe('no_ceiling')
  })
})

describe('effectiveCeiling: Hugo\'s written ruling governs, in either direction', () => {
  // Found live on DDM, 16 Aug: the stress test used Math.max while the draft
  // route used the engine alone, so the gate approved a counter the draft
  // refused. One function owns the cap now, and pinned OVERRIDES rather than
  // maxes: a note can lower the appetite as well as raise it.
  it('a pinned ruling above the engine authorises more', () => {
    expect(effectiveCeiling(96375, 102800)).toBe(102800)
  })

  it('a pinned ruling below the engine lowers the cap, never Math.max', () => {
    expect(effectiveCeiling(111500, 90000)).toBe(90000)
  })

  it('no pinned ruling means the engine band stands', () => {
    expect(effectiveCeiling(68345, null)).toBe(68345)
  })

  it('no ceiling anywhere is null, never a guess', () => {
    expect(effectiveCeiling(null, null)).toBeNull()
    expect(effectiveCeiling(0, undefined)).toBeNull()
  })
})
