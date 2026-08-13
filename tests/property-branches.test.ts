// Grouping scraped properties by estate agency branch.
//
// The branch is the unit of the whole feature: one contact, one queue row, one
// phone call, and one AI-or-human decision. Get the grouping wrong and either
// Pedro rings the same office twelve times, or the AI rings an office he is
// mid-negotiation with because only some of its listings were handed over.
//
// The phone matching is the fiddly part, because the same branch arrives in two
// formats: the scraper stores what Rightmove printed ("0191 625 0242") and
// api/properties/ingest.ts stores E.164 ("+441916250242").

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { phoneTail9, groupByBranch, headlineProperty } from '../scripts/lib/property-branches.mjs'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('phoneTail9 — the same branch, however it was written down', () => {
  it('matches E.164, national and spaced forms of one number', () => {
    const forms = ['+441916250242', '01916250242', '0191 625 0242', '(0191) 625 0242', '0191-625-0242']
    const tails = forms.map(phoneTail9)
    expect(new Set(tails).size).toBe(1)
    expect(tails[0]).toBe('916250242')
  })

  it('matches the +44 and 0 forms of a London number too', () => {
    expect(phoneTail9('+442075551234')).toBe(phoneTail9('02075551234'))
  })

  it('refuses anything too short to identify a branch', () => {
    // Tail-matching on 3 digits would group half the table into one "branch".
    for (const junk of ['', null, undefined, '123', '0191 62', 'not a phone']) {
      expect(phoneTail9(junk as string)).toBe('')
    }
  })

  it('keeps 9 digits even from a very long string', () => {
    expect(phoneTail9('00441916250242')).toBe('916250242')
  })

  it('agrees with the SQL index expression', () => {
    // The migration indexes right(regexp_replace(phone,'[^0-9]','','g'), 9).
    // If these two ever disagree, the RPC and the script disagree about which
    // properties belong to the branch being called.
    const sql = read('supabase/migrations/20260809000001_property_human_calls.sql')
    expect(sql).toMatch(/right\(regexp_replace\(coalesce\(agent_phone, ''\), '\[\^0-9\]', '', 'g'\), 9\)/)
  })
})

describe('groupByBranch', () => {
  const props = [
    { id: 'a', agent_phone: '+442475424211', agent_name: 'Pattinson', deal: { offer_max: 87500 } },
    { id: 'b', agent_phone: '024 7542 4211', agent_name: 'Pattinson', deal: { offer_max: 100000 } },
    { id: 'c', agent_phone: '02475424211', agent_name: '', deal: { offer_max: 97000 } },
    { id: 'd', agent_phone: '+442476935761', agent_name: 'Connells', deal: { offer_max: 80550 } },
    { id: 'e', agent_phone: null, agent_name: 'No number', deal: {} },
    { id: 'f', agent_phone: '12', agent_name: 'Too short', deal: {} },
  ]

  it('puts three formats of one number into ONE branch', () => {
    const branches = groupByBranch(props)
    const pattinson = branches.find((b) => b.tail9 === '475424211')
    expect(pattinson?.properties).toHaveLength(3)
  })

  it('drops properties with no usable number rather than inventing a branch', () => {
    const branches = groupByBranch(props)
    expect(branches.flatMap((b) => b.properties.map((p: { id: string }) => p.id))).not.toContain('e')
    expect(branches.flatMap((b) => b.properties.map((p: { id: string }) => p.id))).not.toContain('f')
  })

  it('orders branches by how much stock they have', () => {
    const branches = groupByBranch(props)
    expect(branches[0].properties.length).toBeGreaterThanOrEqual(branches[1].properties.length)
    expect(branches[0].agency).toBe('Pattinson')
  })

  it('takes the agency name from whichever row actually has one', () => {
    // Row 'c' has a blank agent_name; the branch must not end up unnamed.
    const branches = groupByBranch([props[2], props[0]])
    expect(branches[0].agency).toBe('Pattinson')
  })

  it('handles an empty or missing list without throwing', () => {
    expect(groupByBranch([])).toEqual([])
    expect(groupByBranch(undefined)).toEqual([])
  })

  it('rings a branch holding a price-cut listing before a bigger branch without one', () => {
    // Hugo, 2026-08-13: "price reduced decides queue order". Pattinson has
    // three houses, Connells one, but the Connells house had its price cut,
    // so Connells rings first. Ordering only: nobody is dropped.
    const cut = [...props.slice(0, 4)]
    cut[3] = { ...cut[3], deal: { ...cut[3].deal, price_reduced: true } }
    const branches = groupByBranch(cut)
    expect(branches[0].agency).toBe('Connells')
    expect(branches[1].agency).toBe('Pattinson')
    expect(branches.flatMap((b) => b.properties).length).toBe(4)
  })
})

