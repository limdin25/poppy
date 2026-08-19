// The three things the deal engine CONCLUDES, and the one rule about them:
// they are read, never worked out.
//
// Pedro reads the strip above his script down a live phone line to an estate
// agent. The dangerous failure here is not a crash, it is a confident wrong
// answer: a band that says STRONG DEAL on a house nobody graded, a strategy
// carried over from the previous listing, a condition read of "unknown"
// dressed up as a reason to buy. Every test below is one of those.
//
// BMV cannot be recomputed in this repo at all. BMV = 1 - purchase / TMV and
// TMV = GDV - refurb, and the refurb figure never crosses from the scraper into
// Elsie. Anything derived here would be measured against the wrong denominator,
// look entirely reasonable, and be wrong.

import { describe, it, expect } from 'vitest'
import {
  dealStrategy, dealBmvBand, dealConditionBand, conditionClause,
  dealReasonLine, outcodeOf, pluckString,
} from '../api/lib/brrr-deal-facts'

/** A fully valued property exactly as the engine writes one today: nested
 *  cmv / gdv / offer, and NOT ONE of the new conclusion fields. This is what
 *  every property in the table looks like right now. */
const TODAY = {
  asking_price: 130_000,
  deal: {
    cmv: { estimate: 160_759, confidence: 'low', n_used: 5 },
    gdv: { estimate: 208_987, confidence: 'low' },
    offer: { open: 104_000, max: 112_500, ladder: [104_000, 112_500], verdict: 'fair' },
    stack: { ceiling: 119_000, left_in: 13_634, verdict: 'marginal' },
    pursue: true,
  },
}

describe('nothing is invented from the numbers that ARE there', () => {
  it('a fully valued property with no band gets no band', () => {
    // The whole point. This deal has an open, a ceiling, a CMV and a GDV, and
    // 1 - 104000/160759 is 35%, which would read as a STRONG DEAL. It is not
    // a BMV, because BMV is measured against GDV minus refurb and the refurb
    // never reaches this repo. Silence is the only correct answer.
    expect(dealBmvBand(TODAY)).toBeNull()
    expect(dealStrategy(TODAY)).toBeNull()
    expect(dealConditionBand(TODAY)).toBeNull()
    expect(dealReasonLine(TODAY, ['11 KILBURN DRIVE sold for £143,000 (2023-03-17)'])).toBe('')
  })

  it('a sold comparable on its own is never a reason to buy', () => {
    // It is already one click away in the Houses tab. On the strip, on its
    // own, it reads as the engine having judged something it has not.
    expect(dealReasonLine({ deal: {} }, ['12 Bedford St sold for £114,000'])).toBe('')
  })
})

describe('the strategy chip', () => {
  it('reads the three Hugo picked, however they are written', () => {
    expect(dealStrategy({ deal: { strategy: 'brrr' } })).toBe('BRRR')
    expect(dealStrategy({ deal: { strategy: 'BRRR' } })).toBe('BRRR')
    expect(dealStrategy({ deal: { strategy: 'flip' } })).toBe('FLIP')
    expect(dealStrategy({ deal: { strategy: ' HMO ' } })).toBe('HMO')
  })

  it('finds it nested, because the engine nests everything else', () => {
    expect(dealStrategy({ deal: { appraisal: { strategy: 'flip' } } })).toBe('FLIP')
    expect(dealStrategy({ deal: { offer: { strategy: 'hmo' } } })).toBe('HMO')
  })

  it('shows a strategy it does not recognise rather than hiding it', () => {
    expect(dealStrategy({ deal: { strategy: 'turnkey_btl' } })).toBe('TURNKEY BTL')
  })

  it('refuses a sentence pretending to be a strategy', () => {
    // A chip sits beside three figures on a 380px column. Anything this long
    // is not a label and would push the money off the screen.
    expect(dealStrategy({ deal: { strategy: 'we should probably flip this one honestly' } })).toBeNull()
  })

  it('is silent on an empty or missing value', () => {
    expect(dealStrategy({ deal: { strategy: '' } })).toBeNull()
    expect(dealStrategy({ deal: {} })).toBeNull()
    expect(dealStrategy({})).toBeNull()
    expect(dealStrategy({ deal: null })).toBeNull()
  })
})

