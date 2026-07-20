import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'

// review-guards creates a supabase client at import time — give it dummy env.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'

const {
  isStopMessage,
  normalizePhone,
  lintTemplate,
  ensureSmsOptOut,
  emailFooter,
  insideQuietWindow,
  currentPeriodStart,
  validateTwilioSignature,
} = await import('../api/lib/review-guards.js')

describe('isStopMessage (STOP keyword — mirrors the proven CRM regex)', () => {
  it.each(['STOP', 'stop', ' Stop ', 'STOPALL', 'unsubscribe', 'QUIT', 'cancel', 'END', 'opt out', 'STOP.', 'stop!'])(
    'treats %j as STOP', (s) => expect(isStopMessage(s)).toBe(true),
  )
  it.each(['please stop calling me maybe', 'no thanks', '', 'can you stop by tomorrow?'])(
    'does not treat %j as STOP', (s) => expect(isStopMessage(s)).toBe(false),
  )
})

describe('normalizePhone (UK-first E.164)', () => {
  it('converts UK national mobiles', () => expect(normalizePhone('07863 992555')).toBe('+447863992555'))
  it('adds + to 447 numbers', () => expect(normalizePhone('447863992555')).toBe('+447863992555'))
  it('keeps existing E.164', () => expect(normalizePhone('+15551234567')).toBe('+15551234567'))
  it('handles 00 prefix', () => expect(normalizePhone('00447863992555')).toBe('+447863992555'))
  it('rejects junk', () => expect(normalizePhone('not-a-phone')).toBe(null))
  it('rejects empty', () => expect(normalizePhone('')).toBe(null))
})

describe('lintTemplate (incentives blocked, review_link required)', () => {
  it('accepts a clean template', () => {
    expect(lintTemplate('Hey {first_name}, please review {business_name}: {review_link}').ok).toBe(true)
  })
  it.each(['10% discount if you review', 'free pizza for a review {review_link}', 'win a prize {review_link}', 'here is a voucher {review_link}'])(
    'blocks incentive language: %j', (t) => expect(lintTemplate(t).ok).toBe(false),
  )
  it('requires the review link variable', () => {
    const r = lintTemplate('Hey {first_name}, please review us!')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('{review_link}')
  })
})

describe('ensureSmsOptOut', () => {
  it('appends the opt-out line when missing', () => {
    expect(ensureSmsOptOut('Please review us')).toBe('Please review us Reply STOP to opt out.')
  })
  it('leaves messages that already mention STOP', () => {
    const body = 'Please review us. Text STOP to opt out'
    expect(ensureSmsOptOut(body)).toBe(body)
  })
})

describe('emailFooter', () => {
  it('identifies the business and links the unsubscribe URL', () => {
    const html = emailFooter("Smith's Plumbing", 'https://x/unsub?token=t')
    expect(html).toContain("Smith's Plumbing")
    expect(html).toContain('https://x/unsub?token=t')
    expect(html).toContain('Unsubscribe')
  })
})

describe('insideQuietWindow (09:00-20:00 London)', () => {
  const s = { quiet_start: 9, quiet_end: 20, timezone: 'Europe/London' }
  it('inside at noon UK summer', () => {
    expect(insideQuietWindow(s, new Date('2026-07-20T11:00:00Z'))).toBe(true) // 12:00 BST
  })
  it('outside at 07:30 local', () => {
    expect(insideQuietWindow(s, new Date('2026-07-20T06:30:00Z'))).toBe(false) // 07:30 BST
  })
  it('outside at 20:30 local (window end exclusive)', () => {
    expect(insideQuietWindow(s, new Date('2026-07-20T19:30:00Z'))).toBe(false) // 20:30 BST
  })
  it('edge: 09:05 local is inside', () => {
    expect(insideQuietWindow(s, new Date('2026-07-20T08:05:00Z'))).toBe(true) // 09:05 BST
  })
})

describe('currentPeriodStart', () => {
  it('is the first of the UTC month', () => {
    expect(currentPeriodStart(new Date('2026-07-20T15:00:00Z'))).toBe('2026-07-01')
    expect(currentPeriodStart(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-01')
  })
})

describe('validateTwilioSignature (HMAC-SHA1, fail closed)', () => {
  const url = 'https://app.heyelsie.com/api/webhooks/twilio-reviews-sms'
  const params = { Body: 'STOP', From: '+447863992555', To: '+447700900123', MessageSid: 'SM123' }
  const token = 'test-auth-token'
  const data = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join('')
  const goodSig = createHmac('sha1', token).update(data).digest('base64')

  it('accepts a valid signature', async () => {
    expect(await validateTwilioSignature({ url, params, signature: goodSig, authToken: token })).toBe(true)
  })
  it('rejects a bad signature', async () => {
    expect(await validateTwilioSignature({ url, params, signature: 'nope', authToken: token })).toBe(false)
  })
  it('fails closed with no signature', async () => {
    expect(await validateTwilioSignature({ url, params, signature: null, authToken: token })).toBe(false)
  })
  it('fails closed with no auth token', async () => {
    expect(await validateTwilioSignature({ url, params, signature: goodSig, authToken: '' })).toBe(false)
  })
})
