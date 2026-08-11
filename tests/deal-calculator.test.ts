// Does the deal stack, and how much cash does it take.
//
// Ported from marketplace10 src/features/tinder/lib/gdv.ts, which is Hugo's own
// model and shipped with no tests at all. These are the tests it should have
// had, plus the one real change made on the way across: the purchase price is
// an INPUT (the offer the valuation engine produced) rather than an assumed
// 75% of market value.
//
// This is a decision tool, not a live-call tool. Getting it wrong does not lose
// a negotiation, it loses a house purchase, so the walk-away rules matter most.

import { describe, it, expect } from 'vitest'
import { computeDeal, money, DEAL_ASSUMPTIONS } from '../src/core/lib/dealMaths'

const base = {
  purchase: 87_500,
  marketValue: 116_000,
  refurb: 15_000,
  rentPcm: 750,
  termMonths: 9,
}

describe('the cash it takes on day one', () => {
  it('lends against what it is WORTH, not what we pay', () => {
    // Buying under market value is the entire point of the model: the bridge is
    // 75% of the £116k value, not 75% of the £87.5k price. Getting this
    // backwards understates the loan and overstates the cash needed by
    // thousands.
    const d = computeDeal(base)
    expect(d.bridge).toBe(116_000 * 0.75)
    expect(d.bridge).toBeGreaterThan(base.purchase * 0.75)
  })

  it('adds up: gap + stamp duty + solicitor + surveys', () => {
    const d = computeDeal(base)
    const expected = d.gap + d.sdlt + DEAL_ASSUMPTIONS.solicitor + DEAL_ASSUMPTIONS.surveys
    expect(d.totalCash).toBeCloseTo(expected, 6)
  })

  it('charges bridging interest per month of the term', () => {
    const nine = computeDeal(base)
    const eighteen = computeDeal({ ...base, termMonths: 18 })
    expect(eighteen.interest).toBeCloseTo(nine.interest * 2, 6)
    // A longer bridge eats the net loan, so more cash is needed.
    expect(eighteen.totalCash).toBeGreaterThan(nine.totalCash)
  })

  it('a lower purchase price needs less cash, all else equal', () => {
    const cheaper = computeDeal({ ...base, purchase: 80_000 })
    expect(cheaper.totalCash).toBeLessThan(computeDeal(base).totalCash)
  })
})

describe('the walk-away rules, in order', () => {
  it('walks when the property is worth more than the cap', () => {
    const d = computeDeal({ ...base, marketValue: DEAL_ASSUMPTIONS.marketValueCap + 1 })
    expect(d.verdict.kind).toBe('walk_mv')
  })

  it('walks when the purchase price is over the ceiling', () => {
    const d = computeDeal({ ...base, purchase: DEAL_ASSUMPTIONS.purchaseCeiling + 1 })
    expect(d.verdict.kind).toBe('walk_purchase')
  })

  it('the value cap outranks the purchase ceiling', () => {
    // Both broken at once is still a walk-away on value: cheap does not rescue
    // a property that is simply worth too much for the model.
    const d = computeDeal({
      ...base,
      marketValue: DEAL_ASSUMPTIONS.marketValueCap + 1,
      purchase: DEAL_ASSUMPTIONS.purchaseCeiling + 1,
    })
    expect(d.verdict.kind).toBe('walk_mv')
  })

  it('a walk-away is never downgraded to "needs a partner"', () => {
    // The dangerous direction: reading "needs JV" on a deal that should have
    // been abandoned, and going looking for a partner for it.
    const d = computeDeal({ ...base, marketValue: 200_000, refurb: 0 })
    expect(d.verdict.kind).toBe('walk_mv')
    expect(d.verdict.kind).not.toBe('needs_jv')
  })

  it('says it needs a partner when the cash is over budget but the deal is legal', () => {
    // Force the cash up with a long, expensive bridge rather than by breaking a
    // ceiling, so this isolates the budget rule.
    const d = computeDeal({ ...base, termMonths: 24 })
    expect(d.totalCash).toBeGreaterThan(DEAL_ASSUMPTIONS.cashBudget)
    expect(d.verdict.kind).toBe('needs_jv')
  })

  it('says ok when everything fits', () => {
    const d = computeDeal({ ...base, purchase: 70_000, marketValue: 110_000, termMonths: 6 })
    expect(d.totalCash).toBeLessThanOrEqual(DEAL_ASSUMPTIONS.cashBudget)
    expect(d.verdict.kind).toBe('ok')
  })
})

