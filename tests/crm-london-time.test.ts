// Every date or time the CRM shows is London time, whatever zone the laptop
// is set to.
//
// 6 Oct 2026: call 82e58639 started at 10:44:01 UTC, 11:44 London. Pedro's
// Call history showed "6 Oct, 06:44", the same instant rendered in his
// laptop's zone (UTC-4), because the formatter passed no timeZone.

// Pretend to be Pedro's laptop before any date is formatted.
process.env.TZ = 'America/New_York'

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { ukDateTime, ukTime, ukDate, ukDateKey } from '../src/features/crm/lib/ukTime'
import { formatTimeOnly, formatDateTime } from '../src/features/crm/data/helpers'
import { londonDayKey, londonDayStartMs, londonDayEndMs, shiftDayKey } from '../src/features/crm/lib/dates'

const PEDRO_CALL = '2026-10-06T10:44:01Z'

describe('the laptop really is in New York for this test', () => {
  it('local hours are New York hours', () => {
    expect(new Date(PEDRO_CALL).getHours()).toBe(6)
    // The exact output Pedro saw, from the old unpinned formatter.
    expect(new Date(PEDRO_CALL).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })).toBe('6 Oct, 06:44')
  })
})

describe('London formatters', () => {
  it('summer: Pedro\'s call reads 11:44', () => {
    expect(ukDateTime(PEDRO_CALL)).toBe('6 Oct, 11:44')
    expect(ukTime(PEDRO_CALL)).toBe('11:44')
    expect(ukDate(PEDRO_CALL)).toBe('6 Oct')
    expect(formatTimeOnly(PEDRO_CALL)).toBe('11:44')
    expect(formatDateTime(PEDRO_CALL)).toBe('6 Oct, 11:44')
  })

  it('winter: London is on UTC', () => {
    expect(ukTime('2026-12-01T10:44:00Z')).toBe('10:44')
    expect(ukDateTime('2026-12-01T10:44:00Z')).toBe('1 Dec, 10:44')
  })

  it('near midnight the London calendar day wins', () => {
    // 23:30 UTC on 6 Oct is 00:30 on 7 Oct in London, 19:30 on 6 Oct in New York.
    expect(ukDate('2026-10-06T23:30:00Z')).toBe('7 Oct')
    expect(ukDateKey('2026-10-06T23:30:00Z')).toBe('2026-10-07')
    // 03:30 UTC on 7 Oct is still 6 Oct in New York but 7 Oct in London.
    expect(ukDateTime('2026-10-07T03:30:00Z')).toBe('7 Oct, 04:30')
  })
})

describe('Calls page date filters use London days', () => {
  it('a London day starts at London midnight', () => {
    expect(new Date(londonDayStartMs('2026-10-06')).toISOString()).toBe('2026-10-05T23:00:00.000Z')
    expect(new Date(londonDayEndMs('2026-10-06')).toISOString()).toBe('2026-10-06T22:59:59.999Z')
    expect(new Date(londonDayStartMs('2026-12-01')).toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('calendar arithmetic crosses months and the clock change', () => {
    expect(shiftDayKey('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDayKey('2026-10-25', 1)).toBe('2026-10-26')
    expect(new Date(londonDayEndMs('2026-10-25')).toISOString()).toBe('2026-10-25T23:59:59.999Z')
  })

  it('today is London\'s today', () => {
    expect(londonDayKey(new Date('2026-10-06T23:30:00Z'))).toBe('2026-10-07')
  })
})

// Static guard: no date formatter in the CRM may fall back to the laptop zone.
const root = resolve(__dirname, '..')
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}
const FILES = [
  ...walk(resolve(root, 'src/features/crm')),
  ...walk(resolve(root, 'src/core/ui')).filter((f) => f.endsWith('.tsx')),
]
const CALL = /\.(toLocaleString|toLocaleTimeString|toLocaleDateString)\(|new Intl\.DateTimeFormat\(/g
const DATE_FIELDS = /\b(hour|minute|day|month|weekday|year|dateStyle|timeStyle)\b/
// toLocaleString is also the number formatter (money, counts). It counts as a
// date call only when it asks for date fields or is called on something that
// is plainly a date.
const DATE_RECEIVER = /(new Date\((?:[^()]|\([^()]*\))*\)|\b(?:d|date|dt|time|ts|when)|At)\s*$/

function unpinned(): string[] {
  const bad: string[] = []
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(CALL)) {
      let i = m.index! + m[0].length
      let depth = 1
      while (i < src.length && depth) {
        if (src[i] === '(') depth++
        else if (src[i] === ')') depth--
        i++
      }
      const args = src.slice(m.index! + m[0].length, i - 1)
      if (/timeZone/.test(args)) continue
      const receiver = src.slice(Math.max(0, m.index! - 80), m.index!).split('\n').pop() ?? ''
      const isDate = m[1] !== 'toLocaleString' || DATE_FIELDS.test(args) || DATE_RECEIVER.test(receiver)
      if (!isDate) continue
      const line = src.slice(0, m.index!).split('\n').length
      bad.push(`${relative(root, file)}:${line}`)
    }
  }
  return bad
}

describe('static guard', () => {
  it('every CRM date or time formatter pins a timeZone', () => {
    expect(unpinned()).toEqual([])
  })

  it('the guard can see an unpinned call (self check)', () => {
    expect(DATE_RECEIVER.test('{new Date(c.startedAt)')).toBe(true)
    expect(DATE_RECEIVER.test('`£${Math.round(n)')).toBe(false)
    expect(DATE_FIELDS.test("'en-GB', { hour: '2-digit' }")).toBe(true)
  })
})
