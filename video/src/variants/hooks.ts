// hooks.ts: the rotating hook copy, and the end card.
//
// PUNCTUATION IS A HARD RULE, NOT A PREFERENCE. Straight quotes and straight
// apostrophes only. No em dash, no en dash, no ellipsis character, no curly
// quotes. That rule is enforced across this repo for SMS cost reasons, and it
// applies here too because these strings get copied into captions, post text and
// ad copy, where the cost rule does bite. hooks.test.ts fails the build on it.
//
// LENGTH IS A HARD RULE TOO. Every hook must fit three lines at 64px or larger
// in a 936px column, measured against the real font metrics of every typeface
// admissible for it. A hook that cannot is rejected here, at the bank, not at
// render time where it would just overflow its box in a finished video.
//
// NO UNVERIFIED CLAIMS. These go out at volume under Hugo's name. "Made in
// minutes" is a description of the product. "AI made this in 4 minutes" is a
// measurable claim somebody could be asked to back up, so it is not here.

export interface Hook {
  /** Stable id. Used as the deck item, so renaming one reshuffles nothing. */
  readonly id: string;
  /** The words. Keep to about 50 characters, see the length rule above. */
  readonly text: string;
}

/**
 * THE ONLY THING THE TEXT EVER SAYS DURING A VIDEO: stay to the end.
 *
 * The structure is the reason, and it is worth stating because it constrains
 * every line here. Nothing appears over the opening at all; the clip just plays.
 * The text arrives at the moment the picture shrinks into the phone, roughly
 * halfway through, and from there it rotates until the end card. So its whole
 * job is holding the viewer through the back half to a reveal they cannot
 * predict.
 *
 * TWO RULES, BOTH ABSOLUTE.
 *
 * 1. It points at the END OF THE VIDEO, never at anything nearer. An earlier
 *    bank had "Wait for the flip" and "Watch the switch", written when the text
 *    ran BEFORE the shrink. Now that it only appears after it, those promise
 *    something the viewer watched three seconds ago, which is worse than saying
 *    nothing.
 *
 * 2. It never mentions AI, or generation, or filming, or cameras. The whole
 *    video is built on the viewer not knowing until the end card tells them. One
 *    line giving it away costs the reveal, and the reveal is the point.
 *
 * Kept vague on purpose: every one of these is true of any clip that gets
 * dropped in. "Wait for the dog" would need somebody to check there is a dog.
 */
/**
 * THREE WAYS A RETENTION LINE FAILS, all of which the first version of this bank
 * managed at once. Written out because they are easy to write again.
 *
 * 1. IT TREATS THE VIDEO AS A CHORE. "Stick with it" is what you say to somebody
 *    struggling through something difficult. Used on a clip it concedes the clip
 *    is boring before the viewer has decided that for themselves.
 *
 * 2. IT PROMISES A VISUAL PAYOFF THAT NEVER COMES. "Wait for it" is a real
 *    convention with a precise meaning: something is about to visibly happen, a
 *    fall, a prank, a transformation. Nothing does here. The clip plays on and a
 *    text card appears. Somebody who waits for it and gets a call to action feels
 *    tricked, which is worse than never having promised anything. Same fault in
 *    "The best bit is last" and "Watch the last five seconds".
 *
 * 3. IT ANSWERS A QUESTION NOBODY ASKED. "The answer is at the end" implies a
 *    question was posed. None was.
 *
 * What is left is the thing that actually works, and it works because of the
 * edit: the moment the picture drops into a phone, the viewer genuinely does
 * have a question, which is why is this in a phone now. So every line either
 * says plainly to watch to the end, or says the end explains it. Both are true,
 * neither over-promises, and both point at the one place the video pays off.
 *
 * Nothing here hints that the clip is not real. A "look closer" family was
 * drafted and dropped on Hugo's call: the video stays completely blind until the
 * end card says what it is.
 */
export const RETENTION_BANK: readonly Hook[] = [
  { id: 'watch-to-end', text: 'Watch until the end' },
  { id: 'stay-to-end', text: 'Stay to the end' },
  { id: 'keep-watching-end', text: 'Keep watching to the end' },
  { id: 'watch-through', text: 'Watch through to the end' },
  { id: 'watch-it-to-end', text: 'Watch this to the end' },
  { id: 'watch-whole-thing', text: 'Watch the whole thing' },
  { id: 'do-not-skip-end', text: 'Do not skip the end' },
  { id: 'end-explains', text: 'The end explains it' },
  { id: 'makes-sense-end', text: 'It makes sense at the end' },
  { id: 'only-makes-sense', text: 'It only makes sense at the end' },
  { id: 'last-part-explains', text: 'The last part explains it' },
  { id: 'watch-to-end-explains', text: 'Watch to the end, it explains' },
  { id: 'reason-at-end', text: 'Stay to the end for the reason' },
  { id: 'there-is-a-reason', text: 'There is a reason, watch on' },
  { id: 'clicks-at-end', text: 'It clicks at the end' },
  { id: 'end-is-point', text: 'The end is the point' },
];

