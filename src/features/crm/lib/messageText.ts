// The pure half of rendering a message body: what should become a link, and
// where a long message should be cut.
//
// Split out of MessageBody.tsx so it can be tested for real. This repo has no
// jsdom wired into vitest (src/features/crm/** is excluded, see
// vitest.config.ts), so anything left inside the .tsx could only be checked by
// grepping its source, which proves nothing about behaviour.

/** URLs and bare email addresses, in one pass so the split stays ordered. */
export const LINKABLE =
  /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Beyond this many characters a message is folded until asked for. Chosen to
 *  clear a normal reply (the Keaze enquiry is ~470 characters before its legal
 *  footer) while still catching the footers, which run to 900+. */
export const COLLAPSE_OVER = 700;
export const PREVIEW_CHARS = 520;

/** Trailing punctuation belongs to the sentence, not to the link.
 *  "email sales@platformhg.com." must not produce a mailto ending in a stop. */
export function splitTrailing(token: string): [string, string] {
  const m = token.match(/[.,;:!?)\]]+$/);
  if (!m) return [token, ''];
  return [token.slice(0, -m[0].length), m[0]];
}

export interface TextPiece {
  text: string;
  /** Absent on plain text. */
  href?: string;
}

/** Break a body into alternating plain and linked pieces, in order. */
export function linkPieces(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(LINKABLE)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start) });
    const [token, tail] = splitTrailing(match[0]);
    if (token) {
      const href = token.includes('@') && !token.startsWith('http')
        ? `mailto:${token}`
        : token.startsWith('http')
          ? token
          : `https://${token}`;
      out.push({ text: token, href });
    }
    if (tail) out.push({ text: tail });
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function isLong(text: string): boolean {
  return text.length > COLLAPSE_OVER;
}

/** The folded preview. Cuts at a paragraph break when one is close enough,
 *  so it does not stop mid-sentence. */
export function previewCut(text: string): string {
  if (!isLong(text)) return text;
  const slice = text.slice(0, PREVIEW_CHARS);
  const para = slice.lastIndexOf('\n\n');
  return para > PREVIEW_CHARS * 0.5 ? text.slice(0, para) : slice;
}
