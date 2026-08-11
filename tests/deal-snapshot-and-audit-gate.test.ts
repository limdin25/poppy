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

  it('refuses an UNKNOWN deal the engine said not to pursue', () => {
    expect(src).toMatch(/deal\.pursue === false/)
    expect(src).toMatch(/if \(!existing\)/)
    expect(src).toMatch(/status: 422/)
  })

  it('WITHDRAWS a known one instead, so it cannot keep yesterday s numbers', () => {
    // When the refurb costings were corrected, twenty properties stopped being
    // worth a call and every one stayed callable in Pedro's queue, because
    // nothing ever sent the bad news.
    expect(src).toMatch(/engine_no_longer_pursues/)
    expect(src).toMatch(/verdict: 'kill'/)
  })

  // Changed 2026-08-11 the same evening. The kill used to be REFUSED, and the
  // purge deleted the rows, which left Dixons with thirteen calls and no deal
  // behind any of them. A kill is now FILED as 'auditor_killed': never queued,
  // never shown to the dialer, always visible in Call history.
  it('files an auditor kill as withdrawn rather than refusing it', () => {
    expect(src).toMatch(/audit\?\.verdict === 'kill' && audit\?\.forced !== true/)
    expect(src).toMatch(/killedStatus \? \{ status: killedStatus \} : \{\}/)
    expect(src).toMatch(/'auditor_killed'/)
  })

  it('never lets a machine kill overwrite a human outcome', () => {
    expect(src).toMatch(/MACHINE_STATUSES = \['new', 'call_queued', 'auditor_killed'\]/)
    expect(src).toMatch(/MACHINE_STATUSES\.includes\(prevStatus \?\? 'new'\)/)
  })

  it('lets a withdrawn deal come back when it next passes', () => {
    // Deals are re-judged nightly. Without this the withdrawn status sticks
    // forever and a deal the engine has since cleared stays hidden.
    expect(src).toMatch(/prevStatus === 'auditor_killed'/)
    expect(src).toMatch(/killedStatus = 'new'/)
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

  it('the button shows on every estate-agent call, not only where a chip exists', () => {
    // Dixons had one listing, the auditor withdrew it, and the button
    // vanished along with thirteen calls' worth of context.
    const src = read('src', 'features', 'crm', 'pages', 'CallsPage.tsx')
    expect(src).toMatch(/customFields\?\.lead_type === 'estate_agent'/)
  })

  it('the drawer shows the same OfferStrip Pedro sees, and the call outcome', () => {
    const src = read('src', 'features', 'crm', 'components', 'calls', 'DealSnapshotDrawer.tsx')
    expect(src).toMatch(/from '\.\.\/live-call\/OfferStrip'/)
    expect(src).toMatch(/usePropertyListings/)
    expect(src).toMatch(/This call/)
  })
})

describe('a withdrawn deal is visible in history and invisible to the dialer', () => {
  const hook = read('src', 'features', 'crm', 'hooks', 'usePropertyListings.ts')
  const drawer = read('src', 'features', 'crm', 'components', 'calls', 'DealSnapshotDrawer.tsx')

  it('the hook hides withdrawn deals unless asked for them', () => {
    expect(hook).toMatch(/status === 'auditor_killed'/)
    expect(hook).toMatch(/\.filter\(\(l\) => includeWithdrawn \|\| !l\.withdrawn\)/)
  })

  it('only Call history asks for them, never the dialer', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { resolve, join } = await import('node:path')
    const root = resolve(__dirname, '..', 'src', 'features', 'crm')
    const allowed = join(root, 'components', 'calls', 'DealSnapshotDrawer.tsx')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.tsx?$/.test(e) || p === allowed) continue
        if (/includeWithdrawn:\s*true/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })

  it('the drawer explains the withdrawal in the auditor s own words', () => {
    expect(drawer).toMatch(/deal-withdrawn/)
    expect(drawer).toMatch(/Deal withdrawn by the auditor/)
    expect(drawer).toMatch(/withdrawnReasons/)
  })

  it('and refuses to compute sums off a rejected valuation', () => {
    expect(drawer).toMatch(/isAdmin && sums && !selected\.withdrawn/)
  })

  it('the chips RPC leaves withdrawn houses off the board', () => {
    const sql = read('supabase', 'migrations', '20260811000003_property_links_exclude_withdrawn.sql')
    expect(sql).toMatch(/coalesce\(p\.status, ''\) <> 'auditor_killed'/)
  })

  it('the purge withdraws rather than deletes', () => {
    const src = read('scripts', 'prune-audit-killed.mjs')
    expect(src).toMatch(/update\(\{ status: 'auditor_killed' \}\)/)
    expect(src).not.toMatch(/from\('brrr_properties'\)\.delete\(\)/)
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
