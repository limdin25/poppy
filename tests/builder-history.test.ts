// A builder's answer on one house has to be visible on the next one.
//
// Pedro, 2026-09-16: "I called this builder now and he said I've called him 4
// times already for a different property but there is no indication in the
// disposition that they are not interested or charging to view... with this
// other property it is not permanently indicated, so I still make a mistake of
// calling them."
//
// The two FOREVER flags added on 10 September do travel between houses and they
// work (six builders carry one). Every other outcome did not, because a builder
// row is a builder FOR ONE HOUSE.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  summariseBuilderHistory,
  callOutcomeLabel,
  NEGATIVE_OUTCOMES,
  CALL_OUTCOMES,
} from '../api/lib/builder-outreach'

const ROUTE = readFileSync('api/crm/find-builders.ts', 'utf8')
const TABLE = readFileSync('src/features/crm/components/builders/BuilderTable.tsx', 'utf8')

describe('what the builder said about other houses', () => {
  it('four no-answers read as four calls, with the last one named', () => {
    const h = summariseBuilderHistory([
      { call_outcome: 'no_answer', call_outcome_at: '2026-09-10T09:00:00Z', address: 'Grappenhall Road, Great Sutton, CH65' },
      { call_outcome: 'no_answer', call_outcome_at: '2026-09-11T09:00:00Z', address: 'Grappenhall Road, Great Sutton, CH65' },
      { call_outcome: 'no_answer', call_outcome_at: '2026-09-12T09:00:00Z', address: 'Grappenhall Road, Great Sutton, CH65' },
      { call_outcome: 'not_interested', call_outcome_at: '2026-09-15T16:08:00Z', address: 'Grappenhall Road, Great Sutton, CH65' },
    ])
    expect(h.calls).toBe(4)
    expect(h.saidNo).toBe(true)
    expect(h.lastLabel).toBe('Not interested (this house)')
    expect(h.summary).toBe('Rung 4 times before. Last answer: Not interested (this house) on Grappenhall Road.')
  })

  it('takes the newest answer even when the rows arrive out of order', () => {
    const h = summariseBuilderHistory([
      { call_outcome: 'charges_to_view', call_outcome_at: '2026-09-15T14:00:00Z', address: 'Poulton Road, Fleetwood' },
      { call_outcome: 'call_back', call_outcome_at: '2026-09-01T10:00:00Z', address: 'North Street, Colne' },
    ])
    expect(h.lastOutcome).toBe('charges_to_view')
    expect(h.lastHouse).toBe('Poulton Road')
  })

  it('one call reads as once, not "1 times"', () => {
    const h = summariseBuilderHistory([
      { call_outcome: 'call_back', call_outcome_at: '2026-09-15T14:00:00Z', address: 'Lorne Street, Kidderminster' },
    ])
    expect(h.summary).toBe('Rung once before. Last answer: Call back later on Lorne Street.')
    expect(h.saidNo).toBe(false)
  })

  it('a builder nobody has rung has nothing to say', () => {
    expect(summariseBuilderHistory([]).summary).toBeNull()
    expect(summariseBuilderHistory([{ call_outcome: null, call_outcome_at: null }]).calls).toBe(0)
  })

  it('counts the refusals as refusals, and a call back as still open', () => {
    for (const id of ['not_interested', 'not_interested_any', 'charges_to_view', 'wrong_number']) {
      expect(NEGATIVE_OUTCOMES.has(id), id).toBe(true)
    }
    for (const id of ['coming', 'wants_details', 'call_back', 'no_answer']) {
      expect(NEGATIVE_OUTCOMES.has(id), id).toBe(false)
    }
  })

  it('every outcome the dropdown offers has a label', () => {
    for (const o of CALL_OUTCOMES) expect(callOutcomeLabel(o.id)).toBe(o.label)
  })
})

describe('the desk actually asks for it', () => {
  it('reads outcomes from the OTHER houses, not just this one', () => {
    expect(ROUTE).toMatch(/summariseBuilderHistory/)
    expect(ROUTE).toMatch(/\.neq\('property_id', house\.id\)/)
    expect(ROUTE).toMatch(/\.not\('call_outcome', 'is', null\)/)
    expect(ROUTE).toMatch(/history: historyByBuilder\.get\(b\.id\) \?\? null/)
  })

  it('sinks a builder who said no elsewhere, but does not ban him', () => {
    // A ban is the two forever flags, and only Pedro can decide on the phone
    // whether "not interested in that one" means never again.
    const sort = ROUTE.slice(ROUTE.indexOf('.sort((a, b) => {'), ROUTE.indexOf('.map((b) => {'))
    expect(sort).toMatch(/saidNo \? 1 : 0/)
    expect(sort).toMatch(/isGloballyExcluded/)
    expect(ROUTE).not.toMatch(/history[^\n]*disabled/)
  })

  it('puts it on the row where he dials', () => {
    expect(TABLE).toMatch(/data-testid="builder-history"/)
    expect(TABLE).toMatch(/b\.history\?\.summary/)
    expect(TABLE).toMatch(/b\.history\.saidNo/)
  })
})
