// Reading a Facebook lead-ad form out of the first WhatsApp message.
//
// A lead ad hands the person a "Send message" button, and Meta composes their
// first WhatsApp message for them out of the form they filled in. It arrives
// looking like this (real body, wk_sms_messages, 2026-08-07):
//
//   Hello! I filled out your form and would like to know more about your business.
//
//   Phone number: +919305415993
//   First name: lakshmi
//   Email: as3816519@gmail.com
//
// Nothing read it, so every one of those leads sat in the CRM inbox as its own
// phone number, and Hugo could not tell one from another.
//
// Two things about the shape, both learned from real rows:
//   - The field ORDER varies. Never parse by line number.
//   - The greeting sentence is translated into the lead's own Facebook locale
//     (we have Bengali ones). The field LABELS stay English. So anchor on the
//     labels and never on the greeting.
//
// This module is pure and has an exact twin inside
// supabase/functions/wk-sms-incoming/index.ts, because a Deno edge function
// cannot import from src/. tests/heypubli-lead-form.test.ts fails if the two
// drift apart, the same arrangement uk-places.ts uses for the scraper.

export interface LeadForm {
  firstName: string | null;
  email: string | null;
}

/** Longer than this is a pasted paragraph, not somebody's name. */
const MAX_NAME = 60;

const FIRST_NAME_RE = /^[^\S\n]*First\s*name[^\S\n]*:[^\S\n]*(.*)$/im;
const EMAIL_RE = /^[^\S\n]*Email[^\S\n]*:[^\S\n]*(.*)$/im;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * People type these into the name box. Two real rows from the first backfill:
 * contact +919495068152 was renamed "Hi" and then texted "Hi Hi, Maria from
 * HeyPubli here". The phone number was a better name than that.
 *
 * Whole-value match only, on letters alone, so "Yes-Ann" and "Ok Sang" are
 * safe. Kept short on purpose: a rule that guesses at names is worse than the
 * problem, and anything that slips through is still capped and de-piped below.
 */
const GREETING_WORDS = new Set([
  'hello', 'helo', 'hlo', 'hallo', 'halo', 'namaste', 'salam', 'assalamualaikum',
  'ok', 'okay', 'okk', 'k', 'yes', 'ya', 'yeah', 'yep', 'no', 'nope', 'na', 'nil', 'none',
  'sir', 'madam', 'mam', 'maam', 'bro', 'boss',
  'thanks', 'thankyou', 'ty', 'please', 'plz',
  'test', 'testing', 'asdf', 'abc', 'xyz', 'nan', 'null', 'undefined',
  'gm', 'ge', 'goodmorning', 'goodevening', 'goodafternoon', 'goodnight',
]);

/** hi, hii, hiii, hey, heyy, hy. Repeated-letter greetings, which a word list
 *  can never finish. */
const GREETING_RE = /^h+[iey]+$/;

/**
 * Is this actually somebody's name, or is it the box being used for something
 * else? The gate every write goes through, so nothing downstream has to guess.
 */
function usableName(raw: string): string | null {
  // Everything from the first pipe on is thrown away. Contact +917989848576
  // arrived as "RISHVANTH RAM KOUSHIK| REEL CREATOR| BGMS |", which is an
  // Instagram bio with a name in front of it, and the whole string was written
  // into the CRM. The name survives, the bio does not.
  const cut = raw.split('|')[0].trim().replace(/\s+/g, ' ');
  if (!cut || cut.length > MAX_NAME) return null;
  // Letters, in any script. Punctuation and emoji are not a name.
  if (!/\p{L}/u.test(cut)) return null;
  const bare = cut.toLowerCase().replace(/[^a-z]/g, '');
  if (bare && (GREETING_WORDS.has(bare) || GREETING_RE.test(bare))) return null;
  return cut;
}

/**
 * Pull the first name and email out of a lead-ad message. Returns nulls for an
 * ordinary message, so a normal "I am interested" can never overwrite a
 * contact with something invented.
 */
export function parseLeadForm(body: string | null | undefined): LeadForm {
  const text = String(body ?? '');
  const rawName = (text.match(FIRST_NAME_RE)?.[1] ?? '').trim();
  const rawEmail = (text.match(EMAIL_RE)?.[1] ?? '').trim().toLowerCase();
  return {
    firstName: rawName ? usableName(rawName) : null,
    email: EMAIL_SHAPE.test(rawEmail) ? rawEmail : null,
  };
}

/** Does this word carry ASCII letters that are all one case? */
const isOneCase = (w: string): boolean => {
  if (!/[A-Za-z]/.test(w)) return false;
  return w === w.toLowerCase() || w === w.toUpperCase();
};

/**
 * How a name gets shown. Facebook sends "lakshmi" and "LAXMAN"; both read as
 * broken next to "Nayan Roy".
 *
 * Only a word that is entirely one case is re-cased. Anything somebody
 * deliberately cased ("McDonald") and anything that is not Latin script is
 * returned untouched, because a "tidy-up" that mangles a person's own name is
 * worse than leaving it alone.
 */
export function displayName(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s
    .split(' ')
    .map((w) => (isOneCase(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/**
 * Is the name on this contact a placeholder we may safely replace?
 *
 * wk-sms-incoming creates an unknown inbound number with `name = the E.164 it
 * just received`, so the CRM shows "+919305415993" where a name belongs. That
 * is the only thing this may overwrite. Hugo's rule stands: a name a human (or
 * any other importer) actually chose is never touched.
 */
export function isPlaceholderName(
  name: string | null | undefined,
  phone: string | null | undefined,
): boolean {
  const n = String(name ?? '').trim();
  if (!n) return true;
  // A bare run of digits, however it is punctuated, is a phone number and not
  // a name. Old rows were created from a different variant of the same number,
  // so comparing against THIS phone alone missed them.
  const bare = n.replace(/^whatsapp:/i, '').replace(/[\s()+-]/g, '');
  if (/^\d{5,}$/.test(bare)) return true;
  const p = String(phone ?? '').replace(/^whatsapp:/i, '').replace(/[\s()+-]/g, '');
  return Boolean(p) && bare === p;
}
