// The calibration loop: reading a price out of what an agent actually said,
// and comparing the engine against it.
//
// Hugo, 2026-08-11, on being told no valuation had ever been checked against
// reality: "yes wire it". The parser is the gate into that dataset, so a bad
// parse is worse than no parse: it would calibrate the engine against noise.
// Every case below is a real shape of note, or a real way this could go wrong.
import { describe, it, expect } from 'vitest'
import {
  parseSpokenPrice, calibrate, calibrateBy, valuationVerdict, refurbVerdict,
} from '../api/lib/price-feedback'

describe('reading the figure out of what the branch said', () => {
  it('reads the plain ways people write a price', () => {
    expect(parseSpokenPrice('£140,000', 150_000).price).toBe(140_000)
    expect(parseSpokenPrice('140,000', 150_000).price).toBe(140_000)
    expect(parseSpokenPrice('140k', 150_000).price).toBe(140_000)
    expect(parseSpokenPrice('140K', 150_000).price).toBe(140_000)
  })

  it('reads a figure buried in a sentence', () => {
    // Alan Cooper, 2026-08-10, the first figure any branch ever gave us.
    expect(parseSpokenPrice('looking around the 140 Mark', 140_000).price).toBe(140_000)
    expect(parseSpokenPrice('they said offers over 125,000 would do it', 130_000).price).toBe(125_000)
    expect(parseSpokenPrice("vendor would take 95 for a quick sale", 100_000).price).toBe(95_000)
  })

  it('treats a bare small number as thousands, because nobody sells a house for 140 pounds', () => {
    expect(parseSpokenPrice('140', 145_000).price).toBe(140_000)
  })

  it('picks the figure about THIS house when the note holds several', () => {
    // "they paid 95 in 2019 and want 140 now" on a house asking 145,000
    expect(parseSpokenPrice('paid 95 in 2019, want 140 now', 145_000).price).toBe(140_000)
  })

  it('refuses a number that is nowhere near the asking price', () => {
    // "3 viewings booked, 2 offers" must never become a £3,000 valuation.
    const r = parseSpokenPrice('3 viewings booked, 2 offers', 120_000)
    expect(r.price).toBeNull()
    expect(r.reason).toBeTruthy()
  })

  it('refuses a lease length, a service charge and a ground rent', () => {
    // "89 years left on the lease" on a house asking £120,000 would otherwise
    // record a vendor figure of £89,000: near enough to asking to look sane,
    // and pure poison in the dataset that judges our valuations.
    expect(parseSpokenPrice('89 years left on the lease', 120_000).price).toBeNull()
    expect(parseSpokenPrice('service charge 1,200 a year', 120_000).price).toBeNull()
    expect(parseSpokenPrice('ground rent 250', 120_000).price).toBeNull()
  })

  it('reads the price past the property description', () => {
    // The commonest note shape of all: facts first, then the number.
    expect(parseSpokenPrice('2 bed flat, 3 viewings, they want 140', 150_000).price).toBe(140_000)
  })

  it('says nothing when nothing was said', () => {
    expect(parseSpokenPrice('', 120_000).price).toBeNull()
    expect(parseSpokenPrice(null, 120_000).price).toBeNull()
    expect(parseSpokenPrice(undefined).price).toBeNull()
    expect(parseSpokenPrice('would not say', 120_000).price).toBeNull()
  })

  it('is strict when there is no asking price to judge against', () => {
    expect(parseSpokenPrice('140k', null).price).toBe(140_000)
    // Two numbers and nothing to disambiguate them: refuse rather than guess.
    expect(parseSpokenPrice('paid 95, wants 140', null).price).toBeNull()
  })

  it('never returns a number outside a plausible house price', () => {
    expect(parseSpokenPrice('call me on 07700900123', 120_000).price).toBeNull()
    expect(parseSpokenPrice('12,000,000', 120_000).price).toBeNull()
  })
})

