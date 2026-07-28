// Did this lead just say yes to seeing the website?
//
// KEYWORD FIRST, DELIBERATELY. The question we are classifying is about as
// narrow as language gets: someone was asked "I built you a website, wanna see
// it?" and replied. The replies are overwhelmingly one to four words. A model
// call would add latency and cost to every inbound message in the CRM for a
// decision a word list makes correctly, and it would need the same guard rails
// anyway. If the live smoke test shows this missing real positives, escalating
// to an LLM is a small change behind the same function signature.
//
// THE ASYMMETRY THAT MATTERS
// A missed positive costs one manual click by an agent. A false positive texts
// a real business a link they never asked for. So anything ambiguous returns
// 'unclear' and the normal AI reply handles it. Silence is cheaper than a
// wrong send.

export type ReplyIntent = 'positive' | 'negative' | 'unclear';

/** Lowercase, strip punctuation except the question mark, collapse spaces. */
function normalise(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}?\s👍👌]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Checked FIRST. "no thanks" must never reach the positive list, which
// contains "thanks".
const NEGATIVE = [
  /^n$/, /^no+$/, /^nope$/, /^nah$/, /^na$/,
  /\bno thanks?\b/, /\bno ta\b/, /\bnot interested\b/, /\bnot really\b/,
  /\bnot right now\b/, /\bnot at the moment\b/, /\bno need\b/, /\bnot for me\b/,
  /\balready (have|got)\b/, /\bwe have one\b/, /\bi have one\b/,
  /\bstop\b/, /\bunsubscribe\b/, /\bremove me\b/, /\bleave me alone\b/,
  /\bdont (text|contact|message)\b/, /\bfuck\b/, /\bpiss off\b/, /\bscam\b/, /\bspam\b/,
];

// Money is the agent's conversation, not the machine's. A lead asking the price
// gets a human answer, not an automated link.
const MONEY = [
  /\bhow much\b/, /\bprice\b/, /\bpricing\b/, /\bcost(s|ing)?\b/, /\bcharge\b/,
  /\bfee\b/, /\bfree\b/, /\bcatch\b/, /\bpay(ing|ment)?\b/, /£|\$/,
];

// They want it, but somewhere else. "send it to my email" is a yes we cannot
// act on: we only have their mobile, and answering an explicit email request
// with a text reads as not listening. An agent takes the address.
const OTHER_CHANNEL = [/\bemail\b/, /\bwhatsapp\b/, /\bpost it\b/, /\bcall me\b/, /\bring me\b/];

// Suspicion is also the agent's conversation. "who is this" is not a yes.
const SUSPICION = [
  /\bwho is this\b/, /\bwho are you\b/, /\bwhats this\b/, /\bwhat is this\b/,
  /\bhow did you get\b/, /\bwhere did you get\b/, /\bis this a bot\b/,
  /\bis this real\b/, /\bare you a bot\b/,
];

const POSITIVE = [
  /^y$/, /^ye+s+$/, /^ye+a+h*$/, /^ye+h+$/, /^yep$/, /^yup$/, /^yh$/, /^ya$/,
  /^ok+$/, /^okay$/, /^k$/, /^kk$/, /^sure$/, /^alright$/, /^aight$/, /^cool$/,
  /^please$/, /^pls$/, /^plz$/, /^go on$/, /^go for it$/, /^why not$/,
  /\byes\b/, /\byeah\b/, /\byep\b/, /\byup\b/, /\bsure\b/, /\bok\b/, /\bokay\b/,
  /\bgo on\b/, /\bgo ahead\b/, /\bgo for it\b/, /\bwhy not\b/,
  /\bshow me\b/, /\bsend it\b/, /\bsend it over\b/, /\bsend over\b/, /\bsend me\b/,
  /\blets see\b/, /\bletme see\b/, /\blet me see\b/, /\bill have a look\b/,
  /\bhave a look\b/, /\bcan i see\b/, /\bwanna see\b/, /\bwant to see\b/,
  /\binterested\b/, /\bsounds good\b/, /\bsound good\b/, /\bgo ahead\b/,
  /\bfire away\b/, /\bcrack on\b/, /\bdeffo\b/, /\bdefinitely\b/, /\bof course\b/,
  /👍|👌/,
];

const any = (list: RegExp[], s: string) => list.some((re) => re.test(s));

/**
 * Classify a reply to the "I built you a website, wanna see it?" text.
 * Only 'positive' should ever trigger an automatic send.
 */
export function classifyReply(text: string): ReplyIntent {
  const s = normalise(text);
  if (!s) return 'unclear';

  // Order is load-bearing. Negatives beat everything, because "no thanks" and
  // "not interested" both contain tokens the positive list would otherwise
  // catch. Money and suspicion beat positives, because "yeah how much?" is a
  // question for a person, and answering it with an automated link is the
  // fastest way to lose the lead.
  if (any(NEGATIVE, s)) return 'negative';
  if (any(MONEY, s)) return 'unclear';
  if (any(OTHER_CHANNEL, s)) return 'unclear';
  if (any(SUSPICION, s)) return 'unclear';
  if (any(POSITIVE, s)) return 'positive';
  return 'unclear';
}

/** Convenience for the one place that only cares about the yes. */
export function isPositiveReply(text: string): boolean {
  return classifyReply(text) === 'positive';
}

/**
 * Did we actually make the offer to this lead? The classifier only runs for
 * contacts whose outbound history contains the website opener, so a lead
 * saying "yes" to something else entirely never gets a site.
 *
 * Matches the live copy in scripts/blast-maria-website-opener.mjs, loosely
 * enough to survive the agent rewording it a little.
 */
export function looksLikeSiteOffer(body: string): boolean {
  const s = String(body || '').toLowerCase();
  return (
    /built you (a|one|a website)/.test(s) ||
    /i built you/.test(s) ||
    (/website/.test(s) && /(wanna see|want to see|want a look|have a look)/.test(s))
  );
}
