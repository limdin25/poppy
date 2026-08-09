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
import { offerRange, fmtGBP, gbpShort, ladderText } from '../api/lib/brrr-offer'

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
