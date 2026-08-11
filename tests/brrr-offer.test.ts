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
import { offerRange, fmtGBP, gbpShort, ladderText, BEDROOM_UPLIFT_REFURB, upliftRefurb } from '../api/lib/brrr-offer'

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
    expect(band).toEqual({ min: 140000, max: 150000 }) // percentage fallback
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

describe('offerRange — the percentage fallback', () => {
  it('is a percentage of ASKING when no valuation was sent', () => {
    const band = offerRange({ asking_price: 200000, deal: {} }, PCT)
    expect(band).toEqual({ min: 140000, max: 150000 })
  })

  it('NEVER exceeds the asking price', () => {
    // The one invariant that matters. Both percentages are of asking and both
    // are below 100, so this holds for any asking price.
    for (const asking of [50_000, 99_950, 150_000, 275_000, 1_200_000]) {
      const band = offerRange({ asking_price: asking }, PCT)
      expect(band.max).toBeLessThan(asking)
      expect(band.min).toBeLessThanOrEqual(band.max)
    }
  })

  it('defaults to 70/75 when settings have not loaded yet', () => {
    // The admin page renders before its settings fetch resolves and passes null.
    expect(offerRange({ asking_price: 200000 }, null)).toEqual({ min: 140000, max: 150000 })
    expect(offerRange({ asking_price: 200000 })).toEqual({ min: 140000, max: 150000 })
  })

  it('survives a missing, null or unparseable asking price without NaN', () => {
    for (const asking of [null, undefined, 0, 'not a number' as unknown as number]) {
      const band = offerRange({ asking_price: asking as number | null }, PCT)
      expect(Number.isFinite(band.min)).toBe(true)
      expect(Number.isFinite(band.max)).toBe(true)
      expect(band).toEqual({ min: 0, max: 0 })
    }
  })

  it('accepts a numeric string asking price (the ingest route may not have parsed it)', () => {
    expect(offerRange({ asking_price: '200000' }, PCT)).toEqual({ min: 140000, max: 150000 })
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
