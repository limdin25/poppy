/**
 * Cleaning up the WhatsApp number a creator types at signup.
 *
 * Two of the first three real signups typed a number we could not reach:
 * one was a single digit out, the other kept the local leading zero after the
 * country code (+880 01306661213). Both were corrected by hand after the fact.
 * The form's only rule was "at least 10 digits", which accepts both happily,
 * and every onboarding nudge afterwards would have gone to a stranger or into
 * the void.
 *
 * This is deliberately NOT a liveness check. Proving somebody still pays for a
 * line needs a paid network lookup, and a well-formed number can be stone dead.
 * All this does is fix the shapes people actually get wrong, and say so when it
 * changed something, so the UI can show the result back and ask "is this right?"
 * instead of silently storing a guess.
 */

/** Country codes we send to, longest first so +880 wins over +88. */
const DIAL_CODES = [
  "880", "971", "966", "974", "973", "968", "977", "353",
  "91", "92", "94", "63", "62", "65", "60", "66", "84", "90",
  "234", "254", "255", "256", "20", "27",
  "44", "61", "64", "1",
];

export interface NormalisedNumber {
  /** E.164, e.g. +8801306661213. Empty when ok is false. */
  e164: string;
  ok: boolean;
  /** True when we had to change what they typed. Show it back to them. */
  corrected: boolean;
  reason?: "empty" | "too_short" | "too_long" | "unknown_country";
}

export function normaliseWhatsapp(raw: string): NormalisedNumber {
  const typed = (raw ?? "").trim();
  if (!typed) return { e164: "", ok: false, corrected: false, reason: "empty" };

  const digits = typed.replace(/\D/g, "");
  if (!digits) return { e164: "", ok: false, corrected: false, reason: "empty" };

  const code = DIAL_CODES.find((c) => digits.startsWith(c));
  if (!code) {
    // Not a country we recognise. Do not guess: a wrong guess is a message to a
    // stranger. Accept the digits as typed and let the caller decide.
    const e164 = `+${digits}`;
    const ok = digits.length >= 8 && digits.length <= 15;
    return {
      e164: ok ? e164 : "",
      ok,
      corrected: ok && `+${digits}` !== typed,
      reason: ok ? undefined : digits.length < 8 ? "too_short" : "too_long",
    };
  }

  let subscriber = digits.slice(code.length);
  let corrected = false;

  // THE TRUNK ZERO. Every country that writes local numbers as 01306661213
  // produces this the moment somebody prefixes the country code without
  // dropping the zero. It is the single most common mistake in the data.
  while (subscriber.startsWith("0")) {
    subscriber = subscriber.slice(1);
    corrected = true;
  }

  const full = code + subscriber;
  if (full.length < 8) return { e164: "", ok: false, corrected, reason: "too_short" };
  if (full.length > 15) return { e164: "", ok: false, corrected, reason: "too_long" };

  const e164 = `+${full}`;
  return { e164, ok: true, corrected: corrected || e164 !== typed };
}
