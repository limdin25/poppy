// WHICH HOUSE IS THIS CONVERSATION ABOUT.
//
// Hugo, 2026-08-24: "all card you need to tag which deal is whatsapp
// conversation for, make very clean on chat card and everywhere."
//
// The inbox list held three kinds of thread that looked identical: a plumber
// lead, an estate agency, and a builder invited to price a house. A builder
// replying "yeah Wednesday works" could not be attributed without opening the
// thread and reading back through it.
//
// The point of these tests is that ONE function answers it. Two screens each
// deciding "which house is this" their own way is the exact bug shape this repo
// has been bitten by twice already (api/lib/uk-places.ts, api/lib/brrr-offer.ts).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dealTagFor, shortAddress } from '../src/features/crm/lib/dealTag'

describe('the deal tag', () => {
  it('labels a BUILDER with the house we invited them to', () => {
    const tag = dealTagFor({
      customFields: { lead_type: 'builder', builder_property: 'Windsor Road, Buxton' },
    })
    expect(tag).toEqual({ label: 'Windsor Road, Buxton', full: 'Windsor Road, Buxton', kind: 'builder' })
  })

  it('labels a BRANCH with the deal that speaks for the thread', () => {
    const tag = dealTagFor({
      customFields: { lead_type: 'estate_agent' },
      deal: { address: 'Conway Road, Newport, Gwent, NP19 7LB' },
    })
    expect(tag?.kind).toBe('branch')
    expect(tag?.label).toBe('Conway Road, Newport')
    // The hover keeps the postcode, which is the half you need when two
    // streets share a name.
    expect(tag?.full).toBe('Conway Road, Newport, Gwent, NP19 7LB')
  })

  it('a builder is NEVER labelled with a branch deal that happens to match', () => {
    // A builder can sit in a property pipeline and can share a phone tail with
    // nothing at all, but if a deal ever resolves for their row the house we
    // invited them to still wins. Confirming a viewing with the wrong side of
    // the same deal costs a builder trip.
    const tag = dealTagFor({
      customFields: { lead_type: 'builder', builder_property: 'Baker Street, Clowne' },
      deal: { address: 'Somewhere Else, Sheffield' },
    })
    expect(tag).toMatchObject({ kind: 'builder', label: 'Baker Street, Clowne' })
  })

  it('falls back to property_address where a screen loads no deal links', () => {
    // The contacts table has no usePropertyLinks, so without this a branch is
    // labelled in the inbox and bare in the list.
    const tag = dealTagFor({
      customFields: { property_address: 'Church Street, Leigh, WN7 1AA' },
    })
    expect(tag).toMatchObject({ kind: 'branch', label: 'Church Street, Leigh' })
  })

  it('renders NOTHING for a plumber lead, so the reviews inbox is untouched', () => {
    expect(dealTagFor({ customFields: { owner_name: 'Dave', website: 'x.co.uk' } })).toBeNull()
    expect(dealTagFor({})).toBeNull()
    expect(dealTagFor({ customFields: null, deal: null })).toBeNull()
    // A builder we have not invited anywhere yet has no house to name.
    expect(dealTagFor({ customFields: { lead_type: 'builder' } })).toBeNull()
    // An empty address is not an address.
    expect(dealTagFor({ deal: { address: '   ' } })).toBeNull()
  })
})

describe('the shortening rule does not drift from the one that WRITES the tag', () => {
  // api/lib/builder-outreach.ts:houseTag() shortens the address when it writes
  // custom_fields.builder_property. This file shortens again on the way out,
  // and also shortens raw deal addresses that never went through that path. If
  // the two ever disagree the same house prints two different ways on two
  // screens, which is the whole thing this chip exists to stop.
  const houseTagSrc = readFileSync(
    resolve(__dirname, '..', 'api/lib/builder-outreach.ts'), 'utf8',
  )

  it('is the same rule, first two comma parts capped at 60', () => {
    const fn = houseTagSrc.slice(houseTagSrc.indexOf('export function houseTag'))
      .slice(0, houseTagSrc.slice(houseTagSrc.indexOf('export function houseTag')).indexOf('\n}') + 2)
    expect(fn).toContain("split(',')")
    expect(fn).toContain('slice(0, 2)')
    expect(fn).toContain('slice(0, 60)')
  })

  it('agrees on real addresses, including the awkward ones', () => {
    // The server's rule, re-implemented here from its source shape, run
    // side by side with ours on addresses taken off real properties.
    const houseTag = (address: string) => {
      const parts = String(address ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      if (!parts.length) return ''
      return parts.slice(0, 2).join(', ').slice(0, 60)
    }
    for (const address of [
      'Windsor Road, Buxton, Derbyshire, SK17 7NS',
      'Conway Road, Newport',
      'Baker Street, Clowne, Chesterfield, S43 4JX',
      '  Church Street ,  Leigh  , WN7 1AA ',
      'Somewhere With A Very Long Street Name Indeed, A Very Long Town Name Too, X1 1XX',
      'Nocommas Lane',
      '',
    ]) {
      expect(`${address} => ${shortAddress(address)}`).toBe(`${address} => ${houseTag(address)}`)
    }
  })
})

describe('the chip is on every surface that lists a conversation', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

  it('the inbox chat card, which is the one Hugo asked for by name', () => {
    const inbox = read('src/features/crm/pages/InboxPage.tsx')
    expect(inbox).toMatch(/import DealTagChip/)
    expect(inbox).toMatch(/data-testid=\{`inbox-deal-tag-\$\{r\.id\}`\}/)
    // Fed the SAME deal the row already resolves for its identity line, not a
    // second lookup that could disagree with it.
    expect(inbox).toMatch(/deal=\{dealForPhone\(r\.phone\)\}/)
  })

  it('the open thread header', () => {
    expect(read('src/features/crm/pages/InboxPage.tsx'))
      .toMatch(/data-testid="inbox-thread-deal-tag"/)
  })

  it('the contacts table, and its Property column stops printing a dash at builders', () => {
    const contacts = read('src/features/crm/pages/ContactsPage.tsx')
    expect(contacts).toMatch(/import DealTagChip/)
    expect(contacts).toMatch(/contacts-deal-tag-/)
    expect(contacts).toMatch(/property_address \|\| c\.customFields\?\.builder_property/)
  })

  it('no screen works the label out for itself', () => {
    // The one rule worth enforcing: read builder_property through dealTagFor,
    // never straight off custom_fields in a component.
    for (const p of [
      'src/features/crm/pages/InboxPage.tsx',
      'src/features/crm/pages/ContactsPage.tsx',
    ]) {
      // Comments explain the rule and must not trip it, so they come out
      // first: JSX {/* ... */} blocks, /* ... */ blocks, then // lines.
      const src = read(p)
        .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
      const stray = src
        .split('\n')
        .filter((l) => l.includes('builder_property') && !l.trim().startsWith('//'))
      // ContactsPage's Property column is the one allowed direct read, because
      // it prints the raw value in a table cell rather than deriving a label.
      for (const line of stray) {
        expect(`${p}: ${line.trim()}`).toMatch(/property_address \|\| c\.customFields\?\.builder_property/)
      }
    }
  })
})
