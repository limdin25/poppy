// The card that appears before the model has finished thinking.
//
// WHY THIS EXISTS. On 2026-08-10, Pedro's first day on property, the live coach
// wrote exactly the right sentence at the most valuable moment of his week and
// he never got to read it. Alan Cooper Estates, call a449ebb7:
//
//   16:28:36.269  AGENT  "...they would be looking around the 140 Mark,
//                         because the property is very new to the market."
//   16:28:41.333  COACH  "Fair enough, no worries. If 140's not in play, what
//                         would they actually take to get it done?"  <- streaming
//   16:28:44.450  PEDRO  "Thank you for your time. Have a great day."
//
// The card's body landed somewhere between 16:28:43.2 and 16:28:44.9. He spoke
// at 44.450. Across his whole day, one card in seven (55 of 376) reached him
// less than two seconds before he next spoke. He was not ignoring the coach.
// The coach was still typing.
//
// The model path costs 4.5 to 7 seconds: Twilio will not release a word until
// its endpointer says the sentence is over, then fifteen database round trips,
// then a reasoning model's time to first token. But the BROWSER already has the
// estate agent's words the instant the edge function inserts them, and at that
// moment Pedro had 8 seconds of runway. So the answer to the moment that
// matters most does not go through a model at all: it is matched here, in the
// browser, and rendered in about 200ms.
//
// THE RULE THAT MAKES THIS SAFE. Every `say` line below is text a human already
// approved, lifted from the property call script and its objection panels. A
// card that fires when it should not costs Pedro a glance. It can never put
// words in his mouth that we have not already sanctioned, which is exactly why
// this is allowed to be fast and slightly trigger-happy where the model is not.
//
// This file is PURE and imports nothing, so it can be unit tested against real
// transcript lines (tests/instant-coach.test.ts) rather than only by placing a
// phone call to an estate agent.

export interface InstantCard {
  /** Stable id, so the same moment does not re-fire as a sentence grows. */
  key: string;
  /** The chip label. Short: it is read in peripheral vision mid-call. */
  title: string;
  /** Word for word what he should say. Approved copy only. */
  say: string;
  /** One line under it. Usually the tactic, not an explanation. */
  why: string;
}

/**
 * A price the estate agent has said out loud.
 *
 * The transcriber mangles money badly on 8kHz telephony, so this reads the
 * shapes that actually appear in our own recordings rather than tidy ones:
 * "£150,000", "125,000", "70 grand", "60k", "sixty two thousand", and the bare
 * "140" in "around the 140 Mark".
 *
 * The bare-number case is the one that matters and the one that can misfire, so
 * it demands a money word nearby. Without that guard "it's a 2 bed" and "we've
 * got 10 viewings tomorrow" both read as offers.
 */
const MONEY_EXPLICIT =
  /£\s?\d|\b\d{2,3},\d{3}\b|\b\d{2,3}(?:\.\d+)?\s?(?:k\b|grand\b|thousand\b)|\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\s-]\w+)?\s+(?:thousand|grand)\b/i;
/** A bare 40 to 999, which is the range a UK house under our cap sells in. */
const MONEY_BARE = /\b([1-9]\d{1,2})\b/;
/** Words that make a bare number a price rather than a bedroom count.
 *
 *  "on for" and "up at" earn their place: "that's the two bed on for 140" is
 *  the single commonest way a branch states an asking price, and without them
 *  the sentence reads as furniture. */
const MONEY_CONTEXT =
  /\b(offer|offers|offered|asking|ask|price|priced|mark|marks|looking|look|take|takes|accept|accepts|accepted|worth|value|figure|region|budget|pay|paying|sell|sells|sold|guide|guiding|want|wants|wanted|expecting|expect)\b|\bon (?:the market )?for\b|\bup (?:at|for)\b|\bwent for\b|\blisted (?:at|for)\b|\baround the\b/i;

export function saidAPrice(utterance: string): boolean {
  const u = (utterance ?? '').trim();
  if (!u) return false;
  if (MONEY_EXPLICIT.test(u)) return true;
  const bare = MONEY_BARE.exec(u);
  if (!bare) return false;
  const n = Number(bare[1]);
  // 40 to 999. Below 40 is bedrooms, minutes, door numbers and dates; a
  // three-digit number above 999 cannot match this pattern anyway.
  if (n < 40) return false;
  return MONEY_CONTEXT.test(u);
}

/**
 * A refusal aimed at OUR number, with no counter-figure attached.
 *
 * This is the wall Pedro had no second gear for. Every one of these phrasings
 * is lifted from a real 2026-08-10 transcript.
 */
const REJECTS_OUR_FIGURE =
  /\btoo low\b|\bway off\b|\bmiles off\b|\bmillion miles\b|\bno chance\b|\bnot going to happen\b|\bwouldn'?t be accepted\b|\bwould'?nt be accepted\b|\bnot be accepted\b|\bwon'?t accept\b|\bwouldn'?t accept\b|\bdon'?t think they would\b|\bdon'?t think they'?d\b|\bwouldn'?t consider\b|\bnot consider\b|\binsulting\b|\bnowhere near\b/i;

