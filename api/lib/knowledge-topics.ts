// Turning "what he did wrong on that call" into "ask him about this".
//
// Hugo 2026-08-12: wire the AI call review into which checkpoint question comes
// up next, so he practises his own mistakes instead of a random topic.
//
// The review writes free English ("he ended the call after they said 140
// without banking it"). This file turns that into one of a small number of
// TOPICS, and each topic names the questions in the bank that teach it.
//
// Deliberately a keyword match and not a model. The review has already used a
// model to decide what went wrong; asking a second one to classify its own
// output adds a second thing that can be confidently wrong, for no gain. A
// keyword miss costs a random question, which is what he would have had anyway.
//
// SERVER ONLY, like the question bank it points at.

export interface Topic {
  key: string;
  /** What it looks like in the review's own words. */
  match: RegExp;
  /** Bank ids that teach it. Checked against the bank at test time, so a
   *  renamed question fails the build rather than silently teaching nothing. */
  questionIds: string[];
  /** Shown on the checkpoint: why he is being asked this one. */
  because: string;
}

export const TOPICS: Topic[] = [
  {
    key: 'bank-the-figure',
    match: /bank(ed|ing)?\b|ended the call|hung up|thanked them|without (a|the) (figure|number)|did not put it to|no callback after/i,
    questionIds: ['day1_alan_cooper', 'obj_outcome_button', 'day1_log_the_outcome'],
    because: 'They gave you a number on that call and it nearly got away.',
  },
  {
    key: 'the-email',
    match: /email/i,
    questionIds: ['script_email_address', 'obj_email_general_inbox'],
    because: 'You came off that call without their email address.',
  },
  {
    key: 'one-number',
    match: /range|between .* and |two numbers|said a range/i,
    questionIds: ['script_one_number', 'day1_price_range'],
    because: 'A range crept into that call.',
  },
  {
    key: 'never-offer',
    match: /formal offer|made an offer|promised|committed|authorised/i,
    questionIds: ['script_who_sends_the_offer', 'owo_exact_wording', 'obj_formal_offer'],
    because: 'You went further than an offer without offering on that call.',
  },
  {
    key: 'the-viewing',
    match: /viewing|view it|book(ed|ing)? a view|going round to see/i,
    questionIds: ['obj_who_views_it', 'harvey_viewing_objection', 'obj_book_viewing'],
    because: 'The viewing question came up on that call.',
  },
  {
    // Added 2026-08-12 with the questions that teach it: how we explain buying
    // remotely, and why the offer is subject to our builder and not a survey.
    key: 'how-we-buy',
    match: /remote|nationwide|national buyer|subject to (a )?survey|survey|how we work|explain(ed)? (the|our) (model|process)/i,
    questionIds: ['script_subject_to_builder', 'obj_who_views_it'],
    because: 'The way we buy did not come across clearly on that call.',
  },
  {
    key: 'the-chase',
    match: /chase|already (in|with the vendor)|asked (for )?(the|a) ballpark again|re-?asked/i,
    questionIds: ['script_what_a_chase_call_is_for'],
    because: 'That was a chase call, and it did not sound like one.',
  },
  {
    key: 'walk-away',
    match: /walk.?away|ceiling|max(imum)? (figure|number)|top of (our|the) range/i,
    questionIds: ['script_never_say_ceiling', 'obj_is_that_your_best'],
    because: 'The ceiling is private and it was close to being said.',
  },
  {
    key: 'callback',
    match: /callback|call back|ring back|next step|no time agreed/i,
    questionIds: ['harvey_callback_time', 'script_end_with_time'],
    because: 'That call ended without a time to ring back.',
  },
  {
    key: 'too-many-questions',
    match: /too many questions|checklist|before the money|sixteen|lease|service charge/i,
    questionIds: ['day1_money_timing', 'ea_viewing_spree', 'script_flat_vs_house'],
    because: 'The money came too late in that call.',
  },
  {
    key: 'their-figure',
    match: /their figure|what would they take|did not ask them|push(ed)? back/i,
    questionIds: ['script_get_their_figure', 'day1_flat_no', 'owo_they_say_no'],
    because: 'You did not get THEIR number out of them.',
  },
];

/** Which topics a review's mistakes touch. Never more than three, because a
 *  checkpoint asks one question and a queue of nine is a queue nobody clears. */
export function topicsForMistakes(text: string, limit = 3): Topic[] {
  const found: Topic[] = [];
  for (const t of TOPICS) {
    if (t.match.test(text)) found.push(t);
    if (found.length >= limit) break;
  }
  return found;
}
