// The Instagram bio sentence a creator is given at step 4 of the brochure.
//
// WHY EACH CREATOR GETS THEIR OWN
// Not because Meta bans identical bios. It does not: no rule in the Community
// Standards, the Terms, the Help Centre or the Recommendations Guidelines says
// anything about duplicate profile text, and "identical bios get you flagged"
// is folklore. The real, documented risk sits on the DESTINATION: the
// Recommendations Guidelines avoid recommending "content from web sites that
// get a disproportionate number of clicks from Instagram versus other places
// on the web", which is exactly the ratio fifty accounts pointing one link
// would manufacture. Varied wording does not fix that ratio either. The honest
// reason to do this is simpler and better: a creator's page should not read
// like a form letter, and Hugo asked for wording that is theirs.
//
// HOW IT IS BUILT
// 32 hand-written lines first, because while the numbers are small every
// creator matters most and a written line beats an assembled one. After that a
// slot machine: 10 openers x 10 middles x 8 closers, every fragment a complete
// sentence ending in a full stop, so no combination can produce a broken
// clause. 832 sentences before anything repeats.
//
// THE RULES EVERY LINE OBEYS, and bio-variants.test.ts fails the build if one
// does not:
//   * <= 100 characters, because an Instagram bio caps at 150 and the creator
//     still needs room for a line of their own.
//   * No long dash, no curly quote, no ellipsis character. Straight ASCII
//     punctuation only.
//   * No money promise. This text goes on a public profile and stays there.
//   * No claim we cannot stand behind, including the word "free": the
//     community is paid.

/** Straight punctuation only, plus the currency signs. The test refuses all of these. */
const BANNED_CHARS = ["—", "–", "‘", "’", "“", "”", "…", "$", "£", "€"];

/**
 * Words that would turn a profile bio into a promise.
 *
 * Matched on WORD BOUNDARIES, not substrings, and that is not a detail. "earn"
 * is inside "learn", and half the corpus says "Learn it with the link below."
 * A substring check would ban the corpus for containing the word it is built
 * from.
 */
const BANNED_WORDS = [
  "free",
  "guarantee",
  "guaranteed",
  "earn",
  "earns",
  "earning",
  "earnings",
  "income",
  "profit",
  "profits",
  "salary",
  "rich",
  "passive",
  "money",
  "paid",
  "cash",
];

export const MAX_BIO_SENTENCE = 100;

/**
 * Written by hand, handed out first. Index 0 to 31.
 */
export const HAND_WRITTEN: readonly string[] = [
  "Every video on this page is made with AI. Learn how below.",
  "AI made all of this. The link below shows you the tools.",
  "I do not film any of this. The link below explains it.",
  "No camera, no crew, just AI. Start with the link below.",
  "People ask how I make these. The answer is in the link below.",
  "This whole page is AI. The link below is where I learned it.",
  "Want to make videos like these? Start with the link below.",
  "AI does the filming here. The link below shows you how.",
  "Curious how this is made? The link below explains it.",
  "I build these with AI tools. They are all in the link below.",
  "Made with AI from start to finish. Details in the link below.",
  "The link below is how I got started with AI video.",
  "Everything here is AI generated. Learn the method below.",
  "Ask me how, or just open the link below.",
  "The same tools I use are in the link below.",
  "New AI video every week. How I do it is in the link below.",
  "This page is what AI video can do now. Link below.",
  "I taught myself AI video. The link below is where.",
  "Zero filming, all AI. The link below has the steps.",
  "The link below shows the whole process.",
  "AI video on every post. Start with the link below.",
  "The tools behind this page are in the link below.",
  "I get asked for the tools daily. They are in the link below.",
  "This is AI, not a camera. See how below.",
  "My whole workflow is in the link below.",
  "Follow for AI video. Learn it with the link below.",
  "No studio and no budget, just AI. Link below.",
  "One person and a laptop. The rest is AI. Link below.",
  "If it looks filmed, it is not. Link below.",
  "AI writes it and AI shoots it. The link below shows how.",
  "Here for AI video. The link below is the starting point.",
  "I post AI video here. The how is in the link below.",
];

export const OPENERS: readonly string[] = [
  "AI makes every video here.",
  "Nothing here was filmed.",
  "This page runs on AI.",
  "Every clip is AI.",
  "No camera was used.",
  "AI video, posted weekly.",
  "All AI, start to finish.",
  "I make AI video.",
  "Real page, AI video.",
  "AI does the filming here.",
];

export const MIDDLES: readonly string[] = [
  "People ask how.",
  "The tools are simple.",
  "I get asked daily.",
  "It is easier than it looks.",
  "I learned it online.",
  "No editing skills needed.",
  "Same tools, every post.",
  "I taught myself.",
  "It is all one method.",
  "The setup is small.",
];

export const CLOSERS: readonly string[] = [
  "Link below.",
  "Start with the link below.",
  "The link below shows how.",
  "Learn it with the link below.",
  "It is all in the link below.",
  "Tap the link below.",
  "The link below has the steps.",
  "See the link below.",
];

/** 32 written + 800 assembled. Past this, wording starts repeating. */
export const BIO_VARIANT_CAPACITY =
  HAND_WRITTEN.length + OPENERS.length * MIDDLES.length * CLOSERS.length;

/**
 * The sentence belonging to one allocated index.
 *
 * Deterministic and total: any integer returns a sentence, so a page render can
 * never fail on a bad index. Past capacity it wraps, which is a duplicate and
 * not a crash. The test asserts capacity is not silently exceeded in practice;
 * widening the corpus is adding fragments, and adding a fragment reshuffles
 * nothing below it because the slot maths is positional per axis.
 */
export function bioSentence(index: number): string {
  const safe = Math.abs(Math.trunc(index)) % BIO_VARIANT_CAPACITY;
  if (safe < HAND_WRITTEN.length) return HAND_WRITTEN[safe];

  const n = safe - HAND_WRITTEN.length;
  const opener = OPENERS[n % OPENERS.length];
  const middle = MIDDLES[Math.floor(n / OPENERS.length) % MIDDLES.length];
  const closer =
    CLOSERS[Math.floor(n / (OPENERS.length * MIDDLES.length)) % CLOSERS.length];
  return `${opener} ${middle} ${closer}`;
}

/** Every sentence the corpus can produce, in allocation order. For tests and admin review. */
export function allBioSentences(): string[] {
  return Array.from({ length: BIO_VARIANT_CAPACITY }, (_, i) => bioSentence(i));
}

/** Exported so the test and any future admin linter check the same list. */
export const BIO_LINT = { BANNED_CHARS, BANNED_WORDS } as const;

/** Why a sentence is not allowed, or null if it is fine. */
export function lintBioSentence(text: string): string | null {
  if (text.length > MAX_BIO_SENTENCE) return `longer than ${MAX_BIO_SENTENCE} characters`;
  for (const ch of BANNED_CHARS) {
    if (text.includes(ch)) return `contains a banned character (${ch})`;
  }
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const word of BANNED_WORDS) {
    if (words.includes(word)) return `contains a banned word (${word})`;
  }
  if (!text.endsWith(".") && !text.endsWith("?")) return "does not end in a full stop";
  return null;
}
