// Finding the address we already hold for a branch.
//
// Hugo, 2026-08-14, told to paste it by hand: "why do I need to paste the
// address? The system has the email, so the system should just add the email
// there, correct?" He was right. An inbound email creates its OWN contact keyed
// on the address, so the reply from the branch lands on a second row the branch
// card knows nothing about. Zest is the proof: Leanne Jameson emailed on 13 Aug
// asking for the proof of funds on Welwyn Park by name, and the card still said
// "contact has no email address".
//
// The risk this carries is real, so the matching is deliberately narrow: an
// offer emailed to the wrong branch is worse than one not sent, and every
// candidate is shown to Hugo with the evidence before anything goes.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { searchableStreet, agencySlug } from '../api/lib/branch-email-match'

const root = resolve(__dirname, '..')
// THE LOOKUP MOVED TO api/lib/branch-email-lookup.ts on 17 Aug so the cockpit
// could resolve the same address the pipeline modal offers (they disagreed on
// Welwyn Park Road: one had leanne@movewithzest.co.uk, the other said the
// branch had no address at all). The rules below are unchanged; they are just
// pinned where they now live. ROUTE stays for the auth and shape pins.
const ROUTE = readFileSync(resolve(root, 'api/lib/branch-email-lookup.ts'), 'utf8')
  + readFileSync(resolve(root, 'api/crm/branch-emails.ts'), 'utf8')
const SHAPE = readFileSync(resolve(root, 'api/lib/branch-email-match.ts'), 'utf8')

describe('the part of the street worth searching for', () => {
  it('drops the thoroughfare, because that is what people leave off', () => {
    // The listing says "Welwyn Park Road". Leanne wrote "Welwyn Park". Matching
    // the full street would have missed the one email that proves the address.
    expect(searchableStreet('Welwyn Park Road, Hull, North Humberside, HU6')).toBe('Welwyn Park')
  })

  it('keeps it when dropping would leave one word', () => {
    // "Orion" alone would match anything. Two words is the floor.
    expect(searchableStreet('Orion Way, Grimsby, DN34')).toBe('Orion Way')
  })

  it('strips anything that would change a PostgREST or() filter', () => {
    // A comma or a parenthesis in the value re-parses the whole query.
    expect(searchableStreet('St Michael(s), Road, Bispham')).toBe('St Michaels')
    expect(searchableStreet('')).toBe('')
    expect(searchableStreet(null)).toBe('')
  })
})

describe('the agency, as a domain would spell it', () => {
  it('drops the town, because the domain belongs to the agency not the branch', () => {
    expect(agencySlug('DDM Residential, Grimsby')).toBe('ddmresidential')
    expect(agencySlug('Zest, Hull')).toBe('zest')
  })

  it('is empty when there is nothing to go on', () => {
    expect(agencySlug('')).toBe('')
    expect(agencySlug(null)).toBe('')
  })
})

describe('what it refuses to do', () => {
  it('only ever offers an address with the evidence attached', () => {
    // Filling a recipient in silently is how an offer goes to the wrong branch.
    // The reason is not optional on the shape, so a candidate cannot reach the
    // screen without one.
    expect(SHAPE).toMatch(/reason: string;/)
    expect(ROUTE).toMatch(/They emailed you about/)
    expect(ROUTE).toMatch(/nobody has written to us about this house from it/)
  })

  it('ranks "they wrote to us about this house" above a domain guess', () => {
    expect(ROUTE).toMatch(/wrote_about_house: 0, domain_match: 1/)
  })

  it('will not guess from a short agency name', () => {
    // A three-letter slug matches half the internet.
    expect(ROUTE).toMatch(/slug\.length >= 4/)
    expect(ROUTE).toMatch(/street\.length >= 4/)
  })

  it('reads only. It never writes an address onto a contact', () => {
    expect(ROUTE).not.toMatch(/\.update\(/)
    expect(ROUTE).not.toMatch(/\.insert\(/)
    expect(ROUTE).not.toMatch(/\.upsert\(/)
  })

  it('is staff only, decided by the database', () => {
    expect(ROUTE).toMatch(/rpc\('wk_is_agent_or_admin'\)/)
    expect(ROUTE).toMatch(/status: 403/)
  })

  it('reads inbound mail only: our own sends prove nothing about them', () => {
    expect(ROUTE).toMatch(/\.eq\('direction', 'inbound'\)/)
  })
})