describe('headlineProperty — the one the call opens on', () => {
  it('picks the biggest offer', () => {
    const best = headlineProperty([
      { id: 'a', deal: { offer_max: 87500 } },
      { id: 'b', deal: { offer_max: 100000 } },
      { id: 'c', deal: { offer_max: 97000 } },
    ])
    expect(best.id).toBe('b')
  })

  it('breaks a tie on the engine s pursue flag', () => {
    const best = headlineProperty([
      { id: 'a', deal: { offer_max: 90000, pursue: false } },
      { id: 'b', deal: { offer_max: 90000, pursue: true } },
    ])
    expect(best.id).toBe('b')
  })

  it('falls back to the newest listing when neither separates them', () => {
    const best = headlineProperty([
      { id: 'old', deal: { offer_max: 90000 }, created_at: '2026-01-01' },
      { id: 'new', deal: { offer_max: 90000 }, created_at: '2026-06-01' },
    ])
    expect(best.id).toBe('new')
  })

  it('still returns something when no property has a valuation', () => {
    expect(headlineProperty([{ id: 'x', deal: {} }]).id).toBe('x')
  })

  it('returns null for nothing', () => {
    expect(headlineProperty([])).toBeNull()
    expect(headlineProperty(undefined)).toBeNull()
  })

  it('does not reorder the caller s array', () => {
    const list = [{ id: 'a', deal: { offer_max: 1 } }, { id: 'b', deal: { offer_max: 2 } }]
    headlineProperty(list)
    expect(list[0].id).toBe('a')
  })
})

describe('the queue script avoids its siblings two traps', () => {
  const SCRIPT = read('scripts/assign-properties-to-pedro-houses.mjs')
  // The script DOCUMENTS both traps by name, so the absence assertions below
  // have to read code rather than prose. Same mistake caught three times in
  // this feature: never grep a file for a word it explains.
  const CODE = SCRIPT
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('does NOT filter to mobiles', () => {
    // Estate agency switchboards are landlines. isTextableUkMobile would drop
    // 100% of the input and read as "no properties found".
    expect(CODE).not.toMatch(/isTextableUkMobile/)
  })

  it('does NOT run the paid line-status screen', () => {
    // A mobile-subscription check that returns unknown for landlines and fails
    // open anyway: GBP 5.29 per 1,000 to learn nothing.
    expect(CODE).not.toMatch(/dropDeadNumbers|screenLineStatus|lookups\.twilio\.com/)
    // ...and it must not have quietly imported them either.
    expect(CODE).not.toMatch(/from '\.\/lib\/line-status\.mjs'/)
    expect(CODE).not.toMatch(/from '\.\/lib\/verify-phone\.mjs'/)
  })

  it('is dry by default', () => {
    expect(SCRIPT).toMatch(/const APPLY = process\.argv\.includes\('--apply'\)/)
  })

  it('never overwrites a contact another agent owns', () => {
    // wk_contacts.phone is globally unique and wk_contact_locked_agent has no
    // unlock, so stealing a row permanently blocks one of the two agents.
    expect(SCRIPT).toMatch(/ignoreDuplicates: true/)
    expect(SCRIPT).toMatch(/contact\.owner_agent_id !== agentId/)
    expect(SCRIPT).toMatch(/already owned by another agent/)
  })

  it('flips the WHOLE branch to human, never one property', () => {
    expect(SCRIPT).toMatch(/call_channel: 'human'/)
    expect(SCRIPT).toMatch(/\.in\('id', branch\.properties\.map\(\(p\) => p\.id\)\)/)
  })

  it('refuses to touch an existing account rather than resetting it', () => {
    // The wk-create-agent landmine: on an email collision it rotates the
    // password and overwrites the name and role, with no warning.
    expect(SCRIPT).toMatch(/Refusing to touch it/)
  })

  it('pages past the 1000-row PostgREST cap', () => {
    expect(SCRIPT).toMatch(/\.range\(from, from \+ PAGE - 1\)/)
  })

  it('stacks above the existing queue instead of reordering it', () => {
    expect(SCRIPT).toMatch(/maxPriority \+ \(branches\.length - i\)/)
  })
})
