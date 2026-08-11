// The calibration loop: reading a price out of what an agent actually said,
// and comparing the engine against it.
//
// Hugo, 2026-08-11, on being told no valuation had ever been checked against
// reality: "yes wire it". The parser is the gate into that dataset, so a bad
// parse is worse than no parse: it would calibrate the engine against noise.
// Every case below is a real shape of note, or a real way this could go wrong.
import { describe, it, expect } from 'vitest'
import { parseSpokenPrice, calibrate } from '../api/lib/price-feedback'

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
