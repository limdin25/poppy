import { describe, it, expect } from 'vitest'
import { smsTextability } from '../api/lib/twilio-lookup.js'

// Ground truth from the 2026-07-17 deliverability audit (200-number campaign):
// the 3 error-30006 failures vs the 7 VoIP numbers that DID deliver.
describe('smsTextability', () => {
  it('passes normal mobiles', () => {
    const r = smsTextability('mobile', 'T-Mobile USA, Inc.')
    expect(r.sms_deliverable).toBe(true)
    expect(r.sms_check_reason).toBe('mobile')
  })

  it('blocks VoIP with a bare CLEC carrier (the three real 30006 failures)', () => {
    // +12132244444 / +17184400401 → Bandwidth.com, +12814613900 → Level 3
    for (const carrier of ['Bandwidth.com, Inc.', 'Level 3 Communications, LLC']) {
      for (const type of ['nonFixedVoip', 'fixedVoip']) {
        const r = smsTextability(type, carrier)
        expect(r.sms_deliverable).toBe(false)
        expect(r.sms_check_reason).toBe('voip_no_sms_route')
      }
    }
  })

  it('allows VoIP with an SMS messaging partner (the seven delivered VoIP numbers)', () => {
    for (const carrier of [
      'Twilio - SMS/MMS-SVR',
      'Onvoy/3 - Sinch',
      'Bandwidth/13 - Infobip',
      'Bandwidth/RingCentral Messaging - Sinch',
    ]) {
      const r = smsTextability('nonFixedVoip', carrier)
      expect(r.sms_deliverable).toBe(true)
      expect(r.sms_check_reason).toBe('voip_sms_enabled')
    }
  })

  it('blocks landlines and other non-mobile types', () => {
    expect(smsTextability('landline', 'AT&T').sms_deliverable).toBe(false)
    expect(smsTextability('landline', 'AT&T').sms_check_reason).toBe('landline')
    expect(smsTextability('unknown', null).sms_deliverable).toBe(false)
    expect(smsTextability('unknown', null).sms_check_reason).toBe('non_mobile')
  })

  it('fails open (null) when the lookup gave no answer', () => {
    const r = smsTextability(null, null)
    expect(r.sms_deliverable).toBe(null)
    expect(r.sms_check_reason).toBe('lookup_failed')
  })
})
