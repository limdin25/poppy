import { describe, it, expect } from 'vitest'
import { renderTemplate, waWindowOpen, isApproved } from '../src/features/crm/lib/waAdmin'

// The 24 hour rule decides which composer the agent gets, so it is worth
// testing on its own: WhatsApp delivers a free-form reply only within 24
// hours of the LEAD's last inbound WhatsApp. Our own outbound messages do
// not reopen it, and an SMS never counts.

const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString()

describe('waWindowOpen', () => {
  it('is open when the lead messaged inside 24 hours', () => {
    expect(waWindowOpen([{ direction: 'inbound', channel: 'whatsapp', createdAt: at(2) }])).toBe(true)
  })

  it('is shut when their last WhatsApp is older than 24 hours', () => {
    expect(waWindowOpen([{ direction: 'inbound', channel: 'whatsapp', createdAt: at(25) }])).toBe(false)
  })

  it('our own outbound messages do NOT reopen it', () => {
    expect(waWindowOpen([
      { direction: 'inbound', channel: 'whatsapp', createdAt: at(40) },
      { direction: 'outbound', channel: 'whatsapp', createdAt: at(1) },
    ])).toBe(false)
  })

  it('a recent SMS does not open the WhatsApp window', () => {
    expect(waWindowOpen([{ direction: 'inbound', channel: 'sms', createdAt: at(1) }])).toBe(false)
  })

  it('an empty thread is shut, not open', () => {
    expect(waWindowOpen([])).toBe(false)
  })

  it('the boundary is 24 hours, checked against a passed-in clock', () => {
    const now = Date.parse('2026-08-03T12:00:00Z')
    const justInside = { direction: 'inbound', channel: 'whatsapp', createdAt: '2026-08-02T12:00:01Z' }
    const justOutside = { direction: 'inbound', channel: 'whatsapp', createdAt: '2026-08-02T11:59:59Z' }
    expect(waWindowOpen([justInside], now)).toBe(true)
    expect(waWindowOpen([justOutside], now)).toBe(false)
  })
})

describe('renderTemplate (preview only, the server renders the sent copy)', () => {
  it('fills numbered blanks', () => {
    expect(renderTemplate('Hi {{1}}, meet {{2}}.', { '1': 'Hugo', '2': 'Maria' }))
      .toBe('Hi Hugo, meet Maria.')
  })

  it('leaves an unfilled blank visible rather than silently blanking it', () => {
    expect(renderTemplate('Hi {{1}}, from {{2}}.', { '1': 'Hugo' }))
      .toBe('Hi Hugo, from {{2}}.')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('Hi {{ 1 }}!', { '1': 'Hugo' })).toBe('Hi Hugo!')
  })
})

describe('isApproved', () => {
  const t = (status: string) => ({
    sid: 'HX', name: 'n', language: 'en', body: '', date_created: '',
    approval: { status, category: '', rejection_reason: '' },
  })
  it('only approved counts, in any case', () => {
    expect(isApproved(t('approved'))).toBe(true)
    expect(isApproved(t('APPROVED'))).toBe(true)
  })
  it('pending, rejected and paused do not', () => {
    for (const s of ['pending', 'received', 'rejected', 'paused', '']) {
      expect(isApproved(t(s))).toBe(false)
    }
  })
})