describe('judging the engine against what they said', () => {
  const row = (said: number | null, cmv: number, asking: number, max: number, conf = 'medium') => ({
    said_price: said, cmv, asking_price: asking, offer_max: max, cmv_confidence: conf,
  })

  it('reports nothing at all from no data, rather than a confident zero', () => {
    const c = calibrate([])
    expect(c.n).toBe(0)
    expect(c.vsCmv).toBeNull()
    expect(c.vsAsking).toBeNull()
    expect(c.withinCeilingPct).toBeNull()
  })

  it('ignores rows where no figure could be read', () => {
    expect(calibrate([row(null, 100_000, 120_000, 75_000)]).n).toBe(0)
  })

  it('says the engine is low when branches talk above its valuation', () => {
    const c = calibrate([
      row(120_000, 100_000, 130_000, 75_000),
      row(110_000, 100_000, 130_000, 75_000),
      row(130_000, 100_000, 130_000, 75_000),
    ])
    expect(c.n).toBe(3)
    expect(c.vsCmv).toBeCloseTo(1.2, 5)
  })

  it('uses the median, so one silly note cannot move it', () => {
    const c = calibrate([
      row(100_000, 100_000, 120_000, 75_000),
      row(105_000, 100_000, 120_000, 75_000),
      row(900_000, 100_000, 120_000, 75_000), // a wild one
    ])
    expect(c.vsCmv).toBeCloseTo(1.05, 5)
  })

  it('counts how many of their figures we could actually have paid', () => {
    const c = calibrate([
      row(70_000, 100_000, 120_000, 75_000),  // inside
      row(80_000, 100_000, 120_000, 75_000),  // above our ceiling
    ])
    expect(c.withinCeiling).toBe(1)
    expect(c.withinCeilingPct).toBeCloseTo(0.5, 5)
  })

  it('splits by the confidence the engine claimed, which is the point', () => {
    const c = calibrate([
      row(120_000, 100_000, 130_000, 75_000, 'low'),
      row(140_000, 100_000, 130_000, 75_000, 'low'),
      row(101_000, 100_000, 130_000, 75_000, 'high'),
    ])
    expect(c.byConfidence.low.n).toBe(2)
    expect(c.byConfidence.low.vsCmv).toBeCloseTo(1.3, 5)
    expect(c.byConfidence.high.vsCmv).toBeCloseTo(1.01, 5)
  })

  it('shows how far branches come down from the advert', () => {
    const c = calibrate([
      row(90_000, 100_000, 100_000, 75_000),
      row(80_000, 100_000, 100_000, 75_000),
      row(85_000, 100_000, 100_000, 75_000),
    ])
    expect(c.vsAsking).toBeCloseTo(0.85, 5)
  })
})

// The weekly report, Stage 8. The value of this thing is that somebody changes
// a rate card or a comps radius because of it, so a wrong reading here costs
// real money on the scraper box. Everything below is a way of being wrong.
describe('cutting the calibration by outcode and by condition', () => {
  const row = (
    said: number | null, cmv: number, asking: number, max: number,
    extra: Partial<{ outcode: string | null; condition_band: string | null; offer_open: number }> = {},
  ) => ({
    said_price: said, cmv, asking_price: asking, offer_max: max, cmv_confidence: 'medium',
    ...extra,
  })

  it('keeps each area to its own median', () => {
    const groups = calibrateBy([
      row(120_000, 100_000, 130_000, 75_000, { outcode: 'FY1' }),
      row(130_000, 100_000, 130_000, 75_000, { outcode: 'FY1' }),
      row(101_000, 100_000, 130_000, 75_000, { outcode: 'NE31' }),
    ], (r) => r.outcode)
    expect(groups.map((g) => g.key)).toEqual(['FY1', 'NE31'])
    expect(groups[0].vsCmv).toBeCloseTo(1.25, 5)
    expect(groups[1].vsCmv).toBeCloseTo(1.01, 5)
  })

  it('files a row with no area under unknown rather than into a real one', () => {
    // A misfiled row does not just lose itself, it moves a real area's median
    // and that is what somebody would act on.
    const groups = calibrateBy([
      row(120_000, 100_000, 130_000, 75_000, { outcode: null }),
      row(120_000, 100_000, 130_000, 75_000, { outcode: '' }),
    ], (r) => r.outcode)
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('unknown')
    expect(groups[0].n).toBe(2)
  })

  it('drops the unreadable notes from every group, exactly like the headline', () => {
    const groups = calibrateBy([
      row(null, 100_000, 130_000, 75_000, { outcode: 'S8' }),
      row(110_000, 100_000, 130_000, 75_000, { outcode: 'S8' }),
    ], (r) => r.outcode)
    expect(groups[0].n).toBe(1)
  })

  it('puts the biggest sample first, so a group of one is never the headline', () => {
    const groups = calibrateBy([
      row(120_000, 100_000, 130_000, 75_000, { outcode: 'LS12' }),
      row(120_000, 100_000, 130_000, 75_000, { outcode: 'CV6' }),
      row(120_000, 100_000, 130_000, 75_000, { outcode: 'CV6' }),
    ], (r) => r.outcode)
    expect(groups[0].key).toBe('CV6')
    expect(groups[0].n).toBe(2)
  })

  it('reports our offer against their number, which is the whole report', () => {
    const c = calibrate([
      row(120_000, 100_000, 130_000, 90_000, { offer_open: 80_000 }),
      row(100_000, 100_000, 130_000, 90_000, { offer_open: 80_000 }),
    ])
    // 1.5 and 1.25, median 1.375.
    expect(c.vsOffer).toBeCloseTo(1.375, 5)
  })

  it('says n/a rather than a confident 1.0 when we never opened at anything', () => {
    expect(calibrate([row(120_000, 100_000, 130_000, 90_000)]).vsOffer).toBeNull()
  })
})