describe('the refinance scenarios', () => {
  it('gives four, best first', () => {
    const s = computeDeal(base).scenarios
    expect(s).toHaveLength(4)
    expect(s.map((x) => x.upliftPct)).toEqual([0.4, 0.35, 0.3, 0.25])
    expect(s[0].cashBack).toBeGreaterThan(s[3].cashBack)
  })

  it('pays off the bridge AND the refurb before anything comes back', () => {
    const d = computeDeal(base)
    expect(d.scenarios[0].payoff).toBe(d.bridge + base.refurb)
  })

  it('a negative cashBack means money stays in the deal', () => {
    const d = computeDeal({ ...base, refurb: 90_000 })
    expect(d.scenarios[3].cashBack).toBeLessThan(0)
  })

  it('compares what comes out against what went in', () => {
    const d = computeDeal(base)
    for (const s of d.scenarios) {
      expect(s.resultVsCashIn).toBeCloseTo(s.cashBack - d.totalCash, 6)
    }
  })
})

describe('the monthly position', () => {
  it('is rent minus mortgage minus insurance', () => {
    const d = computeDeal(base)
    expect(d.monthly.profit).toBeCloseTo(750 - d.monthly.mortgage - DEAL_ASSUMPTIONS.insurancePcm, 6)
  })

  it('splits 40 / 30 / 30 and the shares total the profit', () => {
    const d = computeDeal(base).monthly
    expect(d.hugoShare + d.partner1Share + d.partner2Share).toBeCloseTo(d.profit, 6)
    expect(d.hugoShare).toBeCloseTo(d.profit * 0.4, 6)
  })

  it('the split fractions total exactly 1', () => {
    const s = DEAL_ASSUMPTIONS.split
    expect(s.hugo + s.partner1 + s.partner2).toBeCloseTo(1, 10)
  })

  it('reports a loss rather than hiding it when the rent will not cover the mortgage', () => {
    const d = computeDeal({ ...base, rentPcm: 100 })
    expect(d.monthly.profit).toBeLessThan(0)
    expect(d.monthly.hugoShare).toBeLessThan(0)
  })
})

describe('rubbish in does not produce NaN', () => {
  it('survives zeroes and negatives', () => {
    for (const input of [
      { purchase: 0, marketValue: 0, refurb: 0, rentPcm: 0, termMonths: 0 },
      { purchase: -5, marketValue: -5, refurb: -5, rentPcm: -5, termMonths: -5 },
      { purchase: NaN, marketValue: NaN, refurb: NaN, rentPcm: NaN, termMonths: NaN },
    ]) {
      const d = computeDeal(input)
      for (const v of [d.bridge, d.totalCash, d.sdlt, d.monthly.profit, d.scenarios[0].cashBack]) {
        expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})

describe('money formatting', () => {
  it('puts the minus outside the pound sign', () => {
    expect(money(-4200)).toBe('-£4,200')
    expect(money(4200)).toBe('£4,200')
    expect(money(0)).toBe('£0')
  })
})

describe('it is Hugo s tool, not the agent s', () => {
  // Rewritten 2026-08-11. Hugo asked for the whole calculator breakdown in
  // Call history ("no more flying blind after the call is made"), so the
  // maths moved to src/core/lib/dealMaths.ts and exactly ONE CRM file may
  // read it: the calls DealSnapshotDrawer, where the sums render for admins
  // only. The DIALER stays clean: Pedro's live-call screen must never carry
  // the cash position or the partner split.
  it('inside the CRM, only the calls snapshot drawer touches the maths, and never the dialer', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { resolve, join } = await import('node:path')
    const root = resolve(__dirname, '..', 'src', 'features', 'crm')
    const allowed = join(root, 'components', 'calls', 'DealSnapshotDrawer.tsx')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.tsx?$/.test(e)) continue
        if (p === allowed) continue
        if (/dealMaths|admin\/components\/DealCalculator/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })

  it('the snapshot drawer gates the sums on isAdmin', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(
      resolve(__dirname, '..', 'src', 'features', 'crm', 'components', 'calls', 'DealSnapshotDrawer.tsx'),
      'utf8',
    )
    expect(src).toMatch(/isAdmin && sums/)
    expect(src).toMatch(/from '@\/core\/lib\/dealMaths'/)
  })
})
