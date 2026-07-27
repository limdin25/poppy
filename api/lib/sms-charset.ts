// "No long dashes, ever" — made machine-checkable.
//
// Hugo 2026-07-27: "no long dashes ever, we don't use. Make it a rule on the
// software and also on our documents so never we do long dashes again."
//
// There is a second, harder reason than taste. A text message is encoded GSM-7
// (160 characters per segment, 153 when it is split across several) only if
// EVERY character is in the GSM 03.38 table. One character outside it, an em
// dash or a curly apostrophe or a smart quote, flips the whole message to UCS-2
// and the segment size collapses to 70 characters (67 when split). So a single
// long dash silently turns a two-part text into a three-part text, on every
// send, forever.
//
// That makes the taste rule and the cost rule the same rule, and this file is
// where it is enforced.

/** GSM 03.38 basic table. Anything outside this (plus the extension set below)
 *  forces the whole message to UCS-2. */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** Costs two characters each (escape + char), but stays inside GSM-7. */
const GSM7_EXTENDED = '^{}\\[~]|€';

const GSM7 = new Set([...GSM7_BASIC, ...GSM7_EXTENDED]);

/** The characters that would push a message out of GSM-7, de-duplicated and in
 *  first-seen order. Empty means the text is safe (and cheap). */
export function nonGsm7(text: string): string[] {
  const bad: string[] = [];
  for (const ch of text) {
    if (!GSM7.has(ch) && !bad.includes(ch)) bad.push(ch);
  }
  return bad;
}

/** The usual suspects, in order, with what to write instead.
 *
 *  The dashes are regexes rather than plain swaps because they are nearly
 *  always SPACED, and a naive swap leaves "Hi Jon ,  here". The comma has to
 *  eat the whitespace on both sides. */
export const GSM7_REPLACEMENTS: Array<[RegExp, string]> = [
  // The long dash Hugo banned. It is a sentence break, so it becomes
  // punctuation, NOT a hyphen: "Hi Jon - here's your video" reads like a bullet
  // point, where "Hi Jon, here's your video" reads like a person.
  [/\s*—\s*/g, ', '],
  // An en dash between digits is a range (9-5, 10-15). Anywhere else it is
  // doing the long dash's job.
  [/(\d)\s*–\s*(\d)/g, '$1-$2'],
  [/\s*–\s*/g, ', '],
  [/[‘’]/g, "'"],  // curly single quotes and the curly apostrophe
  [/[“”]/g, '"'],  // curly double quotes
  [/…/g, '...'],        // ellipsis
  [/ /g, ' '],          // non-breaking space
  [/[‑−]/g, '-'],  // non-breaking hyphen, minus sign
];

/** Rewrite typographic punctuation into its GSM-7 equivalent. Does not attempt
 *  to fix genuinely non-Latin text: that is a translation problem, not a
 *  punctuation one, and silently mangling it would be worse than the extra
 *  segments. */
export function toGsm7(text: string): string {
  let out = text;
  for (const [from, to] of GSM7_REPLACEMENTS) out = out.replace(from, to);
  // A dash at the very end leaves a dangling separator.
  return out.replace(/[,\s]+$/, '');
}

/** How many texts this actually costs to send. */
export function smsSegments(text: string): number {
  if (!text) return 0;
  const unicode = nonGsm7(text).length > 0;
  // Extended-table characters take two septets each.
  const len = unicode
    ? [...text].length
    : [...text].reduce((n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return len <= single ? 1 : Math.ceil(len / multi);
}
