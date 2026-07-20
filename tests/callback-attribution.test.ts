import { describe, it, expect } from 'vitest'
import {
  phoneVariants,
  hasRecentDrop,
  attributeCallback,
  CALLBACK_TAG,
  CALLBACK_WINDOW_DAYS,
} from '../api/lib/callback-attribution.js'

// Behaviour 8 — "when a dropped contact comes back, flag it". Fires on ANY
// inbound (call or text, answered or missed) from a contact we voicemail-
// dropped in the last 30 days: permanent 'called-back' tag + move to the
// Callback/Voicemail pipeline column.
const NOW = new Date('2026-07-20T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

describe('phoneVariants (mirror of wk-sms-incoming)', () => {
  it('builds e164 + digits + raw variants', () => {
    const v = phoneVariants('+15551234567')
    expect(v.e164).toBe('+15551234567')
    expect(v.variants).toContain('+15551234567')
    expect(v.variants).toContain('15551234567')
  })

  it('strips the whatsapp: prefix and adds + when missing', () => {
    expect(phoneVariants('whatsapp:+447700900123').e164).toBe('+447700900123')
    expect(phoneVariants('447700900123').e164).toBe('+447700900123')
  })
})

describe('hasRecentDrop', () => {
  const drop = { direction: 'outbound', voicemail_dropped: true, started_at: daysAgo(3) }

  it('true for an outbound dropped call inside the window', () => {
    expect(hasRecentDrop([drop], NOW)).toBe(true)
  })

  it('false when the drop is older than the window', () => {
    expect(hasRecentDrop([{ ...drop, started_at: daysAgo(CALLBACK_WINDOW_DAYS + 1) }], NOW)).toBe(false)
  })

  it('false for non-dropped or inbound calls', () => {
    expect(hasRecentDrop([{ ...drop, voicemail_dropped: false }], NOW)).toBe(false)
    expect(hasRecentDrop([{ ...drop, direction: 'inbound' }], NOW)).toBe(false)
  })

  it('false for empty input / null started_at', () => {
    expect(hasRecentDrop([], NOW)).toBe(false)
    expect(hasRecentDrop([{ ...drop, started_at: null }], NOW)).toBe(false)
  })
})

describe('attributeCallback', () => {
  const drop = { direction: 'outbound', voicemail_dropped: true, started_at: daysAgo(2) }

  it('returns the permanent tag when a known contact with a recent drop comes back', () => {
    const d = attributeCallback({ contactId: 'c1', calls: [drop], now: NOW })
    expect(d).toEqual({ tag: CALLBACK_TAG })
    expect(CALLBACK_TAG).toBe('called-back')
  })

  it('null for unknown contacts (nothing to flag)', () => {
    expect(attributeCallback({ contactId: null, calls: [drop], now: NOW })).toBeNull()
  })

  it('null when we never dropped on them recently', () => {
    expect(attributeCallback({ contactId: 'c1', calls: [], now: NOW })).toBeNull()
    expect(
      attributeCallback({
        contactId: 'c1',
        calls: [{ ...drop, started_at: daysAgo(45) }],
        now: NOW,
      }),
    ).toBeNull()
  })
})
