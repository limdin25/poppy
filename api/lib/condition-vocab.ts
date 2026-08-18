// The rate card's vocabulary, in a file with NO imports.
//
// These two lists are the only words the pricing engine understands for
// condition and for works. They were declared in api/lib/ballpark.ts, which
// imports the LLM wrapper, which builds a Supabase client at module load. So
// the dialer could not name a band without dragging the whole server side into
// the browser bundle, and the one field the engine prices off had no input on
// the call card at all (`condition_band`, 18 Aug: "0 of 12 answered").
//
// Pure, so the call card, the transcript reader and the engine payload all
// spell them the same way. A typo in one of these is not a wrong note, it is a
// house the engine refuses to price.

/** What state the house is in. `unknown` is a real answer: it means the call
 *  never established it, and an unpriced unknown is safer than a guess. */
export const BANDS: readonly string[] = [
  'turnkey', 'cosmetic', 'modernisation', 'full_refurb', 'derelict', 'unknown',
] as const;

/** Every job the rate card can put a price against. Anything outside this list
 *  cannot be costed, so it must never be invented into a survey. */
export const WORKS: readonly string[] = [
  'kitchen', 'bathroom', 'rewire', 'replaster', 'boiler', 'flooring', 'garden',
  'full_strip_out', 'roof', 'windows', 'damp', 'structural',
] as const;

/** What each band means, for a human choosing one on the call card. */
export const BAND_MEANING: Record<string, string> = {
  turnkey: 'walk-in ready',
  cosmetic: 'decoration and carpets',
  modernisation: 'dated kitchen or bathroom, needs bringing up to date',
  full_refurb: 'everything needs doing',
  derelict: 'a shell, uninhabitable',
  unknown: 'the call did not establish it',
};
