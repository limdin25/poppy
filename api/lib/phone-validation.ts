import { parsePhoneNumber, isValidPhoneNumber, isPossiblePhoneNumber, getNumberType, CountryCode, PhoneNumberType } from 'libphonenumber-js'

export type LineType =
  | 'MOBILE'
  | 'FIXED_LINE'
  | 'FIXED_LINE_OR_MOBILE'
  | 'TOLL_FREE'
  | 'PREMIUM_RATE'
  | 'SHARED_COST'
  | 'VOIP'
  | 'PERSONAL_NUMBER'
  | 'PAGER'
  | 'UAN'
  | 'VOICEMAIL'
  | 'UNKNOWN'

export interface ValidationResult {
  input_number: string
  normalized_e164: string | null
  country: string | null
  line_type: LineType | null
  active_status: 'unknown'
  confidence: number
  confidence_label: 'empty' | 'malformed' | 'impossible' | 'format_valid' | 'prefix_valid'
  reason: string | null
  valid: boolean
  source_provider: 'libphonenumber' | 'nanpa'
  nanpa_prefix_type?: string
  checked_at: string
  cache_ttl: number
}

// Maps NANPA Prefix_Type to our LineType
export function nanpaPrefixTypeToLineType(prefixType: string): LineType {
  const t = prefixType.toUpperCase().trim()
  if (t === 'WIRELESS' || t === 'PCS' || t === 'W RESELLER') return 'MOBILE'
  if (t === 'IPES') return 'VOIP'
  if (t === 'ICO' || t === 'UNKNOWN') return 'UNKNOWN'
  // RBOC, CLEC, ULEC, L RESELLER, GENERAL, CAP, ILEC → landline
  return 'FIXED_LINE'
}


export function validatePhone(raw: string, defaultCountry?: string): ValidationResult {
  const checked_at = new Date().toISOString()
  const base: Pick<ValidationResult, 'source_provider' | 'active_status' | 'checked_at'> = {
    source_provider: 'libphonenumber',
    active_status: 'unknown',
    checked_at,
  }

  if (!raw || raw.trim() === '') {
    return {
      ...base,
      input_number: raw,
      normalized_e164: null,
      country: null,
      line_type: null,
      valid: false,
      confidence: 0,
      confidence_label: 'empty',
      reason: 'empty',
      cache_ttl: 86400,
    }
  }

  const country = defaultCountry as CountryCode | undefined

  let parsed
  try {
    parsed = parsePhoneNumber(raw, country)
  } catch {
    // unparseable
  }

  if (!parsed) {
    // Try with a leading + if no country given and doesn't start with +
    const looksNumeric = /^[\d\s\(\)\-\.]+$/.test(raw.trim())
    if (looksNumeric && isPossiblePhoneNumber(raw, country)) {
      return {
        ...base,
        input_number: raw,
        normalized_e164: null,
        country: null,
        line_type: null,
        valid: false,
        confidence: 0,
        confidence_label: 'malformed',
        reason: 'malformed',
        cache_ttl: 86400,
      }
    }
    return {
      ...base,
      input_number: raw,
      normalized_e164: null,
      country: null,
      line_type: null,
      valid: false,
      confidence: 0,
      confidence_label: 'malformed',
      reason: 'malformed',
      cache_ttl: 86400,
    }
  }

  // Check if possible (loose check — number length plausible for its country)
  if (!isPossiblePhoneNumber(raw, country)) {
    return {
      ...base,
      input_number: raw,
      normalized_e164: parsed.format('E.164'),
      country: parsed.country ?? null,
      line_type: null,
      valid: false,
      confidence: 0,
      confidence_label: 'impossible',
      reason: 'impossible',
      cache_ttl: 86400,
    }
  }

  // Full validity check — validates against the country's numbering plan
  const valid = isValidPhoneNumber(raw, country)
  if (!valid) {
    return {
      ...base,
      input_number: raw,
      normalized_e164: parsed.format('E.164'),
      country: parsed.country ?? null,
      line_type: null,
      valid: false,
      confidence: 0,
      confidence_label: 'impossible',
      reason: 'impossible_prefix',
      cache_ttl: 86400,
    }
  }

  const rawType: PhoneNumberType | undefined = getNumberType(raw, country)
  const line_type: LineType = (rawType as LineType) ?? 'UNKNOWN'

  return {
    ...base,
    input_number: raw,
    normalized_e164: parsed.format('E.164'),
    country: parsed.country ?? null,
    line_type,
    valid: true,
    confidence: 1.0,
    confidence_label: 'prefix_valid',
    reason: null,
    cache_ttl: 86400 * 30, // line type rarely changes
  }
}
