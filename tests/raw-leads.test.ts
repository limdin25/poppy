// The raw data command center: everything the scraper finds lands HERE
// first, and only Hugo's press moves a lead into Pedro's dialer.
//
// Hugo, 2026-08-19 (voice): "Instead of piping leads straight to Pedro,
// everything now hits a dedicated raw data tab in the CRM first. For every
// lead: the asking price, three distinct comparables with their specific
// prices and distances, any available floor plans, the initial discount
// right out of the gate, and a ballpark range minimum to maximum.
// Maintenance calculations stay tied to the live call. Multi-select and
// drag and drop so Hugo can manually approve and push specific deals to
// the Pedro dialer. Sorting by location, price, and scrape date."
//
// THE MECHANISM, chosen so no battle-tested logic is duplicated: the
// overnight assign scripts still create the contacts, apply the redial
// policy and dedupe exactly as before, but with --review they write
// wk_dialer_queue rows with status 'review', which the dialer NEVER pulls
// (it selects status 'pending' only). The same scripts upsert the display
// payload into wk_raw_leads. Hugo's push flips review -> pending; nothing
// else in the pipeline moves.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')

describe('the table and its fence', () => {
  const mig = read('supabase/migrations/20260819000003_raw_leads.sql')

  it('exists with the display columns the tab shows', () => {
    for (const col of ['property_id', 'contact_id', 'asking_price', 'discount',
      'band_min', 'band_max', 'comps', 'floorplans', 'scraped_at', 'status']) {
      expect(mig).toContain(col)
    }
  })

  it('is RLS-fenced to admins: the raw tab is the FILTER, agents never browse it', () => {
    expect(mig).toMatch(/enable row level security/)
    expect(mig).toMatch(/wk_is_admin\(\)/)
  })
})

describe('the route: admin door, push flips review to pending and nothing else', () => {
  const route = read('api/crm/raw-leads.ts')

  it('is admin-only: approving deals is the owner\'s job, not an agent\'s', () => {
    expect(route).toMatch(/wk_is_admin/)
    expect(route).not.toMatch(/wk_is_agent_or_admin/)
  })

  it('push updates ONLY review rows to pending, so a done or dialing row can never be resurrected', () => {
    expect(route).toMatch(/\.eq\('status', 'review'\)/)
    expect(route).toMatch(/status: 'pending'/)
  })

  it('a push with no queue row reports the miss instead of silently marking pushed', () => {
    expect(route).toMatch(/no_queue_row/)
  })

  it('reject parks the queue row as skipped and the raw row as rejected', () => {
    expect(route).toMatch(/status: 'skipped'/)
    expect(route).toMatch(/'rejected'/)
  })
})

describe('the dialer stays blind to review rows', () => {
  it('both queue readers still select pending only', () => {
    expect(read('src/features/crm/dialer-pro/useQueuePro.ts')).toMatch(/\.eq\('status', 'pending'\)/)
    expect(read('src/features/crm/hooks/useMyDialerQueue.ts')).toMatch(/\.eq\('status', 'pending'\)/)
  })
})

describe('the command center page', () => {
  const page = read('src/features/crm/pages/RawLeadsPage.tsx')

  it('shows the five facts Hugo named: asking, comps with price and distance, floor plans, discount, band', () => {
    expect(page).toMatch(/asking_price/)
    expect(page).toMatch(/distance_m/)
    expect(page).toMatch(/floorplans/)
    expect(page).toMatch(/discount/)
    expect(page).toMatch(/band_min/)
    expect(page).toMatch(/band_max/)
  })

  it('says the maintenance figure is NOT known yet: works are priced on the live call', () => {
    expect(page).toMatch(/works are priced on the call/i)
  })

  it('sorts by location, price, and scrape date (and discount, the point of the tab)', () => {
    for (const key of ["'location'", "'price'", "'scraped'", "'discount'"]) {
      expect(page).toContain(key)
    }
  })

  it('multi-select with select-all, drag and drop onto the dialer zone, and button fallbacks', () => {
    expect(page).toMatch(/selected/)
    expect(page).toMatch(/draggable/)
    expect(page).toMatch(/onDrop/)
    expect(page).toMatch(/data-testid="raw-leads-dropzone"/)
    expect(page).toMatch(/data-testid="raw-leads-push"/)
  })

  it('parses responses text-first, the TodayPanel lesson', () => {
    expect(page).toMatch(/await res\.text\(\)/)
  })

  it('is a spreadsheet: a real table, the property hyperlinked, a size tick on every comp', () => {
    // Hugo, 2026-08-19: "like a spreadsheet, everything side by side, first
    // column the property name hyperlinked, then the comparisons, and a tick
    // to confirm floor plan available." The size rule feeds it: every comp
    // carries floor_area_sqm from the engine or the house never entered.
    expect(page).toMatch(/<table/)
    expect(page).toMatch(/<thead/)
    expect(page).toMatch(/href=\{lead\.url\}/)
    expect(page).toMatch(/floor_area_sqm/)
    expect(page).toMatch(/href=\{lead\.floorplans\[0\]\}/)
  })
})

describe('the page is wired in, admin-only', () => {
  it('has a route behind AdminOnlyRoute and a sidebar entry', () => {
    const app = read('src/features/crm/CrmApp.tsx')
    expect(app).toMatch(/path="raw-leads" element=\{<AdminOnlyRoute><RawLeadsPage \/><\/AdminOnlyRoute>\}/)
    const side = read('src/features/crm/layout/Smsv2Sidebar.tsx')
    expect(side).toMatch(/Raw deals/)
    expect(side).toMatch(/\/admin\/crm\/raw-leads/)
  })

  it('agents never see the tab: Raw deals is NOT in the agent nav subset', () => {
    const side = read('src/features/crm/layout/Smsv2Sidebar.tsx')
    const agentSubset = side.match(/\[(?:'[^']+',?\s*)+\]\.includes\(label\)/)?.[0] ?? ''
    expect(agentSubset).not.toContain('Raw deals')
  })
})

describe('the assign scripts: review mode, and the raw payload rides along', () => {
  const disc = read('scripts/assign-discovery-branches.mjs')
  const priced = read('scripts/assign-properties-to-pedro-houses.mjs')

  it('both scripts take --review and write queue status review in that mode', () => {
    for (const src of [disc, priced]) {
      expect(src).toMatch(/--review/)
      expect(src).toMatch(/REVIEW \? 'review' : 'pending'/)
    }
  })

  it('both scripts upsert the wk_raw_leads display row keyed by property id', () => {
    for (const src of [disc, priced]) {
      expect(src).toMatch(/wk_raw_leads/)
      expect(src).toMatch(/onConflict: 'property_id'/)
    }
  })

  it('the discovery re-check floor moved with the pool: 20 percent, not 15', () => {
    expect(disc).toMatch(/MIN_LOCAL_DISCOUNT = 0\.20/)
    expect(disc).not.toMatch(/MIN_LOCAL_DISCOUNT = 0\.15/)
  })
})
