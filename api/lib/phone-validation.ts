import { parsePhoneNumber, isValidPhoneNumber, isPossiblePhoneNumber, getNumberType, type CountryCode, type PhoneNumberType } from 'libphonenumber-js'

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
  international_format: string | null
  national_format: string | null
  national_number: string | null
  country: string | null
  country_name: string | null
  country_calling_code: string | null
  line_type: LineType | null
  carrier: string | null
  location: string | null
  active_status: 'unknown'
  possible: boolean
  confidence: number
  confidence_label: 'empty' | 'malformed' | 'impossible' | 'format_valid' | 'prefix_valid'
  reason: string | null
  valid: boolean
  source_provider: 'libphonenumber' | 'nanpa'
  nanpa_prefix_type?: string
  checked_at: string
  cache_ttl: number
  /** Twilio Lookup live check (US mobiles only): false = number can't receive
   *  SMS (ported to landline/VoIP without a texting route), null = check failed. */
  sms_deliverable?: boolean | null
  sms_check_reason?: string
  lti_type?: string | null
  lti_carrier?: string | null
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

export function countryName(iso2: string | null): string | null {
  if (!iso2) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(iso2) ?? iso2
  } catch {
    return iso2
  }
}

export function validatePhone(raw: string, defaultCountry?: string): ValidationResult {
  const checked_at = new Date().toISOString()
  const base = {
    source_provider: 'libphonenumber' as const,
    active_status: 'unknown' as const,
    checked_at,
    carrier: null,
    location: null,
  }

  const empty = {
    ...base,
    normalized_e164: null,
    international_format: null,
    national_format: null,
    national_number: null,
    country: null,
    country_name: null,
    country_calling_code: null,
    line_type: null,
    valid: false,
    possible: false,
    confidence: 0,
    cache_ttl: 86400,
  }

  if (!raw || raw.trim() === '') {
    return {
      ...empty,
      input_number: raw,
      confidence_label: 'empty',
      reason: 'empty',
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
    return {
      ...empty,
      input_number: raw,
      confidence_label: 'malformed',
      reason: 'malformed',
    }
  }

  const iso = parsed.country ?? null
  const parsedFields = {
    normalized_e164: parsed.format('E.164'),
    international_format: parsed.formatInternational(),
    national_format: parsed.formatNational(),
    national_number: String(parsed.nationalNumber),
    country: iso,
    country_name: countryName(iso),
    country_calling_code: `+${parsed.countryCallingCode}`,
  }

  // Check if possible (loose check — number length plausible for its country)
  if (!isPossiblePhoneNumber(raw, country)) {
    return {
      ...empty,
      ...parsedFields,
      input_number: raw,
      confidence_label: 'impossible',
      reason: 'impossible',
    }
  }

  // Full validity check — validates against the country's numbering plan
  const valid = isValidPhoneNumber(raw, country)
  if (!valid) {
    return {
      ...empty,
      ...parsedFields,
      input_number: raw,
      possible: true,
      confidence_label: 'impossible',
      reason: 'impossible_prefix',
    }
  }

  const rawType: PhoneNumberType | undefined = getNumberType(raw, country)
  const line_type: LineType = (rawType as LineType) ?? 'UNKNOWN'

  return {
    ...base,
    ...parsedFields,
    input_number: raw,
    line_type,
    valid: true,
    possible: true,
    confidence: 1.0,
    confidence_label: 'prefix_valid',
    reason: null,
    cache_ttl: 86400 * 30, // line type rarely changes
  }
}