describe('the BMV band, which tells Pedro how hard to push', () => {
  it('reads the three bands and gives each its own instruction', () => {
    expect(dealBmvBand({ deal: { bmv_band: 'thin' } })?.label).toBe('THIN DEAL')
    expect(dealBmvBand({ deal: { bmv_band: 'meets_criteria' } })?.label).toBe('MEETS CRITERIA')
    expect(dealBmvBand({ deal: { bmv_band: 'strong' } })?.label).toBe('STRONG DEAL')
    // Three bands, three different things to do on the call. If two of them
    // said the same thing the band would not be worth showing.
    const notes = ['thin', 'meets_criteria', 'strong']
      .map((b) => dealBmvBand({ deal: { bmv_band: b } })?.note)
    expect(new Set(notes).size).toBe(3)
  })

  it('reads it however it is spelled', () => {
    expect(dealBmvBand({ deal: { bmv_band: 'MEETS CRITERIA' } })?.code).toBe('meets_criteria')
    expect(dealBmvBand({ deal: { bmv_band: 'meets-criteria' } })?.code).toBe('meets_criteria')
    expect(dealBmvBand({ deal: { appraisal: { bmv_band: ' Strong ' } } })?.code).toBe('strong')
  })

  it('quotes no percentages, because the thresholds are config on the engine', () => {
    // Printing "15 to 20%" here would eventually print a wrong range the day
    // somebody tunes the gate, and Pedro would read it as fact.
    for (const b of ['thin', 'meets_criteria', 'strong']) {
      const band = dealBmvBand({ deal: { bmv_band: b } })!
      expect(`${band.label} ${band.note}`).not.toMatch(/\d/)
    }
  })

  it('refuses a band it cannot act on', () => {
    // A word Pedro cannot turn into a decision is worse than no word, because
    // it still occupies the space where a real grade would be.
    expect(dealBmvBand({ deal: { bmv_band: 'excellent' } })).toBeNull()
    expect(dealBmvBand({ deal: { bmv_band: 'medium' } })).toBeNull()
    expect(dealBmvBand({ deal: { bmv_band: '25%' } })).toBeNull()
  })

  it('is not fooled by a percentage sitting next to it', () => {
    // A number is not a band. If the engine one day sends only a percentage,
    // this must stay silent rather than band it against thresholds this repo
    // has no business holding a copy of.
    expect(dealBmvBand({ deal: { bmv_pct: 27.4 } })).toBeNull()
  })
})

describe('the condition read', () => {
  it('reads the bands the eye reports', () => {
    expect(dealConditionBand({ deal: { condition_band: 'full_refurb' } })).toBe('full_refurb')
    expect(dealConditionBand({ deal: { survey: { condition_band: 'Modernisation' } } })).toBe('modernisation')
  })

  it('treats "unknown" as nothing said, because that is what it means', () => {
    // Unknown on roughly a third of properties. "Condition: unknown" is not a
    // reason to buy a house and must never render as one.
    expect(dealConditionBand({ deal: { condition_band: 'unknown' } })).toBeNull()
    expect(conditionClause({ deal: { condition_band: 'unknown' } })).toBeNull()
    expect(dealReasonLine({ deal: { condition_band: 'unknown' } }, ['a comp'])).toBe('')
  })
})

