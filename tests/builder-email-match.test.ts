// A builder's emailed quote lands on the builder's card.
//
// 2026-09-15: C E Bettridge & Son Ltd's quote for 125 Shakespeare Street was
// saved on a new contact called "jon_bettridge@outlook.com", so the builder card
// Pedro texts showed nothing and the builder had to text "The quote was sent on
// Friday". Sycamore Carpentry (2 Sep) and Mehmood Builders did the same.
//
// Run over every real email-only contact on file (178) against every builder
// card (325), the rule matched exactly those three and nothing else. The
// estate-agent near misses below are the ones an earlier draft got wrong.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { builderKeyword, senderCarriesKeyword } from '../api/lib/builder-email-match'

const LIB = readFileSync('api/lib/builder-email-match.ts', 'utf8')
const HOOK = readFileSync('supabase/functions/wk-email-webhook/index.ts', 'utf8')

const twin = (s: string) => s.slice(s.indexOf('// --- twin:start ---'), s.indexOf('// --- twin:end ---'))
const matches = (builder: string, email: string, name = '') =>
  senderCarriesKeyword(builderKeyword(builder), email, name)

describe('the builders whose quotes went missing', () => {
  it('jon_bettridge@outlook.com is C E Bettridge & Son Ltd', () => {
    expect(builderKeyword('C E Bettridge & Son Ltd')).toBe('bettridge')
    expect(matches('C E Bettridge & Son Ltd', 'jon_bettridge@outlook.com')).toBe(true)
  })

  it('sycamorecarpentry@hotmail.co.uk is Sycamore Carpentry and Building', () => {
    expect(matches('Sycamore Carpentry and Building', 'sycamorecarpentry@hotmail.co.uk')).toBe(true)
  })

  it('mehmoodqasid6@gmail.com is Mehmood Builders', () => {
    expect(matches('Mehmood Builders', 'mehmoodqasid6@gmail.com')).toBe(true)
  })

  it('a builder on his own domain matches: haydonbuildersltd.com, bravadobuilders.co.uk', () => {
    expect(matches('Haydon Builders Ltd', 'andi@haydonbuildersltd.com')).toBe(true)
    expect(matches('Bravado Builders Ltd', 'info@bravadobuilders.co.uk')).toBe(true)
  })

  it('a display name at a free provider counts', () => {
    expect(matches('C E Bettridge & Son Ltd', 'jb1970@gmail.com', 'Jon Bettridge')).toBe(true)
  })
})

describe('what must never match', () => {
  it('an estate agent employee is not a builder with the same surname', () => {
    expect(matches("Jackson's Builders (Barnsley) Limited", 'helen.jackson@whitakers.co.uk', 'Helen Jackson')).toBe(false)
    expect(matches('Turner Key Developments Ltd', 'louise.turner@thepropertyhive.co.uk')).toBe(false)
  })

  it('an agency domain that merely starts or ends with the name', () => {
    expect(matches('Taylor Nicol Brickwork & Joinery Ltd', 'sam@taylorsestate.agency')).toBe(false)
    expect(matches('T.WHITE BUILDERS & MAINTENANCE', 'sales@denise-white.co.uk')).toBe(false)
  })

  it('a first name is not a trading name', () => {
    expect(builderKeyword('Steve McBride Walling & Fencing')).toBe('mcbride')
    expect(matches('Steve McBride Walling & Fencing', 'steve.smith@gmail.com')).toBe(false)
  })

  it('a name made only of trade words has no keyword at all', () => {
    expect(builderKeyword('Master Builder Services')).toBeNull()
    expect(builderKeyword('Builders In Hull')).toBeNull()
  })

  it('the free provider itself is never the match', () => {
    expect(matches('Outlook Builders', 'someone@outlook.com')).toBe(false)
  })
})

describe('the webhook', () => {
  it('carries a verbatim copy of the rule', () => {
    expect(twin(LIB).length).toBeGreaterThan(500)
    expect(twin(HOOK)).toBe(twin(LIB))
  })

  it('tries the builder rule before the named-house rule and before creating a contact', () => {
    const find = HOOK.slice(HOOK.indexOf('async function findOrCreateContact('))
    const builder = find.indexOf('matchBuilderBySender(supa, email, contactName)')
    expect(builder).toBeGreaterThan(0)
    expect(builder).toBeLessThan(find.indexOf('matchByNamedHouse(supa, emailText)'))
    expect(builder).toBeLessThan(find.indexOf(".rpc('wk_ingest_contacts'"))
  })

  it('only accepts a builder we messaged, and refuses on two', () => {
    const fn = HOOK.slice(HOOK.indexOf('async function matchBuilderBySender('), HOOK.indexOf('async function findOrCreateContact('))
    expect(fn).toContain(".eq('direction', 'outbound')")
    expect(fn).toContain('hits.length === 1')
    expect(fn).toContain('refusing to guess')
  })
})