export const RETENTION_IDS = RETENTION_BANK.map((h) => h.id);

/**
 * Every hook in the system, for the length and punctuation checks.
 *
 * This used to also hold 39 claim hooks: "AI made this, not a crew", "Nobody
 * filmed this", "This actor does not exist". They were retired when the reveal
 * moved to the end card, because saying any of them mid-video destroys the very
 * thing the retention copy is holding the viewer for. They are not commented out
 * or feature-flagged, they are gone, so nobody restores half of them by accident.
 */
export const ALL_HOOKS: readonly Hook[] = RETENTION_BANK;

export function hook(id: string): Hook {
  const hit = ALL_HOOKS.find((h) => h.id === id);
  if (!hit) throw new Error(`unknown hook: ${id}`);
  return hit;
}

/**
 * The end card. Fixed copy, ten seconds, on every single video.
 *
 * Hugo's decision: the message and a link-in-bio instruction, nothing else. No
 * wordmark, no handle, no URL. That keeps every video postable from any account
 * without a re-render, which matters a lot more at a thousand files than it does
 * at sixteen.
 */
export const CTA = {
  action: 'LINK IN BIO',
} as const;

/**
 * The reveal. This is the only place in the entire video that says it is AI.
 *
 * It lands on the end card, after the viewer has watched the whole thing, which
 * is the only order that works: told up front it is a novelty, told at the end
 * it is a demonstration. Every retention line in the bank above exists to get
 * somebody to this sentence.
 *
 * Short, flat, and stated as fact. No exclamation marks and no "you won't
 * believe": the line is doing the surprising on its own.
 */
export const CTA_REVEALS: readonly Hook[] = [
  { id: 'was-100-ai', text: 'That was 100% AI' },
  { id: 'all-ai', text: 'All of that was AI' },
  { id: 'every-frame-ai', text: 'Every frame was AI' },
  { id: 'none-real', text: 'None of that was real' },
  { id: 'made-by-ai', text: 'That was made by AI' },
  { id: 'not-filmed', text: 'That was never filmed' },
  { id: 'no-camera', text: 'No camera touched that' },
  { id: 'ai-start-to-end', text: 'AI from start to end' },
  { id: 'generated-not-shot', text: 'Generated, not shot' },
  { id: 'nobody-was-there', text: 'Nobody was ever there' },
];

/**
 * The offer, in three written lines. Not wrapped: see the note in CtaCard on why
 * the end card is one text block sharing a single scale.
 *
 * Keep each line to about 20 characters. The end card renders at a fixed cap
 * height in a fixed column, and a longer line shrinks the WHOLE block, so one
 * greedy line makes every other line smaller too. A test measures this against
 * the real metrics of all ten faces and fails the build rather than letting the
 * end card quietly render small.
 */
export interface Offer {
  readonly id: string;
  readonly lines: readonly string[];
}

export const CTA_OFFERS: readonly Offer[] = [
  { id: 'make-money', lines: ['Learn how to make', 'AI videos like this', 'that make you money'] },
  { id: 'make-cash', lines: ['Learn how to make', 'AI videos like this', 'that make you cash'] },
  { id: 'get-paid', lines: ['Learn how to make', 'AI videos like this', 'and get paid for it'] },
  { id: 'sell-for-you', lines: ['Learn how to make', 'AI videos like this', 'that sell for you'] },
  { id: 'pay-you-back', lines: ['Learn how to make', 'AI videos like this', 'that pay you back'] },
  { id: 'earn-from-them', lines: ['Learn to make', 'AI videos like this', 'and earn from them'] },
  { id: 'i-will-show-you', lines: ['I will show you how', 'to make AI videos', 'that make you money'] },
  { id: 'find-out-how', lines: ['Find out how to make', 'AI videos like this', 'that make you money'] },
];

export const CTA_REVEAL_IDS = CTA_REVEALS.map((h) => h.id);
export const CTA_OFFER_IDS = CTA_OFFERS.map((o) => o.id);

export function reveal(id: string): Hook {
  const hit = CTA_REVEALS.find((h) => h.id === id);
  if (!hit) throw new Error(`unknown reveal: ${id}`);
  return hit;
}

export function offer(id: string): Offer {
  const hit = CTA_OFFERS.find((o) => o.id === id);
  if (!hit) throw new Error(`unknown offer: ${id}`);
  return hit;
}

/** The three end card layouts the seed rotates between. */
export const CTA_LAYOUTS = ['stacked', 'centred', 'lowRule'] as const;
export type CtaLayout = (typeof CTA_LAYOUTS)[number];
