// The classifier run over EVERY real inbound email in the system.
//
// Fixture captured 2026-08-14 from wk_sms_messages so this keeps working
// without a database. It exists because two bugs only showed up on real mail:
// phone numbers in a signature read as prices, and "does not accept liability"
// in a virus footer read as a rejection.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyByRules } from '../api/lib/inbound-classify'

const FIXTURE = resolve(__dirname, 'fixtures', 'inbound-emails.json')

describe.skipIf(!existsSync(FIXTURE))('every real inbound email', () => {
  const emails: Array<{ subject: string; body: string; from: string }> =
    JSON.parse(readFileSync(FIXTURE, 'utf8'))

  it('has a fixture worth testing', () => {
    expect(emails.length).toBeGreaterThan(50)
  })

  it('never invents a price out of a signature or a reference number', () => {
    for (const e of emails) {
      const r = classifyByRules(e.subject, e.body)
      for (const f of r.figuresMentioned) {
        // Nothing we deal in is worth eight figures. A number that big came
        // from a phone number, a reference or a date.
        expect(f, `${e.subject}: ${f}`).toBeLessThan(10_000_000)
      }
    }
  })

  it('does not cry rejection across the whole corpus', () => {
    const rejections = emails.filter((e) => {
      const k = classifyByRules(e.subject, e.body).kind
      return k === 'rejection' || k === 'counter_offer'
    })
    // Exactly one real rejection exists in this corpus: Lexi at DDM on
    // 2026-08-14 about 39 Orion Way. Before the disclaimer fix this returned
    // 32, because every virus footer said "does not accept liability".
    expect(rejections.length).toBeLessThanOrEqual(3)
  })

  it('finds Lexi', () => {
    const lexi = emails.find((e) => /orion way/i.test(e.body))
    expect(lexi, 'the Orion Way email should be in the fixture').toBeTruthy()
    const r = classifyByRules(lexi!.subject, lexi!.body)
    expect(r.kind).toBe('counter_offer')
    expect(r.figuresMentioned).toEqual(expect.arrayContaining([110000]))
  })
})
