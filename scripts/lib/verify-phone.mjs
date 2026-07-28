// Shared mobile-number gate for every lead-import script. Hugo, 2026-07-28:
// "verify all numbers we upload, manual or via you the AI" — no CSV number
// reaches a campaign queue without passing this first.
//
// Mirrors the line-type classification in api/lib/phone-validation.ts using
// the same libphonenumber-js library, so a number that would show red
// (landline/VoIP/toll-free) in /admin/phone-validation is rejected here too.
import { parsePhoneNumber, isValidPhoneNumber, getNumberType } from 'libphonenumber-js';

/** True only for a real, dialable GB mobile number. Landline, VoIP,
 *  toll-free, and anything libphonenumber can't validate against the GB
 *  numbering plan are all rejected — none of them can reliably take an
 *  inbound SMS reply or a callback. */
export function isTextableUkMobile(raw) {
  if (!raw) return false;
  let parsed;
  try {
    parsed = parsePhoneNumber(raw, 'GB');
  } catch {
    return false;
  }
  if (!parsed || !isValidPhoneNumber(raw, 'GB')) return false;
  const type = getNumberType(raw, 'GB');
  return type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE';
}
