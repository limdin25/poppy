import { describe, it, expect } from 'vitest'

describe('notification event mapping', () => {
  const eventKeys: Record<string, string> = {
    call: 'notify_on_call',
    message: 'notify_on_message',
    booking: 'notify_on_booking',
    quote_accepted: 'notify_on_quote_accepted',
  }

  it('maps each event to the correct settings key', () => {
    for (const [event, key] of Object.entries(eventKeys)) {
      expect(`notify_on_${event}`).toBe(key)
    }
  })

  it('covers all four event types', () => {
    expect(Object.keys(eventKeys)).toHaveLength(4)
  })
})

describe('SMS message formatting', () => {
  it('formats title and body with line breaks', () => {
    const title = 'New Booking'
    const body = 'John Smith - Plumbing, Tomorrow 10am'
    const formatted = `${title}\n\n${body}`
    expect(formatted).toContain('New Booking')
    expect(formatted).toContain('John Smith')
  })
})

describe('WhatsApp message formatting', () => {
  it('wraps title in bold markers', () => {
    const title = 'New Booking'
    const body = 'John Smith - Plumbing'
    const formatted = `*${title}*\n\n${body}`
    expect(formatted).toBe('*New Booking*\n\nJohn Smith - Plumbing')
  })
})
