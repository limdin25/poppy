// Hearing WHO you are speaking to on a phone call.
//
// Hugo, 2026-08-14, looking at a board card that said "Name not available":
// "maybe add the agent name. I think yes, we need to ask for the agent name,
// and if the AI captured the agent name then it has to add automatically."
//
// The checklist has asked "Who did you speak to?" since the script rewrite, and
// on a good day Pedro types it. On a busy day he does not, and then the card,
// the next call and every email start with "Hi," instead of "Hi Doug,". The
// name is nearly always said in the first ten seconds of the call ("you're
// through to Doug", "Zest, Lucy speaking"), so this reads it off the transcript
// and offers it.
//
// SAME TWO RULES AS api/lib/spoken-email.ts, and for the same reasons:
//
//   1. REFUSING IS FREE, GUESSING IS NOT. Addressing an estate agent by the
//      wrong name on call two is worse than not using a name at all, and the
//      mistake is invisible to us. Anything that does not read like a plain
//      self-introduction comes back null.
//   2. IT IS A SUGGESTION, NEVER A FACT. What this returns is filled into the
//      checklist field the agent can see and correct. It only reaches the card
//      once he has pressed an outcome with it still in the box.
//
// The block between the markers below is COPIED VERBATIM into
// supabase/functions/wk-voice-transcription/index.ts, because a Deno edge
// function cannot import from api/lib. tests/spoken-name.test.ts fails the
// build if the two copies drift by one character.

// --- spoken-name:start
/** The phrases somebody actually uses to say who they are, or to read it back.
 *
 *  Deliberately short. Every pattern here is an EXPLICIT introduction; there is
 *  no "a capitalised word near the start" rule, because a transcriber
 *  capitalises street names, agency names and the odd random noun, and each of
 *  those would become somebody's name. */
const NAME_PATTERNS: RegExp[] = [
  // "you're through to Doug", "you are speaking to Doug Allen"
  /\byou(?:'re|s? are|r)?\s+(?:through|speaking|talking)\s+(?:to|with)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
  // "my name is Lucy", "my name's Lucy Barnes"
  /\bmy name(?:'s| is)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i,
  // "Zest, Lucy speaking"
  /\b([a-z][a-z'-]*)\s+speaking\b/i,
  // "this is Doug", "it's Doug"
  /\b(?:this is|it'?s)\s+([a-z][a-z'-]*)\b/i,
  // Pedro reading it back: "am I speaking to Doug", "is that Doug"
  /\b(?:am i speaking (?:to|with)|is (?:that|this))\s+([a-z][a-z'-]*)\b/i,
];

/** Words that follow those phrases every day and are never the person's name.
 *
 *  "this is fine", "you're speaking to the wrong branch", "it's about the
 *  property" all match a pattern above and all have to lose. */
const NOT_A_NAME = new Set([
  // pronouns. "you're speaking to..." matches the "X speaking" pattern with X
  // = "you're", which is how the very first run of this offered Pedro the name
  // "You're".
  'i', 'you', 'we', 'he', 'she', 'they', 'im', 'ive', 'youre', 'weve',
  // grammar that follows "this is" / "speaking to" far more often than a name
  'a', 'an', 'the', 'my', 'your', 'our', 'his', 'her', 'their', 'its', 'it',
  'that', 'this', 'these', 'those', 'there', 'here', 'me', 'him', 'them', 'us',
  'who', 'what', 'which', 'someone', 'somebody', 'anyone', 'nobody', 'everyone',
  // filler and reactions
  'yes', 'yeah', 'no', 'nope', 'ok', 'okay', 'right', 'sure', 'fine', 'good',
  'great', 'lovely', 'perfect', 'sorry', 'thanks', 'well', 'so', 'just', 'only',
  'actually', 'really', 'still', 'now', 'then', 'about', 'because', 'but', 'and',
  'not', 'never', 'always', 'maybe', 'probably', 'obviously', 'basically',
  // the shape of a property call
  'calling', 'ringing', 'going', 'looking', 'selling', 'buying', 'regarding',
  'property', 'house', 'flat', 'branch', 'office', 'vendor', 'buyer', 'seller',
  'agent', 'landlord', 'owner', 'director', 'manager', 'team', 'company',
  'wrong', 'right', 'main', 'sales', 'lettings', 'reception', 'number',
  'morning', 'afternoon', 'evening', 'today', 'tomorrow', 'yesterday',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  // our own side. Pedro introduces himself on every single call, and the coach
  // would otherwise file OUR name as the branch contact on all of them.
  'pedro', 'hugo', 'unico', 'elsie', 'heyelsie',
]);

/**
 * The name somebody just gave, capitalised, or null.
 *
 * Two words at most: "Doug" and "Doug Allen" are both real answers, a third
 * word means the pattern has run off the end of the introduction and into the
 * rest of the sentence.
 */
export function extractSpokenName(text: string | null | undefined): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  for (const re of NAME_PATTERNS) {
    const m = raw.match(re);
    if (!m || !m[1]) continue;

    const words = m[1]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (words.length === 0) continue;

    // Every word has to look like a name AND not be on the list. Checking every
    // word rather than the first is what kills "speaking to the vendor".
    const clean = words.filter((w) => /^[a-z][a-z'-]{1,19}$/i.test(w));
    if (clean.length !== words.length) continue;
    if (clean.some((w) => NOT_A_NAME.has(w.toLowerCase()))) continue;
    // A CONTRACTION IS NEVER A NAME. "it's", "that's", "you're", "I'm" all pass
    // the shape test above because an apostrophe is legal in O'Brien. No real
    // name ends in one of these, so the ending is what tells them apart.
    if (clean.some((w) => /'(re|s|m|ll|ve|d|t)$/i.test(w))) continue;

    // A one-letter or two-letter "name" is a transcription artefact.
    if (clean[0].length < 3) continue;

    // "o'brien" -> "O'Brien", "anne-marie" -> "Anne-Marie": a name capitalises
    // after its own punctuation, not only at the front.
    return clean
      .map((w) => w.toLowerCase().replace(/(^|['-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()))
      .join(' ');
  }
  return null;
}
// --- spoken-name:end

/** True when the line reads like an introduction at all.
 *
 *  Used to decide whether to bother looking, so the parser never runs on the
 *  other ninety-nine lines of a call. */
export function mentionsName(text: string | null | undefined): boolean {
  return /\b(speaking|talking|through to|my name|this is|it'?s|is that|is this)\b/i.test(
    String(text ?? ''),
  );
}
