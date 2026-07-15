// Lightweight UK-default E.164 normalizer.
//
// We don't pull in libphonenumber-js — it's ~150KB and overkill for an
// internal admin tool that only ever calls UK numbers right now. This
// handles the common shapes:
//
//   "07380 308316"        -> "+447380308316"
//   "+44 7380 308316"     -> "+447380308316"
//   "(0044) 7380-308316"  -> "+447380308316"
//   "447380308316"        -> "+447380308316"
//   "+1 415 555 0123"     -> "+14155550123"   (other countries pass through)
//
// Returns null if the result doesn't look like at least 7 digits after
// the country code — caller decides what to do (skip / show error / etc).

export function toE164(input: string, defaultCountry: 'GB' = 'GB'): string | null {
  if (!input) return null;
  // Strip everything except digits and a leading +
  let s = input.trim();
  const hadPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;

  if (hadPlus) {
    // Already explicit international form
    return s.length >= 8 ? `+${s}` : null;
  }

  // 00XX prefix means international without +
  if (s.startsWith('00')) {
    const rest = s.slice(2);
    return rest.length >= 8 ? `+${rest}` : null;
  }

  // UK shapes (defaultCountry='GB')
  if (defaultCountry === 'GB') {
    // 07XXXXXXXXX (UK mobile) — drop leading 0, prepend +44
    if (s.startsWith('0')) {
      const rest = s.slice(1);
      return rest.length >= 9 ? `+44${rest}` : null;
    }
    // 447XXXXXXXXX without leading + — already country-code prefixed
    if (s.startsWith('44') && s.length >= 11) {
      return `+${s}`;
    }
    // Bare 7XXXXXXXXX (UK mobile without leading 0)
    if (s.startsWith('7') && s.length === 10) {
      return `+44${s}`;
    }
  }

  // Last-resort: if it's 10+ digits, treat as international without +
  if (s.length >= 10) {
    return `+${s}`;
  }

  return null;
}

/**
 * Loose validity check — caller should still trust toE164 for canonicalization.
 * Useful for showing a red border in a form input.
 */
export function looksLikePhone(input: string): boolean {
  return toE164(input) !== null;
}
