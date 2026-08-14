// Hearing an email address on a phone call.
//
// Hugo, 2026-08-14, watching Pedro work: "the coach expands a little bit for
// when he asked for the email and then it gets written there automatically for
// him during the call. The brain recognizes he's asking for the email."
//
// An estate agent almost never says "d.smith@zest.co.uk". They say
// "it's d dot smith at zest dot co dot uk", and Twilio transcribes exactly
// that. So this turns what was heard into an address, and refuses when it
// cannot.
//
// TWO RULES, both learned from what a wrong answer costs here:
//
//   1. REFUSING IS FREE, GUESSING IS NOT. A wrong address means an offer that
//      silently never arrives, and nobody finds out for days. Anything that
//      does not validate as an address comes back null, and Pedro types it.
//   2. IT IS A SUGGESTION, NEVER A FACT. What this returns is filled into a
//      field the agent can see and correct before anything is sent. It is
//      never written onto the contact behind his back.
//
// The block between the markers below is COPIED VERBATIM into
// supabase/functions/wk-voice-transcription/index.ts, because a Deno edge
// function cannot import from api/lib. tests/spoken-email.test.ts fails the
// build if the two copies drift by one character.

// --- spoken-email:start
/** Words that mean punctuation when somebody reads an address out loud. */
const SPOKEN_SYMBOLS: Record<string, string> = {
  dot: '.', point: '.', period: '.', stop: '.',
  at: '@',
  underscore: '_', under: '_',
  dash: '-', hyphen: '-', minus: '-',
};

/** Noise that turns up around a spoken address and is never part of one. */
const SPOKEN_NOISE = new Set([
  'my', 'the', 'best', 'email', 'e-mail', 'address', 'is', 'its', "it's", 'it', 'so',
  'you', 'can', 'send', 'to', 'me', 'on', 'that', 'would', 'be', 'just', 'and',
  'um', 'uh', 'er', 'yeah', 'okay', 'ok', 'right', 'sure', 'please', 'thanks',
  'lowercase', 'lower', 'case', 'uppercase', 'all', 'one', 'word', 'letter',
  'full',
]);

/** A literal address, the easy case: the transcriber already joined it up. */
const LITERAL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i;

/** What an address has to look like before we hand it to anybody. */
const VALID_RE = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.[a-z]{2,10}$/;

/**
 * The address somebody just said, or null.
 *
 * Handles the literal form and the spoken form, including a domain read as
 * separate words ("ddm residential dot co dot uk"), which is joined up because
 * that is what the domain actually is.
 */
export function extractEmail(text: string | null | undefined): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  // 1. Already an address. Strip the punctuation a sentence leaves on the end.
  const literal = raw.match(LITERAL_RE);
  if (literal) {
    const hit = literal[0].toLowerCase().replace(/[.,;:!?)"']+$/, '');
    if (VALID_RE.test(hit)) return hit;
  }

  // 2. Spoken. Only worth trying when the word "at" is in there somewhere:
  //    without it there is no address, only a domain at best.
  const words = raw
    .toLowerCase()
    .replace(/[,;:!?"()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const atIndex = words.findIndex((w) => w === 'at' || w === '@');
  if (atIndex < 1) return null;

  // A window either side. Wide enough for "doug dot allen at ddm residential
  // dot co dot uk", tight enough that half a sentence cannot wander in.
  const before = words.slice(Math.max(0, atIndex - 8), atIndex);
  const after = words.slice(atIndex + 1, atIndex + 10);

  const render = (list: string[]): string => list
    .map((w) => w.replace(/[.]+$/, (m) => m))
    .filter((w) => !SPOKEN_NOISE.has(w))
    .map((w) => (SPOKEN_SYMBOLS[w] !== undefined && w !== 'at' ? SPOKEN_SYMBOLS[w] : w))
    .join('')
    .replace(/[^a-z0-9._%+-]/g, '');

  const local = render(before);
  const domain = render(after);
  if (!local || !domain) return null;

  const candidate = `${local}@${domain}`.replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
  if (!VALID_RE.test(candidate)) return null;
  // A domain with no dot in it was never an address, and "at" is a common word.
  if (!candidate.split('@')[1].includes('.')) return null;
  return candidate;
}
// --- spoken-email:end

/** True when the line reads like somebody asking for, or giving, an address.
 *
 *  Used to decide whether to bother looking, so an ordinary "at" in the middle
 *  of a sentence never starts a parse. */
export function mentionsEmail(text: string | null | undefined): boolean {
  return /\be-?mail\b|@/i.test(String(text ?? ''));
}
