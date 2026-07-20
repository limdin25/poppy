import { describe, it, expect } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'

const {
  substitute,
  composeSmsBody,
  composeEmail,
  insideWindowAt,
  nextWindowOpen,
  scheduleSlots,
  randomToken,
  firstNameOf,
  DEFAULT_SMS_TEMPLATE,
} = await import('../api/lib/review-send.js')

const SETTINGS = {
  smart_messaging: false,
  sms_template: null as string | null,
  email_subject: null,
  email_template: null,
  followup_template: null,
  owner_first_name: 'Sam',
  followups_enabled: true,
  followup_count: 2,
  followup_gap_days: 3,
  drip_per_day: 25,
  quiet_start: 9,
  quiet_end: 20,
  timezone: 'Europe/London',
}

describe('substitute', () => {
  it('replaces all known variables', () => {
    const out = substitute('Hi {first_name} from {business_name} ({owner_name}): {review_link}', {
      first_name: 'Sally', business_name: 'Acme', owner_name: 'Sam', review_link: 'https://x/r/t',
    })
    expect(out).toBe('Hi Sally from Acme (Sam): https://x/r/t')
  })
})

describe('composeSmsBody (custom template path — no LLM)', () => {
  it('uses the default template and appends STOP', async () => {
    const body = await composeSmsBody({
      settings: SETTINGS, businessName: 'Acme Plumbing', firstName: 'Sally',
      reviewLink: 'https://go/r/tok', isFollowup: false,
    })
    expect(body).toContain('Sally')
    expect(body).toContain('Acme Plumbing')
    expect(body).toContain('https://go/r/tok')
    expect(body).toMatch(/STOP/i)
  })
  it('follow-ups use the follow-up template', async () => {
    const body = await composeSmsBody({
      settings: { ...SETTINGS, followup_template: 'Nudge {first_name}! {review_link}' },
      businessName: 'Acme', firstName: 'Bob', reviewLink: 'https://go/r/t2', isFollowup: true,
    })
    expect(body).toContain('Nudge Bob!')
    expect(body).toContain('https://go/r/t2')
    expect(body).toMatch(/STOP/i)
  })
  it('custom template is honoured', async () => {
    const body = await composeSmsBody({
      settings: { ...SETTINGS, sms_template: 'Custom for {first_name}: {review_link} Reply STOP to opt out.' },
      businessName: 'Acme', firstName: 'Jo', reviewLink: 'L', isFollowup: false,
    })
    expect(body).toBe('Custom for Jo: L Reply STOP to opt out.')
  })
})

describe('composeEmail', () => {
  it('always carries the CTA link, unsubscribe footer and business name', () => {
    const { subject, html } = composeEmail({
      settings: SETTINGS, businessName: 'Acme', firstName: 'Sally',
      reviewLink: 'https://go/r/tok', imageUrl: 'https://img/x.jpg',
      unsubscribeUrl: 'https://app/unsub?token=t', isFollowup: false,
    })
    expect(subject).toContain('Sally')
    expect(html).toContain('https://go/r/tok')
    expect(html).toContain('https://app/unsub?token=t')
    expect(html).toContain('https://img/x.jpg')
    expect(html).toContain('Acme')
  })
})

describe('quiet-window scheduling', () => {
  it('insideWindowAt matches the London window', () => {
    expect(insideWindowAt(SETTINGS, new Date('2026-07-20T11:00:00Z'))).toBe(true)   // 12:00 BST
    expect(insideWindowAt(SETTINGS, new Date('2026-07-20T20:30:00Z'))).toBe(false)  // 21:30 BST
  })
  it('nextWindowOpen rolls to the next morning after close', () => {
    const next = nextWindowOpen(SETTINGS, new Date('2026-07-20T20:00:00Z')) // 21:00 BST
    expect(insideWindowAt(SETTINGS, next)).toBe(true)
    expect(next.getTime()).toBeGreaterThan(new Date('2026-07-20T20:00:00Z').getTime())
  })
  it('scheduleSlots respects the daily pace', () => {
    const slots = scheduleSlots({ ...SETTINGS, drip_per_day: 10 }, 25, new Date('2026-07-20T10:00:00Z'))
    expect(slots).toHaveLength(25)
    // All slots inside the window
    for (const s of slots) expect(insideWindowAt(SETTINGS, new Date(s))).toBe(true)
    // No more than 10 per calendar day (London)
    const byDay = new Map<string, number>()
    for (const s of slots) {
      const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short' }).format(new Date(s))
      byDay.set(day, (byDay.get(day) ?? 0) + 1)
    }
    for (const n of byDay.values()) expect(n).toBeLessThanOrEqual(10)
    // Monotonic
    for (let i = 1; i < slots.length; i++) {
      expect(new Date(slots[i]).getTime()).toBeGreaterThanOrEqual(new Date(slots[i - 1]).getTime())
    }
  })
})

describe('helpers', () => {
  it('randomToken is url-safe and unique-ish', () => {
    const a = randomToken(); const b = randomToken()
    expect(a).toMatch(/^[a-z0-9]{10}$/)
    expect(a).not.toBe(b)
  })
  it('firstNameOf capitalises and rejects junk', () => {
    expect(firstNameOf('sally smith')).toBe('Sally')
    expect(firstNameOf('BOB')).toBe('Bob')
    expect(firstNameOf('J')).toBe(null)
    expect(firstNameOf(null)).toBe(null)
  })
  it('default template passes its own lint requirements', () => {
    expect(DEFAULT_SMS_TEMPLATE).toContain('{review_link}')
    expect(DEFAULT_SMS_TEMPLATE).toContain('{business_name}')
  })
})