describe('the reason line', () => {
  it('builds the sentence the plan asked for', () => {
    expect(
      dealReasonLine(
        { deal: { condition_band: 'full_refurb' } },
        ['3 beds on this street sold at £100,000'],
      ),
    ).toBe('needs a full refurb, 3 beds on this street sold at £100,000')
  })

  it('says the condition alone when there is no comp behind it', () => {
    expect(dealReasonLine({ deal: { condition_band: 'modernisation' } }, [])).toBe('needs modernising')
    expect(dealReasonLine({ deal: { condition_band: 'modernisation' } })).toBe('needs modernising')
  })

  it('prefers the engine\'s own sentence when it wrote one', () => {
    expect(
      dealReasonLine({ deal: { reason: 'unmortgageable, no kitchen, priced for cash' } }, ['a comp']),
    ).toBe('unmortgageable, no kitchen, priced for cash')
  })

  it('never returns a dash, a placeholder or the word undefined', () => {
    for (const deal of [null, {}, { condition_band: '' }, { condition_band: 'unknown' }]) {
      const line = dealReasonLine({ deal }, [])
      expect(line).toBe('')
      expect(line).not.toMatch(/undefined|null|—|-{1,2}$/)
    }
  })
})

describe('the lookup itself', () => {
  it('takes the top level before anything nested', () => {
    expect(pluckString({ strategy: 'flip', deep: { strategy: 'hmo' } }, 'strategy')).toBe('flip')
  })

  it('never lets a row inside a list answer for the whole deal', () => {
    // deal.cmv.audit is an array of comparables and deal.audit.checks is an
    // array of auditor findings. Either could one day carry a key with the
    // same name, and one comparable does not grade a property.
    expect(pluckString({ audit: [{ strategy: 'flip' }] }, 'strategy')).toBeNull()
    expect(dealBmvBand({ deal: { cmv: { audit: [{ bmv_band: 'strong' }] } } })).toBeNull()
  })

  it('ignores a value that is not a string', () => {
    expect(pluckString({ strategy: 3 }, 'strategy')).toBeNull()
    expect(pluckString({ strategy: true }, 'strategy')).toBeNull()
  })

  it('survives a deal blob that is not an object', () => {
    expect(pluckString(null, 'strategy')).toBeNull()
    expect(pluckString(undefined, 'strategy')).toBeNull()
  })
})

describe('the outcode, for the calibration report', () => {
  it('reads the postcode off a scraped address', () => {
    expect(outcodeOf('Willows End, Scraptoft Leicester, LE7 9TT')).toBe('LE7')
    expect(outcodeOf('Witney Street, Sheffield, S8 0ZY')).toBe('S8')
    expect(outcodeOf('Whitehall Road, Leeds, West Yorkshire, LS12 5NL')).toBe('LS12')
    expect(outcodeOf('Preston Old Road, Blackpool, Lancashire, FY3, FY3 9QX')).toBe('FY3')
  })

  it('reads a postcode folded into the town part (found live 2026-08-19)', () => {
    // The first Ballpark-agreed deal: Rightmove wrote town and postcode as one
    // comma part, and the whole-part tests filed a real B44 under "unknown".
    expect(outcodeOf('Oundle Road, Kingstanding, Birmingham B44 8EP')).toBe('B44')
    expect(outcodeOf('Willows End, Scraptoft Leicester LE7 9TT')).toBe('LE7')
    // A bare trailing outcode without the inward half stays unmatched inside a
    // part: "FY3" alone could be a building name abbreviation, so only the
    // full unambiguous postcode is read out of a folded part.
    expect(outcodeOf('Something Road, Town B44')).toBeNull()
  })

  it('accepts an address that only carries the outcode', () => {
    expect(outcodeOf('Morfa Gardens, Coundon, Coventry, CV6')).toBe('CV6')
    expect(outcodeOf('Coniston Avenue, Hebburn, NE31')).toBe('NE31')
  })

  it('says nothing rather than guessing an area', () => {
    // A report that files a property under the wrong outcode is worse than one
    // that files it under "unknown": it moves a real area's median.
    expect(outcodeOf('Flat 2, 14 High Street')).toBeNull()
    expect(outcodeOf('')).toBeNull()
    expect(outcodeOf(null)).toBeNull()
    // A Canadian postal code has the same shape as a British one until you
    // look at the second half. This repo has been bitten by that before.
    expect(outcodeOf('123 Danforth Ave, Toronto, M1J 3C9')).toBeNull()
  })
})