describe('what the report says out loud', () => {
  it('refuses to read anything into three calls', () => {
    // The dataset starts at zero and grows one call at a time. A verdict off
    // two rows would be the first thing anybody read and the first thing they
    // acted on.
    expect(valuationVerdict(1.4, 3)).toMatch(/too few/i)
    expect(valuationVerdict(null, 50)).toMatch(/too few/i)
  })

  it('names the direction, because the two directions need opposite fixes', () => {
    expect(valuationVerdict(1.3, 20)).toMatch(/running low/i)
    expect(valuationVerdict(0.7, 20)).toMatch(/optimistic/i)
    expect(valuationVerdict(1.0, 20)).toMatch(/agree within 5%/i)
  })

  it('will not call a refurb drift off one condition band', () => {
    // The refurb read is a COMPARISON between bands. With one band there is
    // nothing to compare it to, and "unknown" is not a band.
    const g = (key: string, n: number, withinCeilingPct: number) => ({
      key, n, withinCeilingPct, vsCmv: 1, vsAsking: 1, vsOffer: 1,
      withinCeiling: Math.round(n * withinCeilingPct), byConfidence: {},
    })
    expect(refurbVerdict([g('full_refurb', 20, 0.2)])).toMatch(/not enough/i)
    expect(refurbVerdict([g('unknown', 90, 0.2), g('turnkey', 20, 0.9)])).toMatch(/not enough/i)
    expect(refurbVerdict([g('full_refurb', 20, 0.2), g('turnkey', 20, 0.9)]))
      .toMatch(/refurb estimate, not the valuation/i)
    // Close together is not a drift.
    expect(refurbVerdict([g('full_refurb', 20, 0.5), g('turnkey', 20, 0.55)]))
      .toMatch(/no clear refurb drift/i)
  })

  it('never writes a long dash or a curly quote', () => {
    const all = [
      valuationVerdict(1.3, 20), valuationVerdict(0.7, 20), valuationVerdict(1.0, 20),
      valuationVerdict(1.1, 20), valuationVerdict(0.9, 20), valuationVerdict(1, 1),
      refurbVerdict([]),
    ].join(' ')
    expect(all).not.toMatch(/[‐-―‘’“”…]/)
  })
})

describe('the loop is actually wired in, not just written', () => {
  it('the outcome route records the figure with the engine numbers frozen beside it', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '..', 'api', 'crm', 'property-outcome.ts'), 'utf8')
    expect(src).toMatch(/parseSpokenPrice/)
    expect(src).toMatch(/brrr_price_feedback/)
    // Frozen copies, never a join: deals are re-priced nightly.
    for (const field of ['asking_price', 'cmv', 'cmv_confidence', 'gdv', 'offer_max']) {
      expect(src).toMatch(new RegExp(`${field}:`))
    }
  })

  it('measuring can never fail a real call', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '..', 'api', 'crm', 'property-outcome.ts'), 'utf8')
    expect(src).toMatch(/\.then\(undefined, \(\) => \{\}\)/)
  })

  it('the outcode and the condition band are FROZEN with the rest', async () => {
    // Both are read at the moment of the call, not joined later. A property is
    // re-priced and re-surveyed every night, so a join would compare a Tuesday
    // call to Friday's survey and the calibration would drift on its own.
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '..', 'api', 'crm', 'property-outcome.ts'), 'utf8')
    expect(src).toMatch(/outcode: outcodeOf\(property\.address\)/)
    expect(src).toMatch(/condition_band: dealConditionBand\(/)
  })

  it('the weekly report exists, is scheduled, and stays quiet on an empty table', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const root = resolve(__dirname, '..')
    const cron = readFileSync(resolve(root, 'api', 'cron', 'price-feedback-weekly.ts'), 'utf8')
    // Both cuts, which is the entire ask of Stage 8.
    expect(cron).toMatch(/calibrateBy\(withOutcode, \(r\) => r\.outcode\)/)
    expect(cron).toMatch(/calibrateBy\(withOutcode, \(r\) => r\.condition_band\)/)
    // No figures on file means no email. A weekly "nothing happened" is how a
    // report gets filtered into a folder nobody opens.
    expect(cron).toMatch(/no figures on file/)
    // Every number is arithmetic. No model is asked to interpret this table.
    expect(cron).not.toMatch(/anthropic|claude|gemini/i)

    const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>
    }
    const entry = vercel.crons.find((c) => c.path === '/api/cron/price-feedback-weekly')
    expect(entry).toBeTruthy()
    // Weekly, on a Monday.
    expect(entry!.schedule).toMatch(/\* \* 1$/)
  })

  it('the admin page reports it', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const api = readFileSync(resolve(__dirname, '..', 'api', 'admin', 'properties', 'index.ts'), 'utf8')
    expect(api).toMatch(/calibrate\(/)
    const page = readFileSync(
      resolve(__dirname, '..', 'src', 'features', 'admin', 'pages', 'PropertiesPage.tsx'), 'utf8')
    expect(page).toMatch(/CalibrationPanel/)
    // It must stay quiet until the sample means something.
    expect(page).toMatch(/n < 5/)
  })
})