/** They have told us where the vendor actually is. The best outcome available. */
const NAMES_THEIR_POSITION =
  /\blooking (?:for|around|at)\b|\bwould be looking\b|\bthey'?d want\b|\bthey want\b|\bhoping for\b|\bhold(?:ing)? out for\b|\bafter (?:about|around)\b|\bin the region of\b|\bclose to\b/i;

const HIGHER_OFFERS =
  /\bhigher offer|\bbetter offer|\bmore than that\b|\boffers over\b|\bhad an offer\b|\bhad offers\b|\babove (?:the )?asking\b|\bover (?:the )?asking\b|\bat (?:the )?asking\b/i;

const IS_THAT_YOUR_BEST =
  /\byour best\b|\bbest (?:you can do|offer)\b|\bfinal offer\b|\bgo any higher\b|\bpush (?:it|that) up\b|\bany more\b/i;

/** The viewing wall. Four branches used it on day one and it won every time. */
const MUST_VIEW_FIRST =
  /\bview (?:it|the property|this) first\b|\bhave to view\b|\bneed to view\b|\bbefore (?:we |you |any )?(?:can )?(?:put|takin|take|taking|submit|receiv|consider)\w*[^.?!]{0,24}offer|\boffers? (?:can only|only) be[^.?!]{0,20}view|\bgot to (?:go and )?see it\b|\bcome and see\b|\bviewing before\b|\barrange a viewing[^.?!]{0,30}offer/i;

/** They will not tell us the vendor's number. Not a no, a redirect. */
const CANNOT_DISCLOSE =
  /\bcan'?t (?:quite )?disclose\b|\bnot at liberty\b|\bcan'?t tell you what\b|\bnot able to say what\b|\bconfidential\b|\bcan'?t say what they'?d\b/i;

/**
 * What to say, right now, on the strength of what they just said.
 *
 * Order is deliberate: the most specific and most valuable moment wins. A
 * sentence that both names their position AND rejects our figure ("they'd be
 * looking around 140, I don't think they'd consider yours") is the counter-offer
 * moment, not the rejection moment, and the counter-offer card is the one that
 * keeps the call alive.
 *
 * Returns null for everything else. Silence is correct far more often than a
 * card is, and a coach that fires on every sentence gets ignored on the one
 * that counted.
 */
export function instantCoachCard(utterance: string): InstantCard | null {
  const u = (utterance ?? '').trim();
  if (!u) return null;

  const price = saidAPrice(u);

  // 1. They named a figure of their own. This IS the deal, and on day one it
  //    happened once and Pedro thanked them and hung up on it.
  if (price && (NAMES_THEIR_POSITION.test(u) || REJECTS_OUR_FIGURE.test(u))) {
    return {
      key: 'money_they_named_a_figure',
      title: 'They gave you a number',
      say: "Right, that's not miles off. Let me put that exact figure to Hugo and I'll come back to you. What's a realistic time for me to ring you back?",
      why: 'Write the number in the Houses tab word for word, then press Figure obtained. Never thank them and hang up.',
    };
  }

  // 2. Rejected, no number given. Ask for theirs. Do not move your own.
  if (REJECTS_OUR_FIGURE.test(u)) {
    return {
      key: 'money_rejected_no_figure',
      title: 'Ask THEM for a figure',
      say: "Fair enough, no problem. What would the vendor actually take, do you think?",
      why: 'Do not defend your number and do not climb. Ask, then say nothing.',
    };
  }

  // 3. A price with no verdict attached, e.g. the asking price read back. Worth
  //    a nudge to the money, not a full card.
  if (price && MONEY_CONTEXT.test(u)) {
    return {
      key: 'money_a_number_is_live',
      title: 'A number is on the table',
      say: "So what sort of figure do you think would actually get it done?",
      why: 'Any figure out of their mouth beats any figure out of yours.',
    };
  }

  if (HIGHER_OFFERS.test(u)) {
    return {
      key: 'money_higher_offers',
      title: 'They claim higher offers',
      say: "Okay, no worries. Are those still on the table, or did they come and go? Because it's still on the market, so I'm guessing something didn't stick.",
      why: 'Lightly, never as a gotcha. Cash with no chain beats a bigger number that cannot complete.',
    };
  }

  if (IS_THAT_YOUR_BEST.test(u)) {
    return {
      key: 'money_is_that_your_best',
      title: 'Never answer with your ceiling',
      say: "It's where we'd start. If there's a number that gets it done quickly, tell me what it is and I'll put it to Hugo today.",
      why: 'Answer the question with a question. Your walk-away figure is never said out loud.',
    };
  }

  if (MUST_VIEW_FIRST.test(u)) {
    return {
      key: 'viewing_wall',
      title: 'Subject to our builder',
      say: "Course, and someone will. We buy across the country, so we put the figure forward subject to our builder going round. He views it and prices the work at the same time. Any chance you could send me a video walkthrough in the meantime?",
      why: 'Not a refusal to view. You are asking for an indication first, which is reasonable. Never book the viewing yourself.',
    };
  }

  if (CANNOT_DISCLOSE.test(u)) {
    return {
      key: 'money_cannot_disclose',
      title: 'Take the pressure off',
      say: "No, and I wouldn't ask you to. I don't want to compromise you with your client. But if I were a smidgen above where I am, would I be in with a shout? You don't have to tell me where.",
      why: 'Giving them permission not to answer is what usually gets the answer.',
    };
  }

  return null;
}
