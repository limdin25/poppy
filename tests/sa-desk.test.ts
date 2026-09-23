// The Serviced Accommodation desk (Hugo, 2026-09-23): a third clean CRM, a
// drop down instead of a toggle, its own script, coach, outcomes and report.
// WE ARE THE MIDDLEMAN: the win is a yes in principle from the agent or the
// landlord, and nothing on the phone ever says we take the flat or negotiates.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The API modules build a Supabase client when imported. Nothing here talks to
// it; it only needs a URL to exist.
vi.hoisted(() => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'
})
import { SCRIPT_TEXT_TOKENS } from '../src/features/crm/lib/interpolateScript'
import { scriptForContactFields, scriptForDesk, scriptForCall } from '../src/features/crm/lib/scriptForCall'
import { OUTCOMES, BOARD_COLUMN_FOR } from '../api/crm/sa-outcome'
import { SA_OUTCOMES } from '../src/features/crm/components/live-call/SaListingPane'
import { saEmailTemplate } from '../src/features/crm/components/live-call/SaEmailPane'
import { isSaDay } from '../api/cron/daily-agent-reports'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const MIG = read('supabase/migrations/20260923000001_sa_desk.sql')
const HTML = read('src/core/content/sa-call-script.html')
const PAGE = HTML.slice(HTML.indexOf('id="page"'))
const COACH = read('supabase/functions/wk-voice-transcription/index.ts')
const LONG_DASH_OR_CURLY = /[\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/

describe('the database', () => {
  it('allows the third desk everywhere the desk lives', () => {
    for (const t of ['wk_contacts', 'wk_calls', 'wk_dialer_campaigns', 'wk_pipelines', 'wk_notifications']) {
      expect(MIG).toMatch(new RegExp(`alter table public\\.${t} add constraint ${t}_desk_chk check \\(desk in \\('houses', 'auction', 'sa'\\)\\);`))
    }
    expect(MIG).toMatch(/profiles_active_desk_chk check \(active_desk in \('houses', 'auction', 'sa'\)\)/)
    expect(MIG).toMatch(/script_key in \('vsl_close', 'property_call', 'auction_call', 'sa_call'\)/)
  })
  it('never lets a rental into brrr_properties, the Houses table', () => {
    expect(MIG).not.toMatch(/brrr_properties_desk_chk/)
  })
  it('sa_listings is read by staff and written only by the server', () => {
    expect(MIG).toMatch(/alter table public\.sa_listings enable row level security;/)
    expect(MIG).toMatch(/create policy sa_listings_staff_read on public\.sa_listings\s+for select to authenticated using \(wk_is_agent_or_admin\(\)\);/)
    expect(MIG).not.toMatch(/on public\.sa_listings\s+for (insert|update|delete|all)/)
  })
  it('seeds the board with the columns the outcome API moves cards to', () => {
    for (const col of Object.values(BOARD_COLUMN_FOR)) expect(MIG).toContain(`'${col}'`)
    expect(MIG).toMatch(/'Voicemail'/)
    expect(MIG).toMatch(/'No pickup'/)
  })
})

describe('the drop down', () => {
  const ctx = read('src/features/crm/lib/DeskContext.tsx')
  const toggle = read('src/features/crm/layout/DeskToggle.tsx')
  it('offers Houses, Auction and Serviced Accommodation', () => {
    expect(ctx).toMatch(/export type Desk = 'houses' \| 'auction' \| 'sa';/)
    expect(ctx).toMatch(/sa: 'Serviced Accommodation'/)
  })
  it('is a select, locked during a call, only for a login with more than one desk', () => {
    expect(toggle).toMatch(/<select/)
    expect(toggle).toMatch(/data-testid="desk-select"/)
    expect(toggle).toMatch(/const locked = phase !== 'idle';/)
    expect(toggle).toMatch(/if \(!resolved \|\| desks\.length < 2\) return null;/)
  })
})

describe('which script is on screen', () => {
  it('the SA desk and an SA agency get the SA script from any button', () => {
    expect(scriptForDesk('sa')).toBe('sa_call')
    expect(scriptForContactFields({ lead_type: 'sa_agency' })).toBe('sa_call')
    expect(scriptForCall({ openedWith: 'sa_call', openedForContactId: null, currentLeadContactId: 'x' })).toBe('sa_call')
  })
  it('the dialer records the SA script on the call, so the coach coaches it', () => {
    const create = read('supabase/functions/wk-calls-create/index.ts')
    expect(create).toMatch(/body\.script_key === 'sa_call' \? 'sa_call'/)
    expect(create).toMatch(/scriptKey === 'sa_call' \? 'sa'/)
  })
})

describe('the script', () => {
  it('has no long dashes, curly quotes or ellipsis characters', () => {
    expect(HTML).not.toMatch(LONG_DASH_OR_CURLY)
  })
  it('every [token] is one interpolateScript knows, so none prints raw', () => {
    const tokens = [...PAGE.matchAll(/\[([a-z_]+)\]/g)].map((m) => m[1])
    expect(tokens.length).toBeGreaterThan(5)
    for (const t of tokens) expect(SCRIPT_TEXT_TOKENS as readonly string[]).toContain(t)
  })
  it('says we are the middleman, and never that we take the flat or negotiate', () => {
    expect(PAGE).toMatch(/We are the middleman\. We do not take the flat\./)
    expect(PAGE).toMatch(/No negotiation\./)
    const said = [...PAGE.matchAll(/<div class="(?:line|obj-say)">[\s\S]*?<\/div>/g)].map((m) => m[0]).join('\n')
    expect(said).toMatch(/we work with serviced accommodation companies/i)
    expect(said).not.toMatch(/we('ll| will) take (it|the flat)|we take flats|we'd pay|we can offer|we can pay/i)
    expect(said).toMatch(/the company pays the asking rent/i)
  })
  it('asks for a yes from the agent OR the landlord', () => {
    expect(PAGE).toMatch(/Would you, or the landlord, be open to that in principle\?/)
    expect(PAGE).toMatch(/A yes from the agent counts\./)
  })
})

describe('screen and coach agree', () => {
  it('same five stages, same order', () => {
    const screen = [...PAGE.matchAll(/<div class="stage-div">\d\. ([^<]+)<\/div>/g)].map((m) => m[1].trim())
    const block = COACH.slice(COACH.indexOf('const SA_STAGE_ORDER = ['))
    const coach = [...block.slice(0, block.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(screen).toEqual(coach)
    expect(screen).toHaveLength(5)
  })
  it('the coach replaces the Elsie knowledge base on an SA call', () => {
    expect(COACH).toMatch(/const isSaCall = \(call\.script_key as string \| null\) === 'sa_call';/)
    expect(COACH).toMatch(/: isSaCall \? SA_OBJECTIONS/)
    expect(COACH).toMatch(/: isSaCall \? 'sa_call'/)
    expect(COACH).toMatch(/: isSaCall \? SA_SCRIPT_PROMPT/)
  })
  it('the coach knows we are the middleman and never negotiate', () => {
    const block = COACH.slice(COACH.indexOf('const SA_SCRIPT_PROMPT = ['), COACH.indexOf('const SA_OBJECTIONS'))
    expect(block).toMatch(/WE ARE THE MIDDLEMAN\. We do NOT take the flat\./)
    expect(block).toMatch(/NO NEGOTIATION\./)
    expect(block).not.toMatch(LONG_DASH_OR_CURLY)
  })
})

describe('the outcomes', () => {
  it('the buttons and the API list the same outcomes', () => {
    expect(SA_OUTCOMES.map((o) => o.key)).toEqual([...OUTCOMES])
  })
  it('a yes needs a name and goes to Hugo', () => {
    const api = read('api/crm/sa-outcome.ts')
    expect(api).toMatch(/outcome === 'yes_in_principle' && !person/)
    expect(api).toMatch(/if \(outcome === 'yes_in_principle' && PIPELINE_BUSINESS_ID\)/)
  })
  it('never does company lets is what retires an agency', () => {
    expect(OUTCOMES).toContain('no_company_lets')
    expect(read('scripts/lib/sa-listings.mjs')).toMatch(/export const NEVER_AGAIN = 'no_company_lets'/)
  })
})

describe('the email', () => {
  const t = saEmailTemplate({ address: '8 Crump Street, Liverpool', street: 'Crump Street', city: 'Liverpool', rent: '£1,000 a month', person: 'Sam', fromName: 'Pedro' })
  it('introduces a company, asks for a yes in principle, and never takes the flat', () => {
    expect(t.body).toMatch(/we work with serviced accommodation companies/)
    expect(t.body).toMatch(/open to this in principle/)
    expect(t.body).toMatch(/we will introduce the company/)
    expect(t.body).not.toMatch(/we('ll| will) take/i)
    expect(t.body).not.toMatch(LONG_DASH_OR_CURLY)
    expect(t.subject).not.toMatch(LONG_DASH_OR_CURLY)
  })
  it('a person presses send: the pane only sends from a click', () => {
    const pane = read('src/features/crm/components/live-call/SaEmailPane.tsx')
    expect(pane).toMatch(/onClick=\{send\}/)
    expect(pane.match(/invoke\('wk-email-send'/g)).toHaveLength(1)
  })
})

describe('the daily report', () => {
  const call = (script_key: string | null) => ({ id: 'x', started_at: '', duration_sec: 0, status: '', disposition: null, company: null, contact_id: null, script_key, lines: [] })
  it('grades a day that is mostly SA calls against the SA script', () => {
    expect(isSaDay([call('sa_call'), call('sa_call'), call('property_call')])).toBe(true)
    expect(isSaDay([call('sa_call'), call('property_call'), call('property_call')])).toBe(false)
    expect(isSaDay([call('property_call')])).toBe(false)
  })
})
