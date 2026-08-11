// The 2026-08-11 batch: the second brain's verdict is enforced at Elsie's
// door, the post-conversion value reaches the contact and the coach, and Call
// history opens the complete deal instead of a bare listing link.
//
// Background, because the numbers were real: Holloway Head B1, a 2-bed
// ex-council tower flat asking £100,000, was valued at £293,296 off luxury
// new-build comps 100m away and queued to Pedro with a £95,000 opening offer.
// The valuation engine on the VPS gained a re-anchor rule and a second brain
// (deal_auditor.py); these pins hold the Elsie side of that bargain.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8')

describe('the ingest enforces both brains', () => {
  const src = read('api', 'properties', 'ingest.ts')

  it('refuses a deal the engine said not to pursue', () => {
    expect(src).toMatch(/deal\.pursue === false/)
    expect(src).toMatch(/status: 422/)
  })

  it('refuses an auditor kill unless a human forced it', () => {
    expect(src).toMatch(/audit\?\.verdict === 'kill' && audit\?\.forced !== true/)
  })

  it('still never starts a call', () => {
    expect(src).toMatch(/call_queued: false/)
  })
})

describe('the post-conversion value reaches every reader', () => {
  it('factsFor writes worth_after_bed for the coach and the contact', () => {
    const src = read('scripts', 'assign-properties-to-pedro-houses.mjs')
    expect(src).toMatch(/worth_after_bed/)
    expect(src).toMatch(/deal\.audit && Array\.isArray\(deal\.audit\.reasons\)/)
  })

  it('scriptTokensFor writes the same key when the agent switches property', () => {
    const src = read('src', 'features', 'crm', 'hooks', 'usePropertyListings.ts')
    expect(src).toMatch(/worth_after_bed/)
  })

  it('the script token is allowlisted so the slot renders', () => {
    const src = read('src', 'features', 'crm', 'lib', 'interpolateScript.ts')
    expect(src).toMatch(/'worth_after_bed'/)
  })

  it('the live coach says it out loud', () => {
    const src = read('supabase', 'functions', 'wk-voice-transcription', 'index.ts')
    expect(src).toMatch(/worth_after_bed/)
    expect(src).toMatch(/Worth after the kitchen becomes a bedroom/)
  })
})

describe('nested-shape evidence, not "no sold comparables" beside a valuation', () => {
  const src = read('src', 'features', 'crm', 'hooks', 'usePropertyListings.ts')

  it('builds evidence sentences from the engine audit rows', () => {
    expect(src).toMatch(/a\.included === true/)
    expect(src).toMatch(/sold for /)
  })

  it('quotes the raw sold price, never the time-adjusted figure', () => {
    // Pedro reads these aloud to someone who can check the Land Registry.
    expect(src).not.toMatch(/adj_price/)
  })

  it('translates the auditor reasons into words an agent can use', () => {
    expect(src).toMatch(/cmv_far_above_asking_reanchored/)
    expect(src).toMatch(/bmv_claim_unproven/)
  })
})

describe('call history opens the complete deal', () => {
  it('CallsPage mounts the snapshot drawer', () => {
    const src = read('src', 'features', 'crm', 'pages', 'CallsPage.tsx')
    expect(src).toMatch(/DealSnapshotDrawer/)
    expect(src).toMatch(/open-deal-snapshot/)
  })

  it('the drawer shows the same OfferStrip Pedro sees, and the call outcome', () => {
    const src = read('src', 'features', 'crm', 'components', 'calls', 'DealSnapshotDrawer.tsx')
    expect(src).toMatch(/from '\.\.\/live-call\/OfferStrip'/)
    expect(src).toMatch(/usePropertyListings/)
    expect(src).toMatch(/This call/)
  })
})

describe('best-deal-first reads the nested shape', () => {
  it('headlineProperty sorts on deal.offer.max with the flat key as fallback', () => {
    const src = read('scripts', 'lib', 'property-branches.mjs')
    expect(src).toMatch(/deal\?\.offer\?\.max/)
  })

  it('the RPC orders on both shapes', () => {
    const src = read('supabase', 'migrations', '20260811000002_property_rpc_nested_order.sql')
    expect(src).toMatch(/p\.deal -> 'offer' ->> 'max'/)
    expect(src).toMatch(/p\.deal ->> 'offer_max'/)
  })
})
