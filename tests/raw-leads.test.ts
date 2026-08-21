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

  it('the SUBJECT has its own size column, source named, or the comparison is rubbish', () => {
    // Hugo, 2026-08-19, seeing sized comps beside an unsized house: "if we
    // don't know the size of our property, we cannot make comparisons, so
    // we cannot use it." The pool refuses unsized subjects; the sheet shows
    // the number and where it came from (plan, advert, rooms).
    expect(page).toMatch(/lead\.floor_area_sqm/)
    expect(page).toMatch(/AREA_SOURCE_LABEL/)
    const mig = read('supabase/migrations/20260819000005_raw_leads_subject_size.sql')
    expect(mig).toMatch(/floor_area_sqm/)
    expect(mig).toMatch(/area_source/)
    const disc2 = read('scripts/assign-discovery-branches.mjs')
    expect(disc2).toMatch(/floor_area_sqm: p\.subject_floor_area_sqm/)
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

  it('the discovery re-check floor is whatever the pool screens on, and BOTH move together', () => {
    // This used to pin 0.20 and forbid 0.15, which read as defending the rule
    // and actually defended a number. The floor moved 0.15 -> 0.20 on
    // 2026-08-19 and back to 0.15 on 2026-08-21 ("make 15 to 45%"), and a test
    // written against the number has to be edited on every such move, which is
    // exactly when a test stops being read and starts being silenced.
    //
    // What matters is that the two assign scripts agree with each other, so
    // neither can drift while the other is corrected. The engine's own value
    // lives in discovery_pool.py on the VPS, out of this repo's reach.
    const floorOf = (src: string) => src.match(/const MIN_LOCAL_DISCOUNT = ([\d.]+)/)?.[1]
    expect(floorOf(disc)).toBeDefined()
    expect(floorOf(disc)).toBe(floorOf(priced))
  })
})

// ---------------------------------------------------------------------------
// The seven comparable rules (2026-08-19).
//
// Hugo, after the Fontaine comparables audit, pasting the course's own
// checklist back: "build it but make sure ai does all this as well before send
// to my raw list ... make sure all of this is rock solid."
//
// The engine (comp_gate.py) is the only thing that DECIDES. These tests pin
// the three places the answer has to survive: the assign script must refuse a
// lead that did not clear all seven, the column must exist to hold the
// receipt, and the tab must show it rather than implying it.

describe('the seven comparable rules reach the raw tab', () => {
  const disc = read('scripts/assign-discovery-branches.mjs')
  const page = read('src/features/crm/pages/RawLeadsPage.tsx')
  const mig = read('supabase/migrations/20260820000006_raw_leads_comp_checks.sql')

  const SEVEN = ['street_first', 'recent_enough', 'photographs', 'condition',
    'sizes', 'own_street', 'on_market']

  it('the assign script names all seven rules and refuses anything short', () => {
    // The same discipline the discount already has: the pool file is not
    // evidence, it is a file. A last gate that trusts its input is not a gate.
    for (const rule of SEVEN) expect(disc).toContain(rule)
    expect(disc).toMatch(/gatePassed/)
    expect(disc).toMatch(/checks\.length !== SEVEN\.length/)
    expect(disc).toMatch(/did not clear all seven/)
  })

  it('an unchecked lead is refused, never waved through', () => {
    // A pool file written by an older engine carries no comp_checks at all.
    // Unchecked is not the same as fine.
    expect(disc).toMatch(/Array\.isArray\(p\?\.comp_checks\) \? p\.comp_checks : \[\]/)
  })

  it('the receipt rides into the raw lead row, read never derived', () => {
    expect(disc).toMatch(/comp_checks: Array\.isArray\(p\.comp_checks\)/)
    expect(disc).toMatch(/market_comps: p\.market_comps/)
    expect(disc).toMatch(/market_ceiling: p\.market_ceiling/)
  })

  it('the column exists and defaults to empty, not to a pass', () => {
    expect(mig).toMatch(/comp_checks jsonb not null default '\[\]'::jsonb/)
    expect(mig).toMatch(/market_comps/)
    expect(mig).toMatch(/market_ceiling/)
  })

  it('the tab shows a dot per rule with the evidence on hover', () => {
    expect(page).toMatch(/RULE_LABELS/)
    for (const rule of SEVEN) expect(page).toContain(rule)
    expect(page).toMatch(/RulesCell/)
    expect(page).toMatch(/lead\.comp_checks/)
  })

  it('a lead filed before the gate existed says so instead of showing ticks', () => {
    // Seven quiet greens nobody earned is worse than no answer at all.
    expect(page).toMatch(/not checked/)
  })

  it('the labels are the seven rules in Hugo\'s own order', () => {
    const order = [...page.matchAll(/\['(\w+)', '/g)].map((m) => m[1])
    expect(order.slice(0, 7)).toEqual(SEVEN)
  })
})
