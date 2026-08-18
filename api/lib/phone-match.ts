// Is this the same phone number? One rule, written down once.
//
// WHY THIS EXISTS (2026-08-18). Pedro: "Everytime somebody calls me it doesnt
// show the property I am inquiring about." Part of the answer was that the
// inbound call screen compared numbers with `===`. Twilio hands us the caller
// as "+447380308316"; the scraper filed the branch as "0191 625 0242" and the
// ingest route filed the same branch as "+441916250242". None of those three
// strings equal each other, so an estate agency we had rung that morning rang
// back and arrived as an unknown caller.
//
// The property side of the product has always known better: the
// wk_property_agent_listings RPC matches on the LAST 9 DIGITS
//   right(regexp_replace(agent_phone,'[^0-9]','','g'), 9)
// and that is the rule copied here so the browser, the API routes and the
// database all decide "same branch" the same way.
//
// Why nine and not the whole number. A UK mobile is 07380 308316 locally and
// +44 7380 308316 internationally: same subscriber, different leading digits,
// and only the tail is stable across both. Nine is the longest tail that
// survives every UK format we hold (mobiles and landlines, with or without the
// leading zero, with or without +44). Ten would drop the leading-zero forms.
//
// It is a MATCHING rule, never a validation or dialling rule. Nothing here
// says a number is real or reachable: format checks live in phone-validation.ts
// and only a live network lookup (twilio-lookup.ts) knows whether anybody still
// pays for the line.

/** Digits only, no +, no spaces, no punctuation. */
export function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '')
}

/** The last 9 digits, or '' when there are not 9 to take.
 *
 *  Returning '' rather than a short tail is deliberate: two junk values must
 *  never match each other. An empty tail is the "cannot decide" answer and
 *  every caller treats it as no match. */
export function phoneTail(raw: string | null | undefined): string {
  const d = phoneDigits(raw)
  return d.length >= 9 ? d.slice(-9) : ''
}

/** Same subscriber? Empty or too-short input is never a match. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = phoneTail(a)
  return ta !== '' && ta === phoneTail(b)
}

/** The first row whose phone is the same number, or undefined.
 *
 *  Takes the accessor rather than a fixed field name because the callers hold
 *  three different shapes (the CRM store's Contact, a wk_contacts row, a
 *  listing), and none of them is worth a type import here. */
export function findByPhone<T>(
  rows: readonly T[],
  phone: string | null | undefined,
  getPhone: (row: T) => string | null | undefined,
): T | undefined {
  const tail = phoneTail(phone)
  if (!tail) return undefined
  return rows.find((r) => phoneTail(getPhone(r)) === tail)
}
