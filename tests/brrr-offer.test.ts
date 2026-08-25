// The offer maths, and the rule that it is never a percentage of GDV.
//
// This number is said out loud to an estate agent by an agent who is trying to
// buy a house. Getting it wrong does not throw an error, it just loses money
// quietly. Two failure modes have already happened in this codebase's history:
//
//  1. Pricing off GDV. The scraper's valuation engine was rewritten in June
//     2026 because offers were 70-75% of the AFTER-REFURB value with a default
//     £250/sqft, which produced offers ABOVE the asking price. NFStay's tinder
//     module still does it the old way and its screen shows £152,712 on a house
//     that may be listed at £150,000.
//
//  2. Three hand-copies of the same function. api/lib/brrr.ts had the real one,
//     the admin Properties page had a "mirrors offerRange" copy, and Pedro's
//     dialer was about to become the third. They drift silently.
//
// So these tests pin the maths AND pin the single-copy structure.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  offerRange, fmtGBP, gbpShort, ladderText, BEDROOM_UPLIFT_REFURB, upliftRefurb,
  readDealMoney, countComps, vendorFloor, vendorFloorVerdict,
} from '../api/lib/brrr-offer'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const PCT = { offer_low_pct: 70, offer_high_pct: 75 }

describe('offerRange — the valuation engine wins', () => {
  it('uses the engine band when the scraper sent one', () => {
    const band = offerRange(
      { asking_price: 150000, deal: { offer_min: 108000, offer_max: 119500 } },
      PCT,
    )
    expect(band).toEqual({ min: 108000, max: 119500 })
  })

  it('ignores asking price entirely when the engine has spoken', () => {
    // The engine already capped itself below asking. A wildly different asking
    // price must not move the band, or we would be double-applying the cap.
    const a = offerRange({ asking_price: 150000, deal: { offer_min: 108000, offer_max: 119500 } }, PCT)
    const b = offerRange({ asking_price: 900000, deal: { offer_min: 108000, offer_max: 119500 } }, PCT)
    expect(a).toEqual(b)
  })

  it('clamps a min that is somehow above the max', () => {
    const band = offerRange({ asking_price: 150000, deal: { offer_min: 130000, offer_max: 119500 } }, PCT)
    expect(band.min).toBe(119500)
    expect(band.max).toBe(119500)
    expect(band.min).toBeLessThanOrEqual(band.max)
  })

  it('falls back to offer_price when only that is present (older payloads)', () => {
    const band = offerRange({ asking_price: 150000, deal: { offer_price: 112000 } }, PCT)
    expect(band).toEqual({ min: 112000, max: 112000 })
  })

  it('treats a zero or missing offer_max as no engine figure at all', () => {
    const band = offerRange({ asking_price: 200000, deal: { offer_max: 0 } }, PCT)
    expect(band).toEqual({ min: 0, max: 0 }) // no figure, never a fabricated one
  })

  // The shape valuation.py actually emits. Everything above tests the FLAT
  // keys the browser Comps page used to send, and that gap put 157 properties
  // in front of Pedro quoting 70-75% of the asking price with a real valuation
  // sitting in the row underneath. Nothing errored: the fallback just took
  // over, and a plausible wrong number is worse than no number.
  //
  // Live on 2026-08-10, Coniston Avenue NE31, asking GBP 75,000: the screen
  // said open GBP 52,500 / walk away GBP 56,250 while the engine had said
  // GBP 56,500 and GBP 60,900. He would have abandoned deals worth taking.
  it('reads the NESTED shape the valuation engine really returns', () => {
    const band = offerRange(
      { asking_price: 75000, deal: { offer: { open: 56500, max: 60900, ladder: [56500, 58000, 59500, 60900] } } },
      PCT,
    )
    expect(band).toEqual({ min: 56500, max: 60900 })
  })

  it('does not fall back to a percentage when the nested offer is present', () => {
    const band = offerRange({ asking_price: 75000, deal: { offer: { open: 56500, max: 60900 } } }, PCT)
    expect(band.max).not.toBe(56250) // 75% of asking, the old wrong answer
  })

  it('still prefers the nested figure when both shapes are present', () => {
    const band = offerRange(
      { asking_price: 75000, deal: { offer: { open: 56500, max: 60900 }, offer_min: 1, offer_max: 2 } },
      PCT,
    )
    expect(band).toEqual({ min: 56500, max: 60900 })
  })

  it('reads the nested ladder, so the climb is the engine\'s not a made-up one', () => {
    const deal = { offer: { open: 56500, max: 60900, ladder: [56500, 58000, 59500, 60900] } }
    const text = ladderText(deal, offerRange({ asking_price: 75000, deal }, PCT))
    expect(text).toBe('£56,500, then £58,000, then £59,500, then £60,900')
  })
})

