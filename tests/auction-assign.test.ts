// When an auction office goes onto Pedro's Auction queue (Hugo, 2026-09-18):
// one call per office covers all its lots; at most one call a day; an office
// he has spoken to comes back only for a lot he has not asked about; nobody
// answered means try tomorrow, three tries, then weekly.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs, no types
import { decideAuctionDeal, UNASKED, MIN_GAP_HOURS, SILENT_WEEKLY_GAP_HOURS } from '../scripts/lib/auction-redial-policy.mjs'

const NOW = Date.parse('2026-09-19T09:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('decideAuctionDeal', () => {
  it('an office never rung is queued at the front', () => {
    expect(decideAuctionDeal({ lastCallAt: null, lastOutcome: null, unaskedLots: 2, nowMs: NOW }))
      .toMatchObject({ deal: true, back: false })
  })
  it('an office with nothing left to ask about is never queued', () => {
    expect(decideAuctionDeal({ lastCallAt: null, lastOutcome: null, unaskedLots: 0, nowMs: NOW }).deal).toBe(false)
  })
  it('spoken to today: not again today', () => {
    expect(decideAuctionDeal({ lastCallAt: hoursAgo(3), lastOutcome: 'Lot: call back', unaskedLots: 1, nowMs: NOW }).deal).toBe(false)
  })
  it('spoken to yesterday with a lot not asked about: back on, behind the fresh ones', () => {
    expect(decideAuctionDeal({ lastCallAt: hoursAgo(MIN_GAP_HOURS + 1), lastOutcome: 'Lot: figure given', unaskedLots: 1, nowMs: NOW }))
      .toMatchObject({ deal: true, back: true })
  })
  it('is NOT the 14-day Houses hold: an auction office is back the next day', () => {
    expect(decideAuctionDeal({ lastCallAt: hoursAgo(24), lastOutcome: 'Lot: call back', unaskedLots: 1, nowMs: NOW }).deal).toBe(true)
  })
  it('no answer: retried the next day, then weekly after three', () => {
    expect(decideAuctionDeal({ lastCallAt: hoursAgo(21), lastOutcome: 'Voicemail', silentTries: 1, unaskedLots: 1, nowMs: NOW }).deal).toBe(true)
    expect(decideAuctionDeal({ lastCallAt: hoursAgo(10), lastOutcome: 'No pickup', silentTries: 1, unaskedLots: 1, nowMs: NOW }).deal).toBe(false)
    expect(decideAuctionDeal({ lastCallAt: hoursAgo(48), lastOutcome: 'Voicemail', silentTries: 3, unaskedLots: 1, nowMs: NOW }).deal).toBe(false)
    expect(decideAuctionDeal({ lastCallAt: hoursAgo(SILENT_WEEKLY_GAP_HOURS + 1), lastOutcome: 'Voicemail', silentTries: 3, unaskedLots: 1, nowMs: NOW }).deal).toBe(true)
  })
  it('a call with no outcome pressed counts as unanswered', () => {
    expect(decideAuctionDeal({ lastCallAt: hoursAgo(21), lastOutcome: null, silentTries: 1, unaskedLots: 1, nowMs: NOW }).reason)
      .toMatch(/nobody answered/)
  })
  it('a lot counts as not asked about until an outcome other than no answer is pressed', () => {
    expect(UNASKED.has('new')).toBe(true)
    expect(UNASKED.has('no_answer')).toBe(true)
    for (const s of ['figure_given', 'call_back', 'viewing_booked', 'sold', 'not_suitable']) expect(UNASKED.has(s)).toBe(false)
  })
})

describe('the two assign scripts never cross desks', () => {
  it('the Houses script only ever loads Houses rows', () => {
    expect(read('scripts/assign-properties-to-pedro-houses.mjs')).toMatch(/\.eq\('desk', 'houses'\)/)
  })
  it('the Auction script only loads Auction rows, and skips a phone already on Houses', () => {
    const src = read('scripts/assign-auction-lots-to-pedro.mjs')
    expect(src).toMatch(/\.eq\('desk', 'auction'\)/)
    expect(src).toMatch(/if \(existing && existing\.desk !== 'auction'\) \{/)
    expect(src).toMatch(/desk: 'auction', custom_fields: facts/)
    expect(src).toMatch(/lead_type: 'auctioneer'/)
  })
  it('the outcome buttons and the API agree on the list', () => {
    const pane = read('src/features/crm/components/live-call/LotsPane.tsx')
    const api = read('api/crm/auction-outcome.ts')
    const keys = [...pane.matchAll(/\{ key: '([a-z_]+)', label:/g)].map((m) => m[1])
    const apiList = api.match(/export const OUTCOMES = \[([^\]]+)\]/)?.[1] ?? ''
    expect(keys.length).toBeGreaterThan(3)
    for (const k of keys) expect(apiList).toContain(`'${k}'`)
  })
})
