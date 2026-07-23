import { describe, it, expect } from 'vitest'
import {
  countryClass,
  normalizeE164,
  pickAgentNumber,
  pickCountryMatch,
  formatFromLine,
} from '../src/features/crm/hooks/useResolvedFromLine'

// useResolvedFromLine — pins the pure resolution helpers. These encode the
// same precedence as the server send fns (wk-sms-send / wk-email-send) so the
// "From: …" caption in the CRM send box matches the number the message really
// goes from (Hugo 2026-07-23 — the caption used to show the workspace US
// toll-free line while the server sent from the agent's own UK number).
// src/features/crm/** is excluded as a test *location*, not as an import.

describe('countryClass', () => {
  it('classes +44 as gb, +1 as na, anything else as other', () => {
    expect(countryClass('+447462192202')).toBe('gb')
    expect(countryClass('+18774194389')).toBe('na')
    expect(countryClass('+61290000000')).toBe('other')
  })
})

describe('normalizeE164', () => {
  it('passes E.164 through untouched', () => {
    expect(normalizeE164('+447462192202')).toBe('+447462192202')
  })
  it('strips spaces/dashes/brackets', () => {
    expect(normalizeE164('+44 7462-192 202')).toBe('+447462192202')
  })
  it('defaults a UK national number (07…) to +44', () => {
    expect(normalizeE164('07462192202')).toBe('+447462192202')
  })
  it('converts 00-prefix to +', () => {
    expect(normalizeE164('00447462192202')).toBe('+447462192202')
  })
  it('bare digits get a + prefix', () => {
    expect(normalizeE164('18774194389')).toBe('+18774194389')
  })
  it('empty input stays empty', () => {
    expect(normalizeE164('')).toBe('')
    expect(normalizeE164('  ')).toBe('')
  })
})

describe('pickAgentNumber (wk-sms-send step 2.5: country → primary → first)', () => {
  const rows = [
    { e164: '+18774194389', label: 'US toll-free', is_primary: false },
    { e164: '+447462192202', label: 'UK — Marr (CRM)', is_primary: true },
  ]

  it('picks the country-matched number for a UK contact', () => {
    expect(pickAgentNumber(rows, '+447809537895')?.e164).toBe('+447462192202')
  })

  it('picks the country-matched number for a US contact', () => {
    expect(pickAgentNumber(rows, '+15551234567')?.e164).toBe('+18774194389')
  })

  it('falls back to primary when no country matches', () => {
    expect(pickAgentNumber(rows, '+61290000000')?.e164).toBe('+447462192202')
  })

  it('falls back to the first row when neither country nor primary matches', () => {
    const noPrimary = rows.map((r) => ({ ...r, is_primary: false }))
    expect(pickAgentNumber(noPrimary, '+61290000000')?.e164).toBe('+18774194389')
  })

  it('normalises a UK national contact number before matching', () => {
    expect(pickAgentNumber(rows, normalizeE164('07809537895'))?.e164).toBe('+447462192202')
  })

  it('returns null for an empty assignment list', () => {
    expect(pickAgentNumber([], '+447809537895')).toBeNull()
  })
})

describe('pickCountryMatch (workspace default: country → first)', () => {
  const rows = [
    { e164: '+18774194389', label: 'US toll-free' },
    { e164: '+447576558278', label: 'UK line 1' },
  ]

  it('prefers the UK row for a UK contact even when the US row is first', () => {
    expect(pickCountryMatch(rows, '+447809537895')?.e164).toBe('+447576558278')
  })

  it('prefers the US row for a US contact', () => {
    expect(pickCountryMatch(rows, '+15551234567')?.e164).toBe('+18774194389')
  })

  it('falls back to the first row for an unknown country', () => {
    expect(pickCountryMatch(rows, '+61290000000')?.e164).toBe('+18774194389')
  })

  it('returns null for no rows', () => {
    expect(pickCountryMatch([], '+447809537895')).toBeNull()
  })
})

describe('formatFromLine', () => {
  it('shows number + label when a label exists', () => {
    expect(formatFromLine({ e164: '+447462192202', label: 'UK — Marr (CRM)' }, true, 'Marr'))
      .toBe('+447462192202 · UK — Marr (CRM)')
  })

  it("names the agent's line when their assigned number has no label", () => {
    expect(formatFromLine({ e164: '+447462192202', label: null }, true, 'Marr'))
      .toBe("+447462192202 · Marr's line")
  })

  it('shows just the number for unlabelled workspace defaults', () => {
    expect(formatFromLine({ e164: '+18774194389', label: null }, false, 'Marr'))
      .toBe('+18774194389')
  })
})