describe('offerRange — THE %-OF-ASKING FALLBACK IS DEAD (16 Aug 2026)', () => {
  // It used to fabricate a band at 70-75% of asking when the engine had not
  // priced the house. A silent fallback that produces a plausible number is
  // more dangerous than one that produces none: 157 properties reached
  // Pedro's screen quoting a percentage of the asking price while a real
  // valuation sat underneath. No figure on file now means {0, 0}, which
  // every formatter renders honestly and every send fence refuses.
  it('no engine band means NO band, whatever the asking price', () => {
    for (const asking of [50_000, 200_000, 1_200_000]) {
      expect(offerRange({ asking_price: asking, deal: {} }, PCT)).toEqual({ min: 0, max: 0 })
    }
  })

  it('the settings knobs are accepted and ignored, so no caller breaks', () => {
    expect(offerRange({ asking_price: 200000 }, { offer_low_pct: 10, offer_high_pct: 99 }))
      .toEqual({ min: 0, max: 0 })
    expect(offerRange({ asking_price: 200000 }, null)).toEqual({ min: 0, max: 0 })
    expect(offerRange({ asking_price: 200000 })).toEqual({ min: 0, max: 0 })
  })

  it('survives a missing, null or unparseable asking price without NaN', () => {
    for (const asking of [null, undefined, 0, 'not a number' as unknown as number]) {
      const band = offerRange({ asking_price: asking as number | null }, PCT)
      expect(Number.isFinite(band.min)).toBe(true)
      expect(Number.isFinite(band.max)).toBe(true)
      expect(band).toEqual({ min: 0, max: 0 })
    }
  })

  it('no percentage maths on the asking price survives anywhere in the module', () => {
    const src = read('api/lib/brrr-offer.ts')
    expect(src).not.toMatch(/asking\s*\*\s*(highPct|lowPct)/)
    expect(src).not.toMatch(/offer_(high|low)_pct\s*\?\?/)
  })

  it('the assign script twin dropped its copy of the fallback too', () => {
    const src = read('scripts/assign-properties-to-pedro-houses.mjs')
    expect(src).not.toMatch(/asking_price\)\s*\*\s*(highPct|lowPct)/)
    expect(src).not.toMatch(/\*\s*(high|low)Pct\s*\/\s*100/)
  })
})

describe('money formatting', () => {
  it('says words, not "£0", when there is no figure — this is read aloud', () => {
    for (const v of [0, null, undefined, -5, 'abc']) {
      expect(fmtGBP(v)).toBe('an amount to be discussed')
    }
  })

  it('formats with thousands separators', () => {
    expect(fmtGBP(119500)).toBe('£119,500')
    expect(fmtGBP(1200000)).toBe('£1,200,000')
  })

  it('gbpShort uses a dash for a table cell rather than a sentence', () => {
    expect(gbpShort(0)).toBe('—')
    expect(gbpShort(119500)).toBe('£119,500')
  })
})

