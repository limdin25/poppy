// "We spoke [spoke_when] about the house" has to be something a human says.
//
// Hugo 2026-08-18: "the script has to be dynamic of the days that we spoke to
// the person." spokeWhenPhrase is the only producer of that value, and
// propertyOpenerLine is the coach card's copy of the script's first blue line,
// so both are pinned word-perfect here, including against the script HTML
// itself so the card and the pane cannot drift apart.
//
// Days are CALENDAR days in Europe/London: a call at 11pm Friday is
// "yesterday" on Saturday morning. 2026-08-18 (the fixed "now" below) is a
// Tuesday.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spokeWhenPhrase, propertyOpenerLine } from '../src/features/crm/lib/spokeWhen'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const NOW = new Date('2026-08-18T12:00:00Z') // Tuesday, 13:00 in London (BST)

describe('spokeWhenPhrase', () => {
  it('same London day is "earlier today"', () => {
    expect(spokeWhenPhrase('2026-08-18T06:00:00Z', NOW)).toBe('earlier today')
  })

  it('one calendar day back is "yesterday", even late at night', () => {
    expect(spokeWhenPhrase('2026-08-17T21:00:00Z', NOW)).toBe('yesterday')
  })

  it('2 to 6 days back is the weekday, the way people say it', () => {
    expect(spokeWhenPhrase('2026-08-15T10:00:00Z', NOW)).toBe('on Saturday')
    expect(spokeWhenPhrase('2026-08-14T10:00:00Z', NOW)).toBe('on Friday')
    expect(spokeWhenPhrase('2026-08-12T10:00:00Z', NOW)).toBe('on Wednesday')
  })

  it('7 to 13 days back is "last week"', () => {
    expect(spokeWhenPhrase('2026-08-11T10:00:00Z', NOW)).toBe('last week')
    expect(spokeWhenPhrase('2026-08-05T10:00:00Z', NOW)).toBe('last week')
  })

  it('older is the date', () => {
    expect(spokeWhenPhrase('2026-07-29T10:00:00Z', NOW)).toBe('on 29 July')
  })

  it('LONDON midnight, not UTC midnight, decides the day', () => {
    // 23:30 UTC on the 17th is 00:30 on the 18th in London (BST). Same
    // London day as the morning after, so "earlier today", not "yesterday".
    expect(spokeWhenPhrase('2026-08-17T23:30:00Z', new Date('2026-08-18T08:00:00Z')))
      .toBe('earlier today')
  })

  it('a missing or broken timestamp is silence, never a bracket', () => {
    expect(spokeWhenPhrase(null, NOW)).toBe('')
    expect(spokeWhenPhrase(undefined, NOW)).toBe('')
    expect(spokeWhenPhrase('', NOW)).toBe('')
    expect(spokeWhenPhrase('not-a-date', NOW)).toBe('')
  })

  it('a future timestamp (clock skew) reads as earlier today', () => {
    expect(spokeWhenPhrase('2026-08-18T15:00:00Z', NOW)).toBe('earlier today')
    expect(spokeWhenPhrase('2026-08-19T10:00:00Z', NOW)).toBe('earlier today')
  })
})

describe('propertyOpenerLine mirrors the script word for word', () => {
  const html = read('src/core/content/property-call-script.html')

  it('call two: the callback opener, exactly the script line', () => {
    const line = 'Hi [branch_contact_name], it\'s Pedro from Unico. We spoke [spoke_when] about [property_street]. I said I\'d do the homework and come back to you, so here I am.'
    expect(html).toContain(line)
    const expected = line
      .replace('[branch_contact_name]', 'Guy')
      .replace('[spoke_when]', 'yesterday')
      .replace('[property_street]', 'Friars Close')
    expect(propertyOpenerLine({
      callMode: 'offer', contactName: 'Guy', spokeWhen: 'yesterday', street: 'Friars Close',
    })).toBe(expected)
  })

  it('call two: collapses match the script collapses', () => {
    expect(propertyOpenerLine({ callMode: 'offer', spokeWhen: 'yesterday', street: 'Friars Close' }))
      .toBe('Hi, it\'s Pedro from Unico. We spoke yesterday about Friars Close. I said I\'d do the homework and come back to you, so here I am.')
    expect(propertyOpenerLine({ callMode: 'offer', contactName: 'Guy', street: 'Friars Close' }))
      .toBe('Hi Guy, it\'s Pedro from Unico. We spoke the other day about Friars Close. I said I\'d do the homework and come back to you, so here I am.')
    expect(propertyOpenerLine({ callMode: 'offer', contactName: 'Guy', spokeWhen: 'yesterday' }))
      .toBe('Hi Guy, it\'s Pedro from Unico. We spoke yesterday. I said I\'d do the homework and come back to you, so here I am.')
  })

  it('call one: the availability opener, exactly the script line', () => {
    const line = 'Hi, hello. I\'m calling about the property on [property_street], the [bedrooms] bed [property_type]. Is that one still available?'
    expect(html).toContain(line)
    const expected = line
      .replace('[property_street]', 'Friars Close')
      .replace('[bedrooms]', '3')
      .replace('[property_type]', 'end of terrace')
    expect(propertyOpenerLine({
      callMode: 'discovery', street: 'Friars Close', bedrooms: '3', propertyType: 'end of terrace',
    })).toBe(expected)
  })

  it('call one: no house facts still opens as a buyer, never as a bracket', () => {
    expect(propertyOpenerLine({ callMode: 'discovery' }))
      .toBe('Hi, hello. I\'m calling about one of your properties. Is it still available?')
    expect(propertyOpenerLine({ callMode: 'discovery', street: 'Friars Close' }))
      .toBe('Hi, hello. I\'m calling about the property on Friars Close. Is that one still available?')
  })

  it('no long dash, no curly quote, no ellipsis character, source or output', () => {
    const forbidden = /[—–‘’“”…]/
    expect(read('src/features/crm/lib/spokeWhen.ts')).not.toMatch(forbidden)
    expect(read('src/features/crm/hooks/useBranchLastCall.ts')).not.toMatch(forbidden)
    for (const out of [
      spokeWhenPhrase('2026-07-29T10:00:00Z', NOW),
      propertyOpenerLine({ callMode: 'offer', contactName: 'Guy', spokeWhen: 'yesterday', street: 'Friars Close' }),
      propertyOpenerLine({ callMode: 'discovery', street: 'Friars Close', bedrooms: '3', propertyType: 'end of terrace' }),
    ]) {
      expect(out).not.toMatch(forbidden)
    }
  })
})
