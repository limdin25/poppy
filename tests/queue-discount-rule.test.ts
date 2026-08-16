// Nothing reaches Pedro's dialer without a MEASURED discount at or over the rule.
//
// THE DAY THIS WENT WRONG, 2026-08-16. Hugo asked the right question about the
// 172 leads sitting in the dialer: "are those all strong enough, at least 10%
// cheaper than comparables?" Measured from scratch against our own screen, four
// were not: Moorland Way Mansfield at 10.5% under, Torsway Avenue Blackpool at
// 6.7%, Somerville Peterborough at 3.0%, against a rule of 15%, plus one
// property that had left our listing table entirely.
//
// All three discount failures were PRICED cards, and the cause was structural
// rather than a bad number. `send_to_elsie.MIN_LOCAL_DISCOUNT` refuses exactly
// these and always did its job, but it only guards the moment of PUSHING. The
// assign script queues from `brrr_properties`, which still held rows written
// before that gate existed on 2026-08-15, and it had no discount check of its
// own at all. A rule added at the front door did nothing about what was already
// inside the house.
//
// Hugo: "make sure this never ever happens again." So the measured number now
// travels on the deal blob, and BOTH assign scripts re-check it at the last
// gate before a queue row is written.
//
// The rule these tests defend, in one line: UNVERIFIED IS NOT THE SAME AS FINE.
// A missing discount must be a refusal. Treating "we never measured it" as "it
// is probably alright" is precisely how those three got in front of Pedro.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const priced = read('scripts/assign-properties-to-pedro-houses.mjs')
const discovery = read('scripts/assign-discovery-branches.mjs')

describe('the discount rule is enforced where the queue row is written', () => {
  it('both assign scripts carry the threshold themselves', () => {
    // Written in each script on purpose rather than imported from one place.
    // These are the LAST gates before Pedro, and they queue from sources that
    // may never have been judged by the engine, so they cannot inherit the
    // rule by assuming everything upstream screened it.
    for (const src of [priced, discovery]) {
      expect(src).toMatch(/const MIN_LOCAL_DISCOUNT = 0\.15/)
    }
  })

  it('the priced path filters on a finite, stamped discount', () => {
    // Number.isFinite is the load-bearing half. Without it, `undefined >= 0.15`
    // is false but `Number(undefined)` is NaN, and a sloppier check that only
    // compared magnitudes would let an unmeasured row through on some shapes.
    expect(priced).toMatch(/local_discount_pct/)
    expect(priced).toMatch(/Number\.isFinite\(d\)\s*&&\s*d >= MIN_LOCAL_DISCOUNT/)
  })

  it('the discovery path re-checks the pool rather than trusting it', () => {
    // discovery_pool.py already screens on this. The file it writes is still
    // just a file: it can be stale, half-written by a killed run, or edited.
    expect(discovery).toMatch(/Number\.isFinite\(d\)\s*&&\s*d >= MIN_LOCAL_DISCOUNT/)
    expect(discovery).toMatch(/rawPool/)
  })

  it('an empty pool after filtering is refused, not treated as a quiet night', () => {
    // If nothing in the pool carries a discount, the pool is broken. Queueing
    // nobody and exiting 0 would look identical to "no new stock tonight".
    expect(discovery).toMatch(/REFUSING: not one branch in the pool/)
    expect(discovery).toMatch(/process\.exit\(2\)/)
  })

  it('both scripts SAY how many they held back', () => {
    // A silent filter is how you discover months later that the queue has been
    // quietly empty. The count has to appear in the run log.
    expect(priced).toMatch(/discount rule\s*:/)
    expect(discovery).toMatch(/refused here/)
  })
})

describe('the 14-day rule Pedro relies on is untouched', () => {
  // Hugo, 2026-08-16, in the same breath as asking for the discount fence:
  // "make sure we still stick to the rule that Pedro will not call the same
  // branch for fourteen days, on the QUEUE." The follow-up path he runs from
  // the CRM contacts side is a different thing and is not governed here.
  const policy = read('scripts/lib/redial-policy.mjs')

  it('a branch that spoke to us is held for a full fourteen days', () => {
    expect(policy).toMatch(/SPOKEN_BRANCH_COOLDOWN_HOURS = 14 \* 24/)
  })

  it('both assign scripts still consult the redial policy', () => {
    for (const src of [priced, discovery]) {
      expect(src).toMatch(/redial-policy\.mjs/)
    }
  })
})