describe('ladderText — what the agent actually climbs', () => {
  it('joins the engine ladder in order', () => {
    const t = ladderText({ ladder: [108000, 114000, 119500] }, { min: 108000, max: 119500 })
    expect(t).toBe('£108,000, then £114,000, then £119,500')
  })

  it('falls back to open-and-ceiling when there is no ladder', () => {
    const t = ladderText({}, { min: 108000, max: 119500 })
    expect(t).toContain('£108,000')
    expect(t).toContain('£119,500')
  })

  it('an auction has a maximum, not a ladder', () => {
    const t = ladderText({ ladder: [1, 2, 3] }, { min: 108000, max: 119500 }, true)
    expect(t).toMatch(/AUCTION/)
    expect(t).toContain('£119,500')
    expect(t).not.toContain('then')
  })

  it('drops junk rungs rather than emitting "an amount to be discussed" mid-ladder', () => {
    const t = ladderText({ ladder: [108000, null, 'x', 119500] }, { min: 108000, max: 119500 })
    expect(t).toBe('£108,000, then £119,500')
  })
})

describe('there is exactly ONE copy of this maths', () => {
  it('the admin Properties page no longer defines its own offerBand', () => {
    const page = read('src/features/admin/pages/PropertiesPage.tsx')
    expect(page).not.toMatch(/function offerBand/)
    expect(page).toMatch(/from '\.\.\/\.\.\/\.\.\/\.\.\/api\/lib\/brrr-offer'/)
  })

  it('api/lib/brrr.ts re-exports rather than redefining', () => {
    const brrr = read('api/lib/brrr.ts')
    expect(brrr).toMatch(/export \{ offerRange, fmtGBP.*\} from '\.\/brrr-offer\.js'/)
    expect(brrr).not.toMatch(/export function offerRange/)
    expect(brrr).not.toMatch(/export function fmtGBP/)
  })

  it('brrr-offer.ts stays importable from the browser: no client, no env, no imports', () => {
    // api/lib/brrr.ts calls createClient(process.env.SUPABASE_URL!) at module
    // scope, which throws under Vite. If this file ever grows an import, the
    // dialer's bundle breaks at runtime rather than at build time.
    // Strip comments first: this file EXPLAINS in prose why createClient must
    // stay out of it, and matching on the prose would fail for the wrong reason.
    const code = read('api/lib/brrr-offer.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/createClient/)
    expect(code).not.toMatch(/process\.env/)
    expect(code).not.toMatch(/^import /m)
  })

  it('no file computes an offer as a percentage of GDV', () => {
    // The bug the June rewrite killed. Named here so re-porting NFStay's
    // lib/offer.ts (GDV x 0.70) fails the build instead of the negotiation.
    for (const f of ['api/lib/brrr-offer.ts', 'src/features/admin/pages/PropertiesPage.tsx']) {
      const body = read(f)
      expect(body).not.toMatch(/gdv\s*\*\s*0?\.7/i)
      expect(body).not.toMatch(/OFFER_MAX_BMV_PCT/)
    }
  })
})

// The first refurb estimate in the system that varies by property. valuation.py
// has carried one flat £10,000 for every house since it was written, which
// prices a 3-to-4-bed conversion the same as a 1-to-2.

describe('what it costs to add a bedroom', () => {
  // Rewritten 2026-08-11 with Hugo's real costings. The previous figures
  // (a 2-bed at £16,000) were roughly the low end of the kitchen move alone
  // and carried nothing for the rest of the works. Since £1 of refurb error
  // moves the maximum offer by £1.05, the engine was prepared to overpay by
  // about £20,000 on a 2-bed. Measured over the live batch when this landed:
  // 439 of 441 refinance ceilings dropped, median £19,000.
  it('carries Hugo\'s figures exactly', () => {
    expect(upliftRefurb(1)).toMatchObject({ from: 1, to: 2, low: 22_000, high: 41_000, budget: 31_500 })
    expect(upliftRefurb(2)).toMatchObject({ from: 2, to: 3, low: 26_000, high: 47_000, budget: 36_500 })
    expect(upliftRefurb(3)).toMatchObject({ from: 3, to: 4, low: 32_000, high: 56_000, budget: 44_000 })
    expect(upliftRefurb(4)).toMatchObject({ from: 4, to: 5, low: 37_000, high: 66_000, budget: 51_500 })
  })

  it('keeps the conversion and the refurbishment as separate lines', () => {
    // They are two different jobs and only their sum is what gets spent, so a
    // builder's quote can be argued against the right one.
    expect(upliftRefurb(2)).toMatchObject({
      conversionLow: 13_000, conversionHigh: 23_000,
      refurbLow: 11_000, refurbHigh: 18_000,
      totalLow: 24_000, totalHigh: 41_000,
    })
  })

  it('the budget range already carries the contingency', () => {
    // low/high are the SENSIBLE BUDGET (10-15% contingency inside), so they
    // sit above the bare project total. Anything that multiplies these again
    // is double-counting, which is exactly what valuation.py used to do.
    for (const r of BEDROOM_UPLIFT_REFURB) {
      expect(r.low).toBeGreaterThan(r.totalLow)
      expect(r.high).toBeGreaterThan(r.totalHigh)
      expect(r.totalLow).toBe(r.conversionLow + r.refurbLow)
      expect(r.totalHigh).toBe(r.conversionHigh + r.refurbHigh)
    }
  })

  it('refuses to guess outside the table', () => {
    // There is no row for a studio, or a 5-bed going to 6. Extrapolating one is
    // how a plausible wrong number ends up on screen beside a real valuation,
    // so the honest answer is null and the UI says nothing.
    for (const beds of [0, 5, 6, 9, null, undefined, NaN, 'three' as unknown as number]) {
      expect(`${String(beds)} => ${upliftRefurb(beds as number)}`).toBe(`${String(beds)} => null`)
    }
  })

  it('reads a numeric string, because bedrooms arrive as text from the listing', () => {
    expect(upliftRefurb('2' as unknown as number)?.budget).toBe(36_500)
  })

  it('the budget always sits inside its own range', () => {
    for (const r of BEDROOM_UPLIFT_REFURB) {
      expect(r.low).toBeLessThan(r.high)
      expect(r.budget).toBeGreaterThanOrEqual(r.low)
      expect(r.budget).toBeLessThanOrEqual(r.high)
      expect(r.to).toBe(r.from + 1)
    }
  })
})

describe('the Python twin the scraper imports stays in step', () => {
  // valuation.py runs on the VPS, in Python, in a different git repo, so it
  // cannot import the TypeScript canon. The twin is checked in here so this
  // test can read it; deploying means copying it to /root/scraper.
  const py = read('scripts/lib/bedroom_uplift.py')

  it('holds the same numbers, checked against the TypeScript values', () => {
    for (const r of BEDROOM_UPLIFT_REFURB) {
      // Interpolating the imported constant means the TS side is the source of
      // truth: change it there and this test tells you the twin is stale.
      const row = new RegExp(`\\(${r.from},\\s*${r.to}\\):\\s*\\(${r.low},\\s*${r.high},\\s*${r.budget}\\)`)
      expect(`${r.from}->${r.to}: ${row.test(py)}`).toBe(`${r.from}->${r.to}: true`)
    }
  })

  it('has the same number of rows, so neither side can gain one quietly', () => {
    const rows = py.match(/\(\d,\s*\d\):\s*\(/g) ?? []
    expect(rows).toHaveLength(BEDROOM_UPLIFT_REFURB.length)
  })

  it('returns None outside the table on the Python side too', () => {
    expect(py).toMatch(/return None/)
    expect(py).toMatch(/None means "no figure"/)
  })

  it('names its canon, so whoever edits it knows to edit both', () => {
    expect(py).toMatch(/the Python twin of api\/lib\/brrr-offer\.ts/)
  })
})

// ---------------------------------------------------------------------------
// THE ONE MONEY READER (16 Aug 2026)
// ---------------------------------------------------------------------------
// Before readDealMoney, the same fact was read by hand in eight places that
// disagreed: the dialer read refurb.estimate while the deal state read
// refurb.low, the offer email got the CURRENT value under the key named gdv,
// and four comp counts existed of which the one Pedro says aloud was not the
// canon. These tests pin both the reads and the adoption.

describe('readDealMoney — every money fact, one reader, both shapes', () => {
  const NESTED = {
    offer: { open: 56500, max: 60900, ladder: [56500, 58000, 60900] },
    cmv: { estimate: 81224, confidence: 'high', comps: 5 },
    gdv: { estimate: 106688 },
    tmv: 84000,
    refurb: { low: 13840, basis: 'provisional' },
    comps_tier: 'strong',
  }

  it('reads the nested engine shape', () => {
    const m = readDealMoney({ asking_price: 75000, deal: NESTED })
    expect(m.open).toBe(56500)
    expect(m.ceiling).toBe(60900)
    expect(m.ladder).toEqual([56500, 58000, 60900])
    expect(m.cmv).toBe(81224)
    expect(m.cmvConfidence).toBe('high')
    expect(m.gdv).toBe(106688)
    expect(m.tmv).toBe(84000)
    expect(m.refurb).toBe(13840)
    expect(m.refurbAssumed).toBe(true)
    expect(m.compsTier).toBe('strong')
    expect(m.compsCount).toBe(5)
    expect(m.asking).toBe(75000)
  })

  it('reads the old flat shape (offer_min / offer_max / bare cmv)', () => {
    const m = readDealMoney({ deal: { offer_min: 108000, offer_max: 119500, cmv: 130000, gdv: 150000, refurb: 10000, ladder: [108000, 119500] } })
    expect(m.open).toBe(108000)
    expect(m.ceiling).toBe(119500)
    expect(m.cmv).toBe(130000)
    expect(m.gdv).toBe(150000)
    expect(m.refurb).toBe(10000)
    expect(m.refurbAssumed).toBe(false)
    expect(m.ladder).toEqual([108000, 119500])
  })

  it('reports a bad row RAW: an open above the ceiling is not clamped away', () => {
    // The stress test's open_within_ceiling check has to be able to SEE the
    // contradiction. offerRange clamps for display; the reader never does.
    const m = readDealMoney({ deal: { offer: { open: 130000, max: 119500 } } })
    expect(m.open).toBe(130000)
    expect(m.ceiling).toBe(119500)
    // And a row with a max but no open has NO opener, never the ceiling as one:
    // treating the walk-away as the opener is the exact 16 Aug money bug.
    expect(readDealMoney({ deal: { offer: { max: 96000 } } }).open).toBeNull()
  })

  it('reads every refurb spelling the wild has used', () => {
    expect(readDealMoney({ deal: { refurb: { estimate: 9000 } } }).refurb).toBe(9000)
    expect(readDealMoney({ deal: { refurb_budget: 8000 } }).refurb).toBe(8000)
    expect(readDealMoney({ deal: { refurb_cost: 7000 } }).refurb).toBe(7000)
  })

  it('nulls mean the engine did not say, never a guess', () => {
    const m = readDealMoney({ deal: {} })
    expect(m.open).toBeNull()
    expect(m.ceiling).toBeNull()
    expect(m.cmv).toBeNull()
    expect(m.gdv).toBeNull()
    expect(m.refurb).toBeNull()
    expect(m.ladder).toEqual([])
    expect(m.compsCount).toBe(0)
  })

  it('counts comps by the canon chain: cmv.comps, n_used, audit included, evidence rows', () => {
    expect(countComps({ cmv: { comps: 5 } })).toBe(5)
    expect(countComps({ cmv: { n_used: 3 } })).toBe(3)
    expect(countComps({ cmv: { audit: [{ included: true }, { included: false }, { included: true }] } })).toBe(2)
    expect(countComps({ evidence: [{}, {}] })).toBe(2)
    expect(countComps({})).toBe(0)
  })

  it('compCount in next-step-brief DELEGATES here, it is not a second counter', () => {
    const src = read('api/lib/next-step-brief.ts')
    expect(src).toMatch(/return countComps\(deal\)/)
  })
})

describe('single-reader adoption: nobody reads the blob by hand any more', () => {
  it('the dialer hook, the offer strip, the snapshot drawer and the admin page all import it', () => {
    for (const p of [
      'src/features/crm/hooks/usePropertyListings.ts',
      'src/features/crm/components/live-call/OfferStrip.tsx',
      'src/features/crm/components/calls/DealSnapshotDrawer.tsx',
      'src/features/admin/pages/PropertiesPage.tsx',
      'api/lib/deal-state.ts',
      'api/crm/property-outcome.ts',
      'api/properties/ingest.ts',
      'api/lib/ballpark.ts',
    ]) {
      expect(read(p), p).toMatch(/readDealMoney/)
    }
  })

  it('the offer email payload carries the ceiling and the REAL done-up value', () => {
    // Before 16 Aug offerHouseFor sent cmv under the key named gdv and no
    // ceiling at all, so draft-offer-email's counter fence ran against null.
    const src = read('src/features/crm/hooks/usePropertyListings.ts')
    expect(src).toMatch(/ceiling: m\.ceiling/)
    expect(src).toMatch(/gdv: m\.gdv/)
    expect(src).not.toMatch(/gdv: cmvOf/)
  })

  it('one ladder key: every writer writes `ladder`, none writes offer_ladder', () => {
    for (const p of ['api/lib/ballpark.ts', 'scripts/assign-properties-to-pedro-houses.mjs']) {
      expect(read(p), p).not.toMatch(/offer_ladder:/)
    }
  })

  it('property_worth means worth TODAY everywhere, done-up lives in worth_after_bed', () => {
    // ballpark.ts used to write the engine GDV into property_worth, so the
    // coach read a done-up value out loud as "worth today".
    const ballpark = read('api/lib/ballpark.ts')
    expect(ballpark).not.toMatch(/property_worth: `\$\{money\(Number\(engine\.gdv\)\)/)
    expect(ballpark).toMatch(/worth_after_bed: `\$\{money\(Number\(engine\.gdv\)\)/)
  })
})

// ---------------------------------------------------------------------------
// THE VENDOR'S FLOOR
// ---------------------------------------------------------------------------
//
// The cheapest fact on the call: what has already been turned down. It can kill
// a deal and it can never lift our number, which is the same one-direction rule
// the agent's done-up comparable lives by.
describe('vendorFloor', () => {
  it('reads the figure the call established', () => {
    expect(vendorFloor({ qualification: { rejected_offer: '70000' } })).toBe(70_000)
  })

  it('reads a figure a human typed with pounds and commas', () => {
    expect(vendorFloor({ qualification: { rejected_offer: '£72,500' } })).toBe(72_500)
  })

  it('falls back to the ballpark payload for houses priced before the checklist held it', () => {
    expect(vendorFloor({ deal: { reprice: { rejected_offer: { price: 70_000 } } } })).toBe(70_000)
  })

  it('THE CHECKLIST WINS, so correcting a misheard figure is the repair', () => {
    // A model hearing "seventy" where the agent said "sixty" is fixed on the
    // Houses tab, not forced past: the corrected answer governs from then on.
    expect(vendorFloor({
      qualification: { rejected_offer: '60000' },
      deal: { reprice: { rejected_offer: { price: 70_000 } } },
    })).toBe(60_000)
    // And "no offers" typed over a stale engine figure clears the floor.
    expect(vendorFloor({
      qualification: { rejected_offer: 'nothing has been turned down' },
      deal: { reprice: { rejected_offer: { price: 70_000 } } },
    })).toBeNull()
  })

  it('a misheard number outside the band is no floor at all', () => {
    // "one one eight" arriving as 118 must never kill a deal.
    expect(vendorFloor({ qualification: { rejected_offer: '118' } })).toBeNull()
    expect(vendorFloor({ qualification: { rejected_offer: '9000000' } })).toBeNull()
  })

  it('nothing on file is null, never zero', () => {
    expect(vendorFloor({})).toBeNull()
    expect(vendorFloor({ qualification: {}, deal: {} })).toBeNull()
  })
})

describe('vendorFloorVerdict', () => {
  const deal = { offer: { open: 61_000, max: 68_400 } }

  it('blocks when the floor is above the ceiling, and says both numbers out loud', () => {
    const v = vendorFloorVerdict({ deal, qualification: { rejected_offer: '72000' } })
    expect(v.blocked).toBe(true)
    expect(v.floor).toBe(72_000)
    expect(v.ceiling).toBe(68_400)
    expect(v.reason).toContain('£72,000')
    expect(v.reason).toContain('£68,400')
  })

  it('blocks at exactly the ceiling', () => {
    expect(vendorFloorVerdict({ deal, qualification: { rejected_offer: '68400' } }).blocked).toBe(true)
  })

  it('passes below the ceiling: that is a negotiation, not a dead house', () => {
    const v = vendorFloorVerdict({ deal, qualification: { rejected_offer: '64000' } })
    expect(v.blocked).toBe(false)
    expect(v.reason).toBeNull()
  })

  it('UNKNOWN IS A PASS, on either number', () => {
    expect(vendorFloorVerdict({ deal }).blocked).toBe(false)
    expect(vendorFloorVerdict({ deal: {}, qualification: { rejected_offer: '72000' } }).blocked).toBe(false)
  })

  it('the governing ceiling is passed in, so a pinned ruling can overrule it', () => {
    expect(vendorFloorVerdict({ deal, qualification: { rejected_offer: '72000' } }, 75_000).blocked).toBe(false)
    expect(vendorFloorVerdict({ deal, qualification: { rejected_offer: '64000' } }, 62_000).blocked).toBe(true)
  })

  it('never derives money: the reason quotes the two figures and computes none', () => {
    const v = vendorFloorVerdict({ deal, qualification: { rejected_offer: '72000' } })
    // No split-the-difference, no "try 70,200", nothing that is not on file.
    expect(v.reason).not.toMatch(/£(?!72,000|68,400)[\d,]+/)
  })
})

// The two evidence rules, each written from a row that is in the table today.
describe('a floor has to be evidenced, or it kills real deals', () => {
  it("the quote must contain the figure: five houses share one branch's sentence", () => {
    // Nuttall Road FY, asking 85,000, carrying "he's had enough of 132 which is
    // rejected" because the call listener writes a BRANCH's call onto every
    // house that branch has on file. Four of its neighbours carry it too.
    expect(vendorFloor({
      asking_price: 85_000,
      qualification: {
        rejected_offer: '132000',
        _heard: { rejected_offer: { quote: "he's had enough of 132 which is rejected" } },
      },
    })).toBeNull()
  })

  it('a quote with no figure in it did not produce the figure', () => {
    // Premier Road SR3: answer 117,000, quote "I think that would still be too
    // low." Westminster Avenue and Ford, Queensbury are the same shape.
    expect(vendorFloor({
      asking_price: 99_950,
      qualification: {
        rejected_offer: '117000',
        _heard: { rejected_offer: { quote: 'I think that would still be too low.' } },
      },
    })).toBeNull()
  })

  it('a quote that says the figure in spoken shorthand still counts', () => {
    // Lowther Street PR2: "We had an offer from for 110 uh on Monday from an
    // investor that was rejected", stored as 110000. Real, and it must survive.
    expect(vendorFloor({
      asking_price: 123_000,
      qualification: {
        rejected_offer: '110000',
        _heard: { rejected_offer: { quote: 'We had an offer for 110 on Monday from an investor that was rejected' } },
      },
    })).toBe(110_000)
  })

  it('NO quote at all is a pass: a human typing in the box is the evidence', () => {
    expect(vendorFloor({ asking_price: 123_000, qualification: { rejected_offer: '110000' } })).toBe(110_000)
  })

  it('a refusal far above the asking price belongs to another house', () => {
    // Enfield Road FY1: "they have just declined 130" on a house asking 69,950.
    expect(vendorFloor({ asking_price: 69_950, qualification: { rejected_offer: '130000' } })).toBeNull()
  })

  it('a vendor holding out slightly above asking is believed', () => {
    // Lincoln Road: 132,000 refused on a house asking 130,000. Stubborn, not
    // impossible, and it means our 107,560 ceiling cannot buy it.
    expect(vendorFloor({ asking_price: 130_000, qualification: { rejected_offer: '132000' } })).toBe(132_000)
  })
})

describe('the heard-quote key is the one deal-state owns', () => {
  it('brrr-offer reads the same key the call listener writes', () => {
    // A cycle is not possible (deal-state imports brrr-offer), so the constant
    // is repeated and pinned here instead.
    expect(read('api/lib/deal-state.ts')).toMatch(/export const HEARD_KEY = '_heard'/)
    expect(read('api/lib/brrr-offer.ts')).toMatch(/const HEARD = '_heard'/)
  })
})
