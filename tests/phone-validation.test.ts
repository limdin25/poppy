import { describe, it, expect } from 'vitest'
import { validatePhone, ValidationResult } from '../api/lib/phone-validation'

describe('validatePhone — format checks', () => {
  it('rejects an empty string', () => {
    const r = validatePhone('')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('empty')
  })

  it('rejects a clearly malformed string', () => {
    const r = validatePhone('not-a-number')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('malformed')
  })

  it('rejects a number with too few digits', () => {
    const r = validatePhone('123')
    expect(r.valid).toBe(false)
  })

  it('rejects a number with too many digits', () => {
    const r = validatePhone('+12345678901234567')
    expect(r.valid).toBe(false)
  })
})

describe('validatePhone — US numbers', () => {
  it('accepts a valid US mobile in E.164', () => {
    const r = validatePhone('+12125551234')
    expect(r.valid).toBe(true)
    expect(r.country).toBe('US')
    expect(r.normalized_e164).toBe('+12125551234')
  })

  it('accepts a valid US number in national format', () => {
    const r = validatePhone('(646) 919-1074', 'US')
    expect(r.valid).toBe(true)
    expect(r.country).toBe('US')
    expect(r.normalized_e164).toBe('+16469191074')
  })

  it('accepts +1 formatted US number', () => {
    const r = validatePhone('+1 347-779-2900')
    expect(r.valid).toBe(true)
    expect(r.country).toBe('US')
    expect(r.normalized_e164).toBe('+13477792900')
  })

  it('rejects an impossible US number (invalid area code 000)', () => {
    const r = validatePhone('+10005551234')
    expect(r.valid).toBe(false)
  })

  it('returns line_type for a US number (US does not separate mobile from fixed by prefix)', () => {
    const r = validatePhone('(212) 260-2006', 'US')
    expect(r.valid).toBe(true)
    expect(['MOBILE', 'FIXED_LINE', 'FIXED_LINE_OR_MOBILE', 'UNKNOWN']).toContain(r.line_type)
  })
})

describe('validatePhone — UK numbers', () => {
  it('accepts a valid UK mobile in E.164', () => {
    const r = validatePhone('+447400123456')
    expect(r.valid).toBe(true)
    expect(r.country).toBe('GB')
    expect(r.line_type).toBe('MOBILE')
  })

  it('accepts a valid UK landline', () => {
    const r = validatePhone('+442071234567')
    expect(r.valid).toBe(true)
    expect(r.country).toBe('GB')
    expect(r.line_type).toBe('FIXED_LINE')
  })

  it('accepts UK number in national format with default country GB', () => {
    const r = validatePhone('07400 123456', 'GB')
    expect(r.valid).toBe(true)
    expect(r.country).toBe('GB')
    expect(r.line_type).toBe('MOBILE')
  })

  it('rejects an impossible UK number', () => {
    const r = validatePhone('+440000000000')
    expect(r.valid).toBe(false)
  })
})

describe('validatePhone — numbering metadata fields', () => {
  it('returns full numbering metadata for a UK mobile', () => {
    const r = validatePhone('+447394137754')
    expect(r.valid).toBe(true)
    expect(r.international_format).toBe('+44 7394 137754')
    expect(r.normalized_e164).toBe('+447394137754')
    expect(r.national_number).toBe('7394137754')
    expect(r.country_calling_code).toBe('+44')
    expect(r.country_name).toBe('United Kingdom')
    expect(r.line_type).toBe('MOBILE')
    expect(r.possible).toBe(true)
  })

  it('returns full numbering metadata for a US number', () => {
    const r = validatePhone('(646) 919-1074', 'US')
    expect(r.international_format).toBe('+1 646 919 1074')
    expect(r.national_format).toBe('(646) 919-1074')
    expect(r.national_number).toBe('6469191074')
    expect(r.country_calling_code).toBe('+1')
    expect(r.country_name).toBe('United States')
  })

  it('sets possible=false for empty and malformed inputs', () => {
    expect(validatePhone('').possible).toBe(false)
    expect(validatePhone('not-a-number').possible).toBe(false)
  })

  it('carrier and location default to null before enrichment', () => {
    const r = validatePhone('+447394137754')
    expect(r.carrier).toBeNull()
    expect(r.location).toBeNull()
  })
})

describe('validatePhone — result shape', () => {
  it('returns confidence 1.0 for a confirmed valid number', () => {
    const r = validatePhone('+16469191074')
    expect(r.confidence).toBe(1.0)
  })

  it('returns confidence 0 for an invalid number', () => {
    const r = validatePhone('abc123')
    expect(r.confidence).toBe(0)
  })

  it('includes source_provider as libphonenumber', () => {
    const r = validatePhone('+16469191074')
    expect(r.source_provider).toBe('libphonenumber')
  })

  it('includes checked_at as an ISO timestamp', () => {
    const r = validatePhone('+16469191074')
    expect(r.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('includes cache_ttl as a positive number', () => {
    const r = validatePhone('+16469191074')
    expect(r.cache_ttl).toBeGreaterThan(0)
  })
})
