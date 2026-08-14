// Only gold and strong comparables are allowed to put a number in Pedro's
// mouth.
//
// The day this was found (2026-08-14): 110 of the 180 houses on the board were
// fair, good or last_resort. The engine had enforced the rule since 2026-08-13
// (shortlist_gate.py `require_comps_tier`), but those houses never went through
// the engine. They arrived on the retired hand push
// (scripts/push-course-deals-to-pedro.mjs), which bypassed the gate, and
// nothing on the CRM side re-checked them.
//
// 39 Orion Way was one of them: `good` evidence (800m, 12 months) put it at
// GBP 139,000 when the two houses on its own street said GBP 92,667, and we
// opened at GBP 96,375, above what the house is worth finished.
//
// These tests hold the rule on the last gate before the phone call.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  meetsEvidenceStandard, belowStandardByTier, SHIPPABLE_TIERS, ALL_TIERS,
} from '../scripts/lib/evidence-standard.mjs'

const root = resolve(__dirname, '..')
const read = (...p: string[]) => readFileSync(resolve(root, ...p), 'utf8')

const prop = (tier?: string | null) => ({ deal: tier === undefined ? {} : { comps_tier: tier } })

describe('which evidence may reach Pedro', () => {
  it('lets gold and strong through', () => {
    expect(meetsEvidenceStandard(prop('gold'))).toBe(true)
    expect(meetsEvidenceStandard(prop('strong'))).toBe(true)
  })

  it('refuses another street (good) and another year (fair)', () => {
    expect(meetsEvidenceStandard(prop('good'))).toBe(false)
    expect(meetsEvidenceStandard(prop('fair'))).toBe(false)
    expect(meetsEvidenceStandard(prop('last_resort'))).toBe(false)
  })

  it('refuses the Orion Way case specifically', () => {
    // 800m, 12 months. It shipped, and it should not have.
    expect(meetsEvidenceStandard({ deal: { comps_tier: 'good' } })).toBe(false)
  })

  it('refuses a property with no tier recorded', () => {
    // An unrecorded tier is not a good one. It means the deal predates the
    // standard, which is exactly the population that needed catching.
    expect(meetsEvidenceStandard(prop())).toBe(false)
    expect(meetsEvidenceStandard(prop(null))).toBe(false)
    expect(meetsEvidenceStandard(prop(''))).toBe(false)
  })

  it('never throws on a malformed property', () => {
    expect(meetsEvidenceStandard(undefined)).toBe(false)
    expect(meetsEvidenceStandard(null)).toBe(false)
    expect(meetsEvidenceStandard({})).toBe(false)
    expect(meetsEvidenceStandard({ deal: null })).toBe(false)
  })

  it('is case and whitespace insensitive', () => {
    expect(meetsEvidenceStandard(prop('  GOLD '))).toBe(true)
    expect(meetsEvidenceStandard(prop('Strong'))).toBe(true)
  })

  it('every shippable tier is a real tier the engine can produce', () => {
    for (const t of SHIPPABLE_TIERS) expect(ALL_TIERS).toContain(t)
  })
})

describe('reporting what was held back', () => {
  it('counts the held-back listings by tier', () => {
    const counts = belowStandardByTier([
      prop('gold'), prop('strong'), prop('good'), prop('good'),
      prop('fair'), prop('last_resort'), prop(),
    ])
    expect(counts).toEqual({ good: 2, fair: 1, last_resort: 1, 'none recorded': 1 })
  })

  it('says nothing when everything meets the standard', () => {
    expect(belowStandardByTier([prop('gold'), prop('strong')])).toEqual({})
  })

  it('never throws on rubbish', () => {
    expect(belowStandardByTier(undefined)).toEqual({})
    expect(belowStandardByTier([])).toEqual({})
  })
})

describe('the rule is actually wired into the queue', () => {
  it('the assign script filters on it before grouping into branches', () => {
    const src = read('scripts', 'assign-properties-to-pedro-houses.mjs')
    expect(src).toContain("from './lib/evidence-standard.mjs'")
    // The filter must run BEFORE groupByBranch, or a branch is built out of
    // houses that are not allowed to be called about.
    const filterAt = src.indexOf('filter(meetsEvidenceStandard)')
    const groupAt = src.indexOf('groupByBranch(usable)')
    expect(filterAt).toBeGreaterThan(-1)
    expect(groupAt).toBeGreaterThan(filterAt)
  })

  it('the run says out loud what it held back', () => {
    // A silent cap reads as "covered everything" when it did not.
    const src = read('scripts', 'assign-properties-to-pedro-houses.mjs')
    expect(src).toContain('evidence standard')
    expect(src).toContain('belowStandardByTier')
  })
})
