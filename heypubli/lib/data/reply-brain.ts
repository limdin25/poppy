import { ONBOARDING_STEPS } from "@/lib/data/onboarding";
import { COMMISSION_RATE } from "@/lib/earnings";
import { cleanSkoolAffiliateUrl } from "@/lib/skool-link";
import type { OnboardingStepId } from "@/types/database";

/**
 * What to say back to a creator, decided by their actual state rather than by
 * the words in their message.
 *
 * Written 07 Aug 2026, the first day real creators were in the funnel and every
 * reply was hand-typed. Hugo: "if it is stuck you help them, and of course you
 * bake into the coding on how you are helping them so we know how to help in
 * the future."
 *
 * This is the decision layer only. It returns a sentence or it refuses to; it
 * sends nothing and touches no database, so it can be tested against real
 * conversations. Every rule below is a mistake that was made on a real person.
 *
 * The nudge brain (lib/data/onboarding-nudges.ts) chases people who go quiet.
 * This answers people who write to us. They are different jobs.
 */

export interface ReplyContext {
  /**
   * Only what they said AFTER our last outbound message, oldest first.
   *
   * Not the whole thread. The reply queue used to classify everything a lead
   * had written that day, so Ankit, who had finished all five steps at 09:17
   * and said "Ok sir" at 09:18, was queued the signup link off a question we
   * had already answered.
   */
  said: string[];
  /** Bodies we have already sent them, so no link is ever sent twice. */
  alreadySent: string[];
  /**
   * The key of the last reply we sent them, so the same message is never sent
   * twice in a row. See `escalateInsteadOfRepeating`.
   */
  lastReplyKey?: string | null;
  /** Onboarding steps completed. Order does not matter. */
  stepsDone: readonly OnboardingStepId[];
  /** Whether a HeyPubli account exists for this person at all. */
  hasAccount: boolean;
  firstName?: string | null;
  /** Their per-lead code for heypubli.com/watch?u=CODE */
  watchCode?: string | null;
  /**
   * The creator's own bio sentence and saved affiliate link, so the bio
   * instructions can be copied straight out of the chat instead of sending
   * them back to a page. Null when not allocated / not saved yet.
   */
  bioSentence?: string | null;
  affiliateUrl?: string | null;
  /**
   * A skool.com link they pasted into the chat, already validated by the
   * runner, which SAVED it to their profile before calling this. 08 Aug 2026:
   * the machine said "paste it here and I will put it in for you" and nothing
   * anywhere put it in. Whatever a creator pastes must be written down.
   */
  justSavedLink?: boolean;
  /**
   * The live read of their real Instagram, when the runner made one. This is
   * what stops "all five steps are done and your link is live" being said to
   * a creator whose actual profile is empty (Abdul Latif, 08 Aug 2026).
   */
  bioEvidence?: {
    checked: boolean;
    /** Clickable, in the Links field. Typed into the bio text does NOT count. */
    link: boolean | null;
    linkInText?: boolean;
    sentence: boolean | null;
    /** A Skool link on their page with somebody else's referral code. */
    wrongCode?: boolean;
  };
  /** The runner verified the bio live in THIS pass: congratulate even on "ok". */
  justVerifiedBio?: boolean;
  /**
   * True when this lead cannot currently be paid, so we do not recruit them.
   *
   * Hugo, 07 Aug 2026, after an audit found 88 of 126 Facebook leads in four
   * days were Indian while Skool payouts to India are blocked: "stop pitching
   * them". No video, no signup link, no chasing. They still get a straight
   * answer to anything they ask, and anybody who already onboarded keeps every
   * bit of help they had.
   *
   * Deliberately NOT called `isIndian`. The reason is the payout block, not the
   * country, so when India reopens or somewhere else closes this is one flag
   * and not a rewrite. See `pitchBlockedForPhone`.
   *
   * This does not soften the standing rule that no MESSAGE may rule on whether
   * a country can be paid. This decides who we approach, not what we tell them.
   */
  pitchBlocked?: boolean;
}

/** Dialling codes whose creators cannot currently be paid by Skool. */
const PITCH_BLOCKED_PREFIXES = ["+91"];

/** Whether we should stop recruiting this number. Used by the send scripts. */
export function pitchBlockedForPhone(phone: string | null | undefined): boolean {
  const p = (phone || "").replace(/[^\d+]/g, "");
  return PITCH_BLOCKED_PREFIXES.some((c) => p.startsWith(c));
}

export type ReplyDecision =
  | { action: "send"; key: string; text: string; reason: string; images?: string[] }
  | { action: "human"; reason: string }
  | { action: "silence"; reason: string };

/**
 * A picture for each step, because words about a menu are worse than a picture
 * of the menu. Hugo, 07 Aug 2026: "we should have the screenshot for how to get
 * to the URL, for example."
 *
 * `available` is earned, not assumed: a test refuses to let it be true unless
 * the file is really in public/. A promised picture that 404s in a creator's
 * chat is worse than no picture at all.
 *
 * `shows` is the brief. It is what somebody has to capture for that file to be
 * worth sending.
 */
export const STEP_IMAGES: Record<
  OnboardingStepId,
  { file: string; shows: string; available: boolean }
> = {
  instagram: {
    file: "/guide/step1-connect-instagram.jpg",
    shows:
      "The Connect Instagram button on heypubli.com/onboarding, and the Allow screen Instagram shows after you tap it.",
    available: false,
  },
  community: {
    file: "/guide/step2-1-find-the-email.jpg",
    shows: "Made 06 Aug: the invite email in a phone inbox, arrow on where to look.",
    available: true,
  },
  affiliate: {
    file: "/guide/step3-1-invite-people.jpg",
    shows:
      "Made 06 Aug: three dots, then Invite people, arrowed and numbered. Pair it with step3-2-copy-your-link.jpg.",
    available: true,
  },
  photo: {
    file: "/guide/step4-1-edit-profile.jpg",
    shows: "Made 06 Aug: Instagram Edit profile, arrow on the picture.",
    available: true,
  },
  bio: {
    file: "/guide/step4-2-done.jpg",
    shows: "Made 06 Aug: the finished profile with the bio and link in place.",
    available: true,
  },
};

/**
 * Some steps need two pictures, not one. Step 3 is the clearest: one shot to
 * find the menu, one to show the COPY button inside it.
 *
 * These live in public/guide/ and were made by hand on 06 Aug 2026 with red
 * arrows and numbered captions. I did not know they existed and declared a
 * parallel set at /help/ that nobody had drawn, so two creators sat stuck on
 * step 3 while the picture that unsticks them was already live on the site.
 * LOOK IN public/guide/ BEFORE INVENTING A FILENAME.
 */
export const STEP_IMAGE_SETS: Partial<Record<OnboardingStepId, string[]>> = {
  community: ["/guide/step2-1-find-the-email.jpg", "/guide/step2-2-join-now.jpg"],
  affiliate: ["/guide/step3-1-invite-people.jpg", "/guide/step3-2-copy-your-link.jpg"],
  photo: ["/guide/step4-1-edit-profile.jpg", "/guide/step4-2-done.jpg"],
  // The bio instructions travel with both Edit profile shots: one to find the
  // screen, one showing the finished profile with the sentence and link in.
  bio: ["/guide/step4-1-edit-profile.jpg", "/guide/step4-2-done.jpg"],
};
// ------------------------------------------------------------------
// Reading what they wrote
// ------------------------------------------------------------------

/** Punctuation-tolerant gap. "No..thanks" reached a lead's phone as a pitch
 *  because every pattern demanded a space between the two words. */
const G = "[^a-z0-9]*";

const REFUSAL = new RegExp(
  [
    // "interested" arrives misspelled more often than not: intrested,
    // intersted, interseted. Rather than guess at the typo, match anything
    // that starts int and ends ed. It over-matches on words like
    // "interrupted", and that is the safe direction: the answer is "hand to a
    // human", never "send them a pitch".
    `\\b(not|never)${G}(really${G}|very${G})?int[a-z]{0,8}ed\\b`,
    `\\bno${G}int[a-z]{0,8}(est|ed)\\b`,
    // FIRST PERSON ONLY. "It does not want to move next step" is a broken
    // button, and on 08 Aug 2026 it opted a Kenyan lead out FOREVER: she had
    // watched the video, said she was happy to move forward, asked for help
    // three times ("Show me the procedure", "Please") and every engine
    // ignored her because a bare "not want" anywhere in the sentence counted
    // as a refusal. Only a PERSON saying they do not want it is a refusal.
    `\\b(i|we)${G}(do${G})?(n'?t|not)${G}want\\b`,
    `\\bi${G}don'?t${G}want\\b`,
    `\\bno${G}thanks?\\b`,
    "\\bstop\\b",
    "\\bunsubscribe\\b",
    `\\bremove${G}me\\b`,
    `\\bleave${G}me\\b`,
    "\\bnahi\\b",
    "\\bnever\\s*mind\\b",
    // A bare "no" is NOT here on purpose, and it used to be. This file's own
    // rule says "no", "not now" and "Not understand" are ANSWERS to questions
    // we asked; the pattern contradicted the rule and opted somebody out for
    // answering us. A real refusal says what it is refusing.
    "^\\W*close\\W*$",
    `\\bclose${G}(my|the)${G}application\\b`,
    `\\bplease${G}close\\b`,
    // "I'm looking for a fixed salary, not a commission-based payment" is a no.
    // A refusal does not have to contain the word no.
    "\\blooking\\s+for\\s+a\\s+(fixed|regular|monthly)\\b",
    "\\bnot\\s+(for|what)\\s+me\\b",
  ].join("|"),
  "i",
);

/**
 * Money splits three ways, and getting the split wrong has cost us something
 * every single time.
 *
 * PAYOUT is what they GET: the commission rate.
 *
 * This was "never answered, hand it to a human" until 07 Aug 2026, when Hugo
 * pointed out the obvious: "on the watch page, there is the earning
 * calculator." We print 40 percent on the page we send every lead, so refusing
 * to repeat it in the chat was not discretion, it was making a lead work for a
 * number they had already been shown. Rajen asked "And earning??" and got the
 * mechanism with no figure in it, which is a non-answer.
 *
 * The rate is imported from lib/earnings.ts rather than typed here, so the chat
 * and the page cannot drift apart. What is still never done is quoting a cash
 * figure: the calculator shows a RANGE with "careful estimates, not promises"
 * printed under it, and the same number in a private message loses that line
 * and starts to read like a guarantee.
 */
const PAYOUT = new RegExp(
  [
    "\\bsalary\\b",
    "\\bcommissions?\\b",
    "\\bearn(s|ing|ings)?\\b",
    "\\bincome\\b",
    "\\bprofit\\b",
    "\\bhow\\s+much\\b",
  ].join("|"),
  "i",
);

/**
 * HOW and WHERE they get paid, which is a different question from HOW MUCH and
 * has a real answer: the Skool payouts page.
 *
 * Hugo, 07 Aug 2026, correcting me twice in one day on this: "It's not your job
 * to say that Indians cannot receive whatever, because if they have a company
 * they can set up the Stripe. You don't have to say this country is allowed or
 * not allowed. You just have to say where they must go to set up their payouts."
 *
 * Before that correction, Bhupender, our first finished creator, asked twice
 * and was told Stripe payouts to India are switched off. That was never mine to
 * rule on, and he has been quiet since. A creator with a company, or their own
 * arrangement, has options I know nothing about.
 */
const PAYOUT_SETUP = new RegExp(
  [
    "\\bpayouts?\\b",
    "\\bpayments?\\s*(method|details|option)?\\b",
    "\\bget\\s+paid\\b",
    "\\bpaid\\s+(to|me|out)\\b",
    "\\bwhen\\b[^.?]*\\bpaid\\b",
    "\\breceive\\b[^.?]*\\bpay",
    "\\bwithdraw(al)?\\b",
    "\\bbank\\s+(account|details)\\b",
  ].join("|"),
  "i",
);

/**
 * COST is the opposite question: what does it cost THEM. Hugo, 07 Aug 2026:
 * "they are asking what's the charge, we need to explain them in short words.
 * Simple English. You don't charge, you make money with us."
 *
 * My first version sent anything with a money word to a human, which stalled
 * people on a question that has a one word answer. "What's the charge" is not
 * the payout conversation.
 */
const COST = new RegExp(
  [
    "\\bcharges?d?\\b",
    "\\bcosts?\\b",
    "\\bprice\\b",
    "\\bfees?\\b",
    "\\bfree\\b",
    "\\bpay\\s+(you|for|anything|any)\\b",
    "\\bdo\\s+i\\s+(have\\s+to\\s+)?pay\\b",
    "\\bany\\s+(money|payment)\\s+from\\s+me\\b",
    "\\binvest(ment)?\\b",
  ].join("|"),
  "i",
);

/**
 * They think THEY have to pay the community subscription. Saad, 08 Aug 2026:
 * "I don't have $9 to buy subscription" landed in the NEEDS YOU pile, when
 * the answer is the single most reassuring fact we have: the creator never
 * pays, they join free on our invite, and the 9 dollars is what OTHER people
 * pay when they join through the creator's link. Hugo: "he thinks he needs
 * to pay nine dollars and he doesn't have to pay and you know that."
 */
const SUBSCRIPTION_WORRY = new RegExp(
  [
    "\\bsubscriptions?\\b",
    "\\bmembership\\s*(fee|cost|price)?\\b",
    "(don'?t|do\\s+not|no)\\s+have\\s+(the\\s+)?(\\$|money|\\d)",
    "can'?t\\s+afford\\b",
    "\\bafford\\b",
    "\\b(9|nine)\\s*(dollars?|bucks?|usd)\\b",
    "\\$\\s*9\\b",
  ].join("|"),
  "i",
);

/**
 * Can they pick what the videos are about? No. Hugo, 07 Aug 2026: "the videos
 * are randomized. Your page is gonna be about AI videos, so it's not a
 * specific niche. Realistic AI videos."
 *
 * The same reason the niche promise came off the landing page. Saying yes here
 * buys a signup and loses the creator the first week.
 */
const NICHE = new RegExp(
  [
    "\\bniche\\b",
    "\\b(choose|pick|select|decide)\\b[^.?]*\\b(content|videos?|topic|subject)\\b",
    "\\b(content|videos?)\\b[^.?]*\\b(choose|pick|what\\s+kind|what\\s+type)\\b",
    "\\bwhat\\s+(kind|type|sort)\\s+of\\s+(content|videos?)\\b",
    "\\bwill\\s+(it|they|the\\s+videos?)\\s+be\\b[^.?]*\\bcontent\\b",
    // "Do you only do female ai influencers or can you do male"
    "\\b(female|male|men|women)\\b[^.?]{0,25}\\b(ai\\s+)?(influencer|model|video|avatar)s?\\b",
  ].join("|"),
  "i",
);

/**
 * "Is my account safe?" The commonest objection after cost, and the one most
 * likely to kill a signup silently if it sits unanswered in a manual pile.
 *
 * Ankur, 07 Aug 2026, 09:53: "But my instagram will be safe ~ show you are
 * connected with meta ~ or there will be strike".
 */
const SAFETY = new RegExp(
  [
    "\\b(safe|safety|secure|risky?)\\b",
    "\\b(ban|banned|block|blocked|strike|suspend(ed)?|hack(ed)?)\\b",
    "\\bpassword\\b",
    "\\bmy\\s+(account|instagram|page)\\b[^.?]*\\b(ok|okay|fine|safe)\\b",
  ].join("|"),
  "i",
);

/** They came back to say the suspension is over. The counterpart to
 *  ACCOUNT_IN_TROUBLE, and the thing that un-pauses their onboarding. */
const ACCOUNT_BACK = new RegExp(
  [
    "\\b(account|profile|insta(gram)?|ig|it)\\b[^.?!]{0,25}\\b(is\\s+)?(back|restored|active\\s+again|working\\s+again|unbanned|unsuspended|recovered|fixed)\\b",
    "\\b(got|have)\\s+(it|my\\s+account)\\s+back\\b",
    "\\bappeal\\b[^.?!]{0,25}\\b(worked|accepted|approved|successful)\\b",
  ].join("|"),
  "i",
);

/**
 * Their Instagram is ACTUALLY in trouble, right now. This is a statement of
 * fact, not the "is my account safe with you" worry, and the two were being
 * answered identically.
 *
 * Hasnain, 08 Aug 2026: his Instagram connection had gone dead, we asked why,
 * he answered "My account is suspended", and the machine replied with the
 * reassurance script, "yes, we use Instagram's official login, your account
 * is safe". Tone deaf and useless. It also kept him in the nudge queue for
 * steps he physically cannot do.
 *
 * Needs a possessive or a passive: "my account is suspended", "instagram
 * banned me", "got disabled". A bare "suspended" still reads as the worry.
 */
const ACCOUNT_IN_TROUBLE = new RegExp(
  [
    "\\b(my|the)\\s+(account|profile|page|insta(gram)?|ig)\\b[^.?!]{0,30}\\b(is|was|got|has\\s+been|been)\\b[^.?!]{0,20}\\b(suspend|ban|block|disabl|restrict|lock|hack|delet|deactivat)",
    "\\b(insta(gram)?|meta|they)\\b[^.?!]{0,20}\\b(suspend|ban|block|disabl|restrict|lock)(ed)?\\b[^.?!]{0,15}\\b(me|my|it)\\b",
    "\\b(account|profile)\\s+(suspended|banned|disabled|restricted|locked|hacked|deactivated)\\b",
    "\\bi\\s+(got|was|have\\s+been)\\s+(suspend|ban|block|disabl|restrict|lock|hack)",
  ].join("|"),
  "i",
);

/** "Ok sir", "thanks", a lone thumbs up. Nothing is being asked. */
export const ACK = /^\W*(ok(ay)?|k+|thanks?|thank\s*you|thx|ty|sure|fine|got\s*it|noted|great|nice|good|yes)?(\s*(ji|sir|ma'?am|bro|boss))?\W*$/i;

/** They are trying and it is not working. The most valuable signal we get. */
const STUCK = new RegExp(
  [
    "\\b(stuck|unable|problem|issue|error|help)\\b",
    "\\b(can'?t|cant|cannot|won'?t\\s+let|not\\s+allow)",
    "\\b(not|isn'?t|doesn'?t|does\\s+not|ain'?t|aint)\\s+work",
    // "the link ain't opening", Kenyan and Nigerian English says ain't where
    // the patterns above expected isn't. The word alone signals trouble.
    "\\bain'?t\\b",
    "\\bnot\\s+(find|showing|opening)\\b",
    "\\bno\\s+(option|email|invite|mail|link)\\b",
    "\\bwhere\\s+is\\b",
    "\\bhow\\s+do\\s+i\\b",
    "\\bnothing\\s+happen",
    // "It keeps loading for almost 6 min" and "Its hard for me to creat an
    // account do it for me": both are people trying and failing, and both
    // sat in the handover pile through the 08 Aug audit.
    "\\b(keeps?|still)\\s+load",
    "\\bhard\\s+for\\s+me\\b",
    "\\bdo\\s+it\\s+for\\s+me\\b",
    "\\bshow\\s+me\\s+(the\\s+)?(procedure|how|steps?)\\b",
    "\\bguide\\s+me\\b",
    "\\bstill\\s+(not|no|nothing)\\b",
    // "I am not getting any invite yet" is the commonest way somebody tells us
    // they are stuck on step 2, and it matched none of the patterns above, so
    // it landed in the manual pile while the answer sat in this file.
    "\\b(did\\s?n'?t|have\\s?n'?t|has\\s?n'?t|not|never)\\s+(yet\\s+)?(get|got|getting|receiv(e|ed|ing)|arriv(e|ed))",
  ].join("|"),
  "i",
);

/** They think they still need to create an account. */
const SIGNUP_CONFUSION = /\b(sign\s*up|signup|signing\s*up|register|registration|create\s+(an?\s+)?account|new\s+account)\b/i;

/**
 * Instagram's category picker, mid switch to a professional or creator
 * account. Ayji, 08 Aug 2026: "What category do i choose upon switching my ig
 * account to creator" then "Artist, product/service etc?" sat in the NEEDS
 * YOU pile for over an hour. The answer has been in this file since day one
 * (stuck_instagram says Personal blog) but only creators with linked accounts
 * ever reached it, and Ayji's lead was not linked yet. The question only
 * arises while somebody is DOING our step 1, so it deserves an answer at any
 * stage, account or no account.
 */
const IG_CATEGORY = /\bcategor(y|ies)\b|\bwhat\b[^.?!]*\bchoose\b[^.?!]*\b(creator|professional|business)\b/i;

/**
 * "Am I supposed to open a new account?" (Samuel, 08 Aug 2026). The answer
 * Hugo signed off has two halves and both matter: no, we post to the
 * Instagram they already have; AND if they would rather start with a brand
 * new Instagram, that is allowed too, it just takes longer to get traction.
 * Both regexes must hit: the new-account phrase AND a question shape, so
 * "I created a new account" (them reporting work done) stays out of it.
 */
const NEW_ACCOUNT_PHRASE =
  /\b(open|create|creating|make|making|start|starting)\b[^.?!]{0,30}\bnew\b[^.?!]{0,20}\b(insta(gram)?|ig|account|profile|page)\b|\bnew\s+(insta(gram)?|ig)\b/i;
const QUESTION_SHAPE = /\?|\b(should|supposed|need|have\s+to|do\s+i|am\s+i|can\s+i|or\s+not)\b/i;

/** They have watched the video. Often word for word, because it is the
 *  prefilled text behind the watch page's button. */
const WATCHED =
  /\b(i\s+have\s+watched|i'?ve\s+watched|i'?ve\s+seen|watched\s+the\s+video|seen\s+the\s+video|seen\s+it|happy\s+to\s+move\s+forward|ready\s+to\s+(start|join|go)|sign\s*me\s*up|let'?s\s+(start|go))\b/i;

// The message Meta COMPOSES when a lead taps the ad's WhatsApp button. Nobody
// typed it, so it is nearly constant: an intro sentence ("I filled out/in your
// form") plus labelled fields. The GREETING arrives in the lead's own locale;
// the LABELS stay English, so they are the anchor that survives translation.
// Before this bucket existed, the first message every form lead ever sent went
// to the LLM as "no confident reading".
const FORM_FILL =
  /\bfilled\s+(in|out)\s+your\s+form\b|(first\s*name\s*:[\s\S]*phone\s*number\s*:)|(phone\s*number\s*:[\s\S]*first\s*name\s*:)/i;

const YES =
  /^\W*(yes|yeah|yep|ya|yaa|ok|okay|sure|done|join|start|interested)\W*$|\b(i\s*a?m\s+)?in?ter+es?t+ed\b|\byes\b|\bhaan?\b|\bwant\s+to\s+join\b/i;

const WHAT =
  // "What next" with no apostrophe-s was missing, and Chiquita (2,200
  // followers, 08 Aug 2026) sat in the NEEDS YOU pile because of the
  // punctuation. So did "Next process?" and a bare "Then?".
  /\b(details?|how\s+(does|do|it)|what\s+is\s+(this|it)|explain|tell\s+me|more\s+info|what\s+work|what\s+kind|what\s+now|what\s*'?s?\s+next|next\s+(process|step|one)|so\s+what\s+do\s+i\s+do)\b|^\W*(then|and\s+then|next|how)\s*\?*\W*$|\bwhat\s+is\s+heypubli\b|\bknow\s+more\s+about\b|\bwhat\s+(are\s+the\s+)?requirement/i;

/**
 * They are telling us they DID a step. The most useful message a creator can
 * send and the brain used to hand every one of them to a human: Chiquita's
 * "Already joined", Ali's "I accepted and Allow to manage my Instagram".
 *
 * The right answer is never a human, it is the NEXT step, because their real
 * state is re-read from the database on every pass anyway: if they really did
 * it, the open step has already moved on; if they only think they did, the
 * same message tells them what is still outstanding.
 */
const DID_IT =
  /\b(already\s+)?(joined|done\s+it|did\s+it|i\s+did|accepted|allowed|allow\s+to\s+manage|connected|i'?ve\s+connected|signed\s+up|created\s+(my|the|an)\s+account|it'?s?\s+done|finished|completed)\b|^\W*done\W*$|\b(i'?ve\s+|i\s+have\s+)?done\s+(everything|it\s+all|all)\b|\ball\s+done\b|\bdid\s+everything\b/i;

/** A bare hello with nothing else. Answering "yes I am here" plus the next
 *  step costs nothing; a handover leaves them staring at silence. */
const GREETING_ONLY =
  /^\W*(hi+|hey+|hello+|yo|good\s+(morning|afternoon|evening|day)|as?salam[ou]?\s*a?laik[ou]?m?|salam)[\s,!.👋🙏😊]*(there|sir|ma'?am|team)?[\s,!.?👋🙏😊]*$|\bare\s+you\s+(there|available|online|around)\b|^\W*hello\s*\?+\W*$/i;

/**
 * A skool.com link pasted into the chat. We ASK for this ("paste it here and I
 * will put it in for you"), so finding one is the single most actionable
 * message a mid-onboarding creator can send. The runner validates it with
 * cleanSkoolAffiliateUrl and saves it to their profile; this only finds it.
 */
// The lookbehind keeps "notskool.com" and "skool.com.evil.test/skool.com/x"
// prefixes from matching as if they were the real host.
const SKOOL_URL = /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?skool\.com\/\S+/i;

/** The first valid Skool link anywhere in what they said, cleaned, or null. */
export function extractSkoolLink(said: string[]): string | null {
  for (const s of said) {
    const m = (s || "").match(SKOOL_URL);
    if (!m) continue;
    // Strip trailing punctuation a sentence glues on ("...about?ref=x." )
    const cleaned = cleanSkoolAffiliateUrl(m[0].replace(/[).,;!?]+$/, ""));
    if (cleaned) return cleaned;
  }
  return null;
}

// Demands for followers: "give me 500 followers", "how many followers can you
// give me for free", "can you give me free followers". The word alone is not
// enough (a lead may ASK about followers legitimately); it must pair with
// give/send/want/free/an amount.
const FOLLOWER_BEG =
  /\b(give|send|get|want|need|buy|sell|free|how\s+many)\b[^.!?\n]{0,50}\bfollowers?\b|\bfollowers?\b[^.!?\n]{0,25}\b(free|please|for\s+free)\b/i;

// ------------------------------------------------------------------
// What we say. Every string this file can produce lives here, so the rules
// about money, punctuation and length can be walked over all of them.
// ------------------------------------------------------------------

interface Vars {
  /** "Sam, " or "" */
  hi: string;
  code: string;
  /** Their own bio sentence, ready to copy. "" when not allocated. */
  sentence: string;
  /** Their saved affiliate link. "" when not saved yet. */
  link: string;
}

/**
 * The bio instructions as one block, used by several replies. When we hold
 * their sentence and their link the message IS the work: copy from the chat,
 * paste into Instagram, no page visit needed. When we do not, point at the
 * page that has them.
 */
function bioSteps(v: Vars): string {
  if (v.sentence && v.link) {
    return (
      `Open Instagram, tap Edit profile. Two boxes, one thing in each.\n\n` +
      `1. BIO box, paste this sentence. It is yours, nobody else has it:\n${v.sentence}\n\n` +
      `2. LINKS box, tap Add external link and paste this, first in the list:\n${v.link}\n\n` +
      `Do not type the link in the Bio box. Instagram only makes it tappable from the Links box.\n\n` +
      `Tell me when it is in and I will check and confirm.`
    );
  }
  return `Your sentence and your link are ready to copy at heypubli.com/onboarding. The sentence goes in your Bio box and the link goes in the Links box, both under Edit profile. Tell me when it is in and I will check your profile and confirm.`;
}

const REPLIES: Record<string, (v: Vars) => string> = {
  // --- cold, no account yet ---
  video: ({ hi, code }) =>
    `${hi}here is the 90 second video that shows exactly how it works: heypubli.com/watch?u=${code}\n\nTell me when you have seen it and I will get you set up.`,
  explain_then_video: ({ hi, code }) =>
    `${hi}we post AI videos to your Instagram for you, twice a day. You do not film anything and you do not write anything, we make it and post it.\n\nThe whole thing in 90 seconds: heypubli.com/watch?u=${code}`,
  // The code ties the SIGNUP to the exact lead, same token as the watch link
  // (Hugo, 08 Aug 2026: "track the person's exact sign up"). A thread with no
  // lead still gets the bare link; attribution never blocks an answer.
  signup: ({ hi, code }) =>
    `${hi}make your account here, it takes about a minute: heypubli.com/signup${code ? `?u=${code}` : ""}\n\nTell me when you are in and I will walk you through the rest.`,

  // --- questions anybody asks, at any stage ---
  cost_free: ({ hi }) =>
    `${hi}nothing. It is free for you, we never charge you a penny.\n\nYou connect your Instagram, we make the videos and post them for you.`,
  // The subscription confusion, answered head on. Never uses the banned
  // payout words; it may name the 9 dollars ONLY to say the creator does not
  // pay it. The person who pays is whoever joins through the creator's link.
  no_subscription_needed: ({ hi }) =>
    `${hi}you do not pay anything, ever. Not 9 dollars, not a penny. You join the community free with our invite, there is no subscription for you.\n\nThe 9 dollars is what OTHER people pay when they join through your link. That is the part that goes to you, never the part you pay.`,
  // Their Instagram really is suspended or banned. Say the useful thing:
  // how to appeal, and that we will wait. Never the reassurance script.
  account_in_trouble: ({ hi }) =>
    `${hi}ah, that explains it, thank you for telling me. While Instagram has your account suspended nothing can be posted to it, so there is no point in you doing the other steps yet.\n\nAppeal it in the Instagram app: Settings, then Help, then Support requests. Tell me the moment it is back and I will reconnect you and pick up exactly where we stopped. I am not going anywhere.`,
  // They came back to say the account is working again.
  account_back: ({ hi }) =>
    `${hi}great news, thank you for coming back to tell me.\n\nReconnect your Instagram at heypubli.com/onboarding and it carries on from the step you stopped at. Shout if anything looks wrong.`,
  account_safe: ({ hi }) =>
    `${hi}yes. We connect through Instagram's own official login, the same one Meta gives to businesses. You never give us your password and we never see it.\n\nNothing gets posted outside Instagram's rules, and you can disconnect us any time from Settings, one tap.`,
  // The rate, and then straight back to the page that owns the numbers. The
  // calculator carries its own honesty line; a figure typed into WhatsApp does
  // not, so this says the percentage and points, it never quotes a total.
  earnings_rate: ({ hi, code }) =>
    `${hi}you earn ${Math.round(COMMISSION_RATE * 100)} percent of every sale your page brings in, and Skool pays you directly.\n\nThere is a calculator on the video page that shows how it builds up month by month: heypubli.com/watch?u=${code}`,
  // "Give me 500 followers" is a demand, not a question, and it used to end as
  // a handover in Hugo's queue. Hugo, 07 Aug 2026, on Carl's thread: "you dont
  // need me, solve stupid request." One straight no, said once; asking again
  // gets recorded silence (see decideReply). The rate is imported, never typed.
  no_free_followers: ({ hi }) =>
    `${hi}straight answer: we do not give or sell followers, not 5 and not 5000. What we do is post AI videos to your Instagram twice a day, free, and you earn ${Math.round(COMMISSION_RATE * 100)} percent of every sale that comes through your link.\n\nIf that is what you want, I am here. If not, no hard feelings.`,
  payout_setup: ({ hi }) =>
    `${hi}that side is all inside Skool, not us. Set your payout details up here:\nskool.com/settings?t=payouts\n\nSkool pays you directly once somebody joins through your link. We are never in the middle of your money.`,
  // Confirmed 07 Aug 2026, after leaving Prem and Bhupender without an answer
  // for over an hour rather than guess. India genuinely is not in Skool's
  // payout country list right now. Skool's own team has said PayPal support
  // may be coming, which would likely reopen it, no date given. This is the
  // one place this fact is allowed to be stated, because it came from Hugo,
  // not from this file inventing it.
  payout_india_blocked: ({ hi }) =>
    `${hi}payouts to India are blocked on Skool's side right now, not something either of us can fix.\n\nSkool has said PayPal may be coming, which could open it back up, no date yet.\n\nStay in the community and keep set up. The moment India opens again, your link is already live and ready.`,
  niche_random: ({ hi }) =>
    `${hi}you cannot choose it, the videos are picked at random. Your page becomes an AI video page: realistic AI clips, lifestyle, that sort of thing.\n\nYou do not film anything and you do not write anything.`,
  ig_category: ({ hi }) =>
    `${hi}choose Personal blog. That is the one. If Personal blog is not in the list, pick Blogger, either works.\n\nIf any screen after that gives you trouble, send me a screenshot and I will tell you exactly what to tap.`,
  existing_or_new_ig: ({ hi }) =>
    `${hi}no. We post to the Instagram you already have, you just connect it with Instagram's own login.\n\nIf you would rather start fresh with a brand new Instagram account, that works too. Just know a new account takes longer to get traction than one that already has followers.`,
  stuck_signup: ({ hi, code }) =>
    `${hi}tell me what the page says when you try, or send me a screenshot, and I will sort it out with you.\n\nHere is the link again: heypubli.com/signup${code ? `?u=${code}` : ""}`,

  // --- has an account ---
  already_have_account: ({ hi }) =>
    `${hi}your account is already made, so there is nothing to sign up for. Go straight to heypubli.com/onboarding and it carries on where you stopped.\n\nIf that page is what is stopping you, send me a screenshot of it and I will tell you exactly what to tap.`,
  // Only reachable when the bio step is genuinely done, which since 08 Aug
  // 2026 means a live read of their real Instagram found the sentence and the
  // link. Abdul Latif was told this over a completely empty profile because
  // "done" used to include a self-declared tick.
  all_done: ({ hi }) =>
    `${hi}nothing at all, you are set up. All five steps are done, your sentence and your link are in your Instagram bio.\n\nYour videos start going out from here. I will let you know when the first one lands.`,

  // --- the pasted Skool link, saved. What happens next depends on the step
  // --- that is open now, so the runner picks one of these three.
  link_saved_bio_next: (v) =>
    `${v.hi}got it, your link is saved.\n\nLast step, two minutes. ${bioSteps(v)}`,
  link_saved_photo_next: ({ hi }) =>
    `${hi}got it, your link is saved.\n\nNext: a clear profile photo on your Instagram, under Edit profile. Add it, tick the step at heypubli.com/onboarding, and then the last step is your bio.`,
  link_saved_generic: ({ hi }) =>
    `${hi}got it, your link is saved. Carry on at heypubli.com/onboarding, it shows you the next step.`,

  // --- the live Instagram read said no. Say exactly which half is missing.
  bio_missing_both: (v) =>
    `${v.hi}I just checked your Instagram and the sentence and the link are not on your profile yet.\n\n${bioSteps(v)}`,
  bio_missing_link: (v) =>
    `${v.hi}I checked your Instagram. The sentence is in, nice. The link is not showing yet.\n\nAdd it under Edit profile, then Links, then Add external link, and make it the FIRST link in the list:\n${v.link || "your link is at heypubli.com/onboarding"}\n\nTell me when it is in and I will check again.`,
  // A Skool link is on their page and the referral code is not theirs. This is
  // the only bio message about money, because it IS about money: their own
  // traffic is paying a stranger. Say it plainly and give them theirs.
  bio_wrong_code: (v) =>
    `${v.hi}one thing on your Instagram is costing you money, so I am telling you straight away.\n\nThe Skool link in your bio works, but it is not yours. It carries somebody else's referral code, so anyone who joins through your page credits them, not you.\n\nSwap it for this one:\n${v.link || "your link is at heypubli.com/onboarding"}\n\nEdit profile, then Links, delete the old one, add this first.${
      v.sentence ? ` Your Bio box should say:\n${v.sentence}` : ""
    }\n\nTell me when it is swapped and I will check.`,
  // They DID paste their link, into the wrong box. Instagram only makes a URL
  // tappable from the Links field; in the Bio box it is grey text. Say what
  // they did right first, this is a two-tap fix and they are nearly done.
  bio_link_not_clickable: (v) =>
    `${v.hi}I can see your link on your profile, but it is typed inside your Bio text, so nobody can tap it and it tracks nothing for you. Instagram only makes it a real link from the Links box.\n\nTwo taps to fix. Edit profile, then Links, then Add external link, paste it there:\n${v.link || "your link is at heypubli.com/onboarding"}\n\nThen take it out of your Bio text.${
      v.sentence ? ` Your Bio box should just say:\n${v.sentence}` : ""
    }\n\nTell me when it is moved and I will check again.`,
  bio_missing_sentence: (v) =>
    `${v.hi}I checked your Instagram. Your link is in. The sentence is not in your Bio box yet.\n\nPaste this exactly as it is:\n${v.sentence || "it is ready to copy at heypubli.com/onboarding"}\n\nTell me when it is done and I will check again.`,

  // --- the five steps, plain ---
  step_instagram: ({ hi }) =>
    `${hi}next step is connecting your Instagram at heypubli.com/onboarding. It is one tap and you never type your password anywhere.`,
  // Say where to LOOK, not just what it is. Hugo, 07 Aug: "ask them to search
  // on the search box in the email." Edelyn lost an hour to an invite that had
  // been sent twice and was sitting in a folder she never opened.
  step_community: ({ hi }) =>
    `${hi}next step is the invite email. It comes from Skool, sender Lim Din, so it will not say HeyPubli.\n\nTap the search box in your email app and type skool. Open it, press JOIN NOW, then press I have joined at heypubli.com/onboarding.`,
  // THE EXACT ROUTE, given by Hugo 07 Aug 2026. Send them to the group page
  // itself rather than "open Skool", because "open Skool" lands a creator on
  // whatever they last looked at and the menu is not there.
  step_affiliate: ({ hi }) =>
    `${hi}next step is your own link.\n\nOpen skool.com/ai-influencer-flywheel-5612/about, tap the three dots at the top right or Settings, then Invite people, then COPY.\n\nPaste it here and I will put it in for you.`,
  step_photo: ({ hi }) =>
    `${hi}next step is a clear profile photo on your Instagram. Add it under Edit profile, then tick the step at heypubli.com/onboarding.`,
  step_bio: (v) => `${v.hi}last step. ${bioSteps(v)}`,

  // --- the five steps, when they say it is not working ---
  // The move that unsticks people is to stop explaining and take the job off
  // them. Proven on 07 Aug: a screenshot ended twenty minutes of guessing, and
  // "paste it here and I will do it" beat a third set of directions.
  // "Select a category" is a screen Instagram shows while switching to a
  // professional account. Hugo, 07 Aug 2026: "tell them to choose Personal
  // blog." Without an answer they stall on a screen we sent them to.
  stuck_instagram: ({ hi }) =>
    `${hi}if Instagram is asking you to Select a category, choose Personal blog. That is the one.\n\nOtherwise send me a screenshot of the screen you are on and I will tell you exactly what to tap.`,
  stuck_community: ({ hi }) =>
    `${hi}tap the search box in your email app and type skool, then check Spam and Promotions. It comes from Skool, sender Lim Din, so it will not say HeyPubli.\n\nStill nothing? Send me a screenshot of your inbox and I will send the invite again.`,
  stuck_affiliate: ({ hi }) =>
    `${hi}send me the link and I will put it in for you.\n\nTo find it: open skool.com/ai-influencer-flywheel-5612/about, tap the three dots at the top right or Settings, then Invite people, then COPY. Paste whatever it gives you straight into this chat.`,
  stuck_photo: ({ hi }) =>
    `${hi}send me a screenshot of your Instagram profile and I will tell you what is missing.\n\nIt is Edit profile in the Instagram app, then tap your picture to change it.`,
  stuck_bio: (v) =>
    `${v.hi}send me a screenshot of your Edit profile screen and I will tell you where it goes.\n\n${bioSteps(v)}`,

  // --- checking back on somebody who went quiet mid-step ---
  check_in_1: ({ hi }) =>
    `${hi}is everything ok? If you got stuck anywhere, just tell me what you can see on the screen and I will sort it.`,
  check_in_2: ({ hi }) =>
    `${hi}just checking again, I saw you stopped partway. Tell me where you got to and I will finish it with you, or send a screenshot and I will point at exactly what to tap. I am here to help.`,

  // --- chasing an answered lead who has NO account yet and went quiet.
  // 08 Aug 2026: the drip stops the moment a conversation starts (one engine
  // per lead), which left every answered no-account lead with NOTHING
  // scheduled, ever. Hugo: "everyone deserves a follow-up." What we chase
  // with depends on what they already have.
  chase_watch: ({ hi, code }) =>
    `${hi}did you get a moment to watch it? It is 90 seconds: heypubli.com/watch?u=${code}\n\nTell me when you have seen it and I will get you set up.`,
  chase_signup: ({ hi, code }) =>
    `${hi}your account is still one minute away: heypubli.com/signup${code ? `?u=${code}` : ""}\n\nMake it and tell me when you are in, I will walk you through the rest.`,
  chase_hello: ({ hi }) =>
    `${hi}is everything ok? If anything was unclear, ask me here, I answer everything. When you are ready I will get you set up, it takes a minute.`,
  // A bare hello. Say we are here, and give them the one thing to do next.
  greeting_lead: ({ hi, code }) =>
    `${hi}yes, I am here. We post AI videos to your Instagram for you, twice a day, and it is free.\n\nThe whole thing in 90 seconds: heypubli.com/watch?u=${code}\n\nAsk me anything, I answer everything here.`,
  greeting_creator: ({ hi }) =>
    `${hi}yes, I am here. Tell me where you got to and I will help you finish.\n\nYour setup carries on at heypubli.com/onboarding, it opens on the step you stopped at.`,
  chase_second: ({ hi }) =>
    `${hi}me again. If something was not clear, ask me anything here, that is what I am for. I can also walk you through it step by step.`,
  chase_third: ({ hi, code }) =>
    `${hi}still here when you are ready. It takes about a minute to start: heypubli.com/signup${code ? `?u=${code}` : ""}\n\nIf anything is in the way, tell me what it is and I will sort it.`,
  chase_final: ({ hi, code }) =>
    `${hi}last check from me, I will stop nudging after this one. Your spot stays open and your link keeps working: heypubli.com/signup${code ? `?u=${code}` : ""}\n\nMessage me any time and I will get you set up.`,
};

const STUCK_KEY: Record<OnboardingStepId, string> = {
  instagram: "stuck_instagram",
  community: "stuck_community",
  affiliate: "stuck_affiliate",
  photo: "stuck_photo",
  bio: "stuck_bio",
};

const STEP_KEY: Record<OnboardingStepId, string> = {
  instagram: "step_instagram",
  community: "step_community",
  affiliate: "step_affiliate",
  photo: "step_photo",
  bio: "step_bio",
};

// ------------------------------------------------------------------
// The decision
// ------------------------------------------------------------------

/** "Sam, " or "". A shouty ALL CAPS name from a form is not a name. */
function nameOf(first: string | null | undefined): string {
  const raw = (first ?? "").trim();
  const ok = /^[A-Za-z][A-Za-z'-]{1,19}$/.test(raw) && raw !== raw.toUpperCase();
  return ok ? `${raw}, ` : "";
}

function render(key: string, ctx: ReplyContext): string {
  return REPLIES[key]({
    hi: nameOf(ctx.firstName),
    code: ctx.watchCode || "",
    sentence: ctx.bioSentence || "",
    link: ctx.affiliateUrl || "",
  });
}

/**
 * Render one reply from outside the decision engine, for the sweeps that spot
 * something on a creator's profile without them writing to us first. The
 * wording lives in exactly one place, so a reply the brain sends and the same
 * reply a cron sends can never drift apart.
 */
export function renderReply(
  key: string,
  vars: {
    firstName?: string | null;
    watchCode?: string | null;
    bioSentence?: string | null;
    affiliateUrl?: string | null;
  },
): string {
  return render(key, { said: [], alreadySent: [], stepsDone: [], hasAccount: true, ...vars });
}

/**
 * The pictures that go with a step. ALWAYS, not on request.
 *
 * Hugo, 07 Aug 2026: "always show them." Words about a hidden menu are worse
 * than a picture of the hidden menu, and a creator who has to ask for the
 * picture has already been stuck for however long it took them to ask.
 *
 * Returns the full set where one exists, because step 3 needs two shots: one to
 * find the menu, one to show the button inside it.
 */
function imagesFor(step: OnboardingStepId): { images?: string[] } {
  const set = STEP_IMAGE_SETS[step];
  if (set?.length) return { images: set };
  return STEP_IMAGES[step].available ? { images: [STEP_IMAGES[step].file] } : {};
}

function sent(ctx: ReplyContext, needle: string): boolean {
  return ctx.alreadySent.some((b) => b.includes(needle));
}

/**
 * Their business auto-responder, not a person. "Thank you for contacting
 * Nigel! Please let us know how we can help you." arrives from creators whose
 * own Instagram or WhatsApp Business greets us back. Pitching a robot is
 * pointless and answering it starts a machine-to-machine loop.
 */
const THEIR_AUTORESPONDER =
  /thank you for (contacting|reaching out to)\b[^.!?]{0,40}[.!]?\s*(please let us know|we will|we'?ll|our team)/i;

/**
 * Saying the same thing twice is not persistence, it is what makes a person
 * leave.
 *
 * MADHU, 08 Aug 2026: he wrote that no invite email had arrived, and the brain
 * answered `stuck_community` at 10:53, again at 10:55 and again at 11:07,
 * word for word, because each new message matched the same rule. His next
 * message was "Stop sending repeated messages" and we lost him.
 *
 * So a reply that was ALREADY our last word does not get sent again. The step
 * instructions escalate to the stuck version, which asks for a screenshot and
 * offers to do the job for them; the stuck version and everything else escalate
 * to a human, which in the runner means the model looks at the thread (and at
 * any picture) and writes something new. Repeating is never the answer, because
 * by definition it did not work the first time.
 */
function escalateInsteadOfRepeating(d: ReplyDecision, ctx: ReplyContext): ReplyDecision {
  const lastKey = ctx.lastReplyKey ?? null;
  if (!lastKey || d.action !== "send" || d.key !== lastKey) return d;

  const step = (Object.keys(STEP_KEY) as OnboardingStepId[]).find((s) => STEP_KEY[s] === d.key);
  if (step) {
    const key = STUCK_KEY[step];
    return {
      action: "send",
      key,
      text: render(key, ctx),
      reason: `already sent ${d.key} and it did not land, asking to see their screen`,
      ...imagesFor(step),
    };
  }
  return { action: "human", reason: `already sent ${d.key} and it did not land, say something new` };
}

export function decideReply(ctx: ReplyContext): ReplyDecision {
  return escalateInsteadOfRepeating(decideReplyCore(ctx), ctx);
}

function decideReplyCore(ctx: ReplyContext): ReplyDecision {
  const said = ctx.said.map((s) => (s || "").trim()).filter(Boolean);
  if (said.length === 0) {
    return { action: "silence", reason: "nothing said since our last message" };
  }
  const text = said.join(" \n ");

  if (THEIR_AUTORESPONDER.test(text)) {
    return { action: "silence", reason: "their own auto-responder, not a person" };
  }

  // A refusal beats everything else in the same breath. Emre said "Yeah i
  // would be interested" at 21:59 and "Never mind im not interested" at 22:06,
  // and reading the thread as one blob scored him the hottest lead of the night.
  if (REFUSAL.test(text)) {
    return { action: "human", reason: "refusal, tag them and stop" };
  }
  // Where and how they get paid HAS an answer, and withholding it is what lost
  // us our first finished creator's confidence. How MUCH still does not.
  if (PAYOUT_SETUP.test(text) && !PAYOUT.test(text)) {
    return {
      action: "send",
      key: "payout_setup",
      text: render("payout_setup", ctx),
      reason: "asked where to set up payouts",
    };
  }
  if (PAYOUT.test(text)) {
    return {
      action: "send",
      key: "earnings_rate",
      text: render("earnings_rate", ctx),
      reason: "asked what they earn, the rate is public so it gets answered",
    };
  }
  // These two are asked at every stage, so they are answered before anything
  // about steps. Both are one line, and both stall somebody if left unanswered.
  if (NICHE.test(text)) {
    return {
      action: "send",
      key: "niche_random",
      text: render("niche_random", ctx),
      reason: "asked to choose the niche, the honest answer is no",
    };
  }
  // "It is back" outranks the trouble rule: the same sentence often names
  // the suspension it is reporting the end of.
  if (ACCOUNT_BACK.test(text) && !/\bnot\b|\bstill\b/i.test(text)) {
    return {
      action: "send",
      key: "account_back",
      text: render("account_back", ctx),
      reason: "their Instagram is back, restart their onboarding",
    };
  }
  // BEFORE the safety worry: "my account is suspended" is a fact about their
  // Instagram, not a question about ours, and answering it with reassurance
  // is worse than saying nothing.
  if (ACCOUNT_IN_TROUBLE.test(text)) {
    return {
      action: "send",
      key: "account_in_trouble",
      text: render("account_in_trouble", ctx),
      reason: "their Instagram is suspended or banned, pause the steps and help them appeal",
    };
  }
  if (SAFETY.test(text)) {
    return {
      action: "send",
      key: "account_safe",
      text: render("account_safe", ctx),
      reason: "worried about the account",
    };
  }
  // Asked at any stage, because the category picker appears the moment they
  // start switching their Instagram, whether or not their account is linked
  // to a lead yet. The answer is always the same and it is ours to give.
  if (IG_CATEGORY.test(text)) {
    return {
      action: "send",
      key: "ig_category",
      text: render("ig_category", ctx),
      reason: "asked which Instagram category to pick, the answer is Personal blog",
    };
  }
  if (NEW_ACCOUNT_PHRASE.test(text) && QUESTION_SHAPE.test(text)) {
    return {
      action: "send",
      key: "existing_or_new_ig",
      text: render("existing_or_new_ig", ctx),
      reason: "asked whether they need a new Instagram account, existing works and new is allowed",
    };
  }
  // BEFORE the cost rule on purpose: "how many followers can you give me for
  // free" contains "free", and Carl got the what-does-it-cost answer twice
  // before landing in Hugo's queue as a handover. A follower demand outranks
  // every other reading of the same words.
  if (FOLLOWER_BEG.test(text)) {
    if (sent(ctx, "we do not give or sell followers")) {
      return { action: "silence", reason: "asked for followers again after the straight no" };
    }
    return {
      action: "send",
      key: "no_free_followers",
      text: render("no_free_followers", ctx),
      reason: "wants free followers, one straight no",
    };
  }
  // BEFORE the generic cost rule: "I don't have $9 to buy subscription"
  // contains no cost word at all, and the generic "it is free" answer does
  // not kill the specific fear. Name the 9 dollars, say who really pays it.
  if (SUBSCRIPTION_WORRY.test(text)) {
    return {
      action: "send",
      key: "no_subscription_needed",
      text: render("no_subscription_needed", ctx),
      reason: "thinks they must pay the subscription, they never do",
    };
  }
  if (COST.test(text)) {
    return {
      action: "send",
      key: "cost_free",
      text: render("cost_free", ctx),
      reason: "asked what it costs them",
    };
  }

  const done = new Set(ctx.stepsDone);
  const openStep = ONBOARDING_STEPS.find((s) => !done.has(s)) ?? null;
  const onlyAck = said.every((s) => ACK.test(s));

  if (ctx.hasAccount) {
    // A pasted Skool link the runner just SAVED outranks everything else in
    // the same breath, including the ack check: "My link" plus the URL is not
    // chit-chat, it is the step being completed in front of us. Answer with
    // what happens next, which depends on the step that is open NOW.
    if (ctx.justSavedLink && openStep !== null) {
      if (openStep === "bio") {
        return {
          action: "send",
          key: "link_saved_bio_next",
          text: render("link_saved_bio_next", ctx),
          reason: "saved their pasted skool link, bio instructions next",
          ...imagesFor("bio"),
        };
      }
      if (openStep === "photo") {
        return {
          action: "send",
          key: "link_saved_photo_next",
          text: render("link_saved_photo_next", ctx),
          reason: "saved their pasted skool link, photo step next",
          ...imagesFor("photo"),
        };
      }
      return {
        action: "send",
        key: "link_saved_generic",
        text: render("link_saved_generic", ctx),
        reason: "saved their pasted skool link",
      };
    }

    // The runner read their real Instagram this pass and found the sentence
    // and the link. Congratulate even if all they wrote was "ok": the check
    // happening at all means they were told we would look.
    if (ctx.justVerifiedBio) {
      return {
        action: "send",
        key: "all_done",
        text: render("all_done", ctx),
        reason: "bio verified live on their Instagram this pass",
      };
    }

    // They are already being guided. An "ok" is an acknowledgement, and
    // repeating the step at somebody who just said ok is how you look like a
    // robot.
    if (onlyAck) return { action: "silence", reason: "acknowledgement, nothing outstanding" };

    if (openStep === null) {
      return {
        action: "send",
        key: "all_done",
        text: render("all_done", ctx),
        reason: "all five steps done",
      };
    }

    // Their state beats their words. Edelyn wrote "I've tried signing up, it's
    // not allowing me to" while holding a finished account with a linked
    // Instagram. Sending her to /signup was sending her round the loop again.
    if (SIGNUP_CONFUSION.test(text)) {
      return {
        action: "send",
        key: "already_have_account",
        text: render("already_have_account", ctx),
        reason: "has an account but is trying to sign up again",
      };
    }
    // On the bio step with a fresh live read in hand, the generic step text is
    // a worse answer than the truth: say exactly which half is missing. This
    // is what "check their IG to make sure" looks like in a reply. Anything
    // they write here that survived the question rules above ("done", "added
    // it", "check now", another paste of their link) is them reporting on the
    // step, so the precise state of their real profile IS the answer.
    if (openStep === "bio" && ctx.bioEvidence?.checked) {
      const ev = ctx.bioEvidence;
      // Order matters. A stranger's code on their page is money leaving, so it
      // beats everything. Then the wrong-box case: telling somebody their link
      // is not there when they are staring at it in their own bio is how you
      // lose them.
      const key = ev.wrongCode
        ? "bio_wrong_code"
        : ev.linkInText
          ? "bio_link_not_clickable"
        : ev.sentence && !ev.link
          ? "bio_missing_link"
          : ev.link && !ev.sentence
            ? "bio_missing_sentence"
            : "bio_missing_both";
      return {
        action: "send",
        key,
        text: render(key, ctx),
        reason: `bio checked live, ${key.replace(/_/g, " ")}`,
        ...imagesFor("bio"),
      };
    }
    if (STUCK.test(text)) {
      const key = STUCK_KEY[openStep];
      return {
        action: "send",
        key,
        text: render(key, ctx),
        reason: `stuck on ${openStep}`,
        ...imagesFor(openStep),
      };
    }
    // "What next", "Already joined", "I accepted and Allow to manage my
    // Instagram", "hello?" all mean the same thing from somebody with an
    // open step: tell me what to do now. Their real state was re-read from
    // the database this pass, so the step named here is the true one.
    if (
      WHAT.test(text) ||
      YES.test(text) ||
      WATCHED.test(text) ||
      DID_IT.test(text) ||
      GREETING_ONLY.test(text)
    ) {
      const key = STEP_KEY[openStep];
      return {
        action: "send",
        key,
        text: render(key, ctx),
        reason: `next step is ${openStep}`,
        ...imagesFor(openStep),
      };
    }
    return { action: "human", reason: "creator mid-onboarding said something we cannot place" };
  }

  // No account yet.
  //
  // STOP HERE if this lead cannot be paid. Everything below recruits: the
  // video, the signup link, the explainer that ends in the video. A creator who
  // already has an account is past this line on purpose, they did the work
  // before the rule existed and they keep every answer they had.
  if (ctx.pitchBlocked) {
    return {
      action: "human",
      reason: "payouts blocked for this lead, answer what they ask but do not recruit",
    };
  }

  const hasVideo = sent(ctx, "/watch?u=");
  const hasSignup = sent(ctx, "/signup");

  // They have the signup link and something about it is not working. "Help i
  // can't sign up in that link" (Ayji, 08 Aug 2026) used to fall through to
  // the handover pile. Ask for the screen, resend the coded link.
  if (hasSignup && STUCK.test(text)) {
    return {
      action: "send",
      key: "stuck_signup",
      text: render("stuck_signup", ctx),
      reason: "signup link is giving them trouble",
    };
  }

  // Watched it, or said yes to a video they already have. Either way the next
  // thing they need is the account, not the video again.
  if (WATCHED.test(text) || (hasVideo && (YES.test(text) || onlyAck))) {
    if (hasSignup) {
      return { action: "human", reason: "already has the signup link and is still writing" };
    }
    return { action: "send", key: "signup", text: render("signup", ctx), reason: "ready for the account" };
  }
  // They have the video and they are asking for more: "Next process?", "I
  // have setup everything what's next?", "Tell me". This handed the HOTTEST
  // messages in the funnel to a human and 10 of them piled up on 08 Aug
  // 2026. Somebody asking what happens next wants the account, so give it to
  // them; the link is theirs and coded, and never sent twice.
  if (hasVideo && WHAT.test(text)) {
    if (hasSignup) {
      return { action: "human", reason: "has the video and the signup link and is still asking" };
    }
    return {
      action: "send",
      key: "signup",
      text: render("signup", ctx),
      reason: "has the video and asked what is next",
    };
  }
  if (!ctx.watchCode) {
    return { action: "human", reason: "no video code for this lead" };
  }
  // A bare hello. Silence is the one answer that loses them for nothing.
  if (GREETING_ONLY.test(text)) {
    return {
      action: "send",
      key: hasVideo ? "signup" : "greeting_lead",
      text: render(hasVideo ? "signup" : "greeting_lead", ctx),
      reason: "a bare hello deserves an answer, not silence",
    };
  }
  // The form-fill opener means "I just tapped your ad". It is not a question
  // and it is not chit-chat, it is a button press, so it gets the explainer and
  // their own tracked link. Sits below the hasVideo checks on purpose: a lead
  // who somehow re-sends the form after getting the video must not get it twice.
  if (FORM_FILL.test(text)) {
    if (hasVideo) {
      // They have the link and the form arrived again, out of order or twice.
      // Never the same link twice; a person can read the thread and decide.
      return { action: "human", reason: "form opener arrived after the video was already sent" };
    }
    return {
      action: "send",
      key: "explain_then_video",
      text: render("explain_then_video", ctx),
      reason: "the Meta form-fill opener, a known message",
    };
  }
  if (YES.test(text)) {
    return { action: "send", key: "video", text: render("video", ctx), reason: "interested, send the video" };
  }
  if (WHAT.test(text)) {
    return {
      action: "send",
      key: "explain_then_video",
      text: render("explain_then_video", ctx),
      reason: "wants to know what it is",
    };
  }
  return { action: "human", reason: "no confident reading, a guess here pitches the wrong person" };
}

// ------------------------------------------------------------------
// Checking back on somebody who went quiet
// ------------------------------------------------------------------

export interface CheckInContext {
  /** Minutes since the last thing WE sent them. */
  minutesSinceWeWrote: number;
  /** Have they written anything since? If so there is nothing to check on. */
  repliedSinceWeWrote: boolean;
  /**
   * Their reply was an acknowledgement and nothing more ("Ok", "Okay", a
   * thumbs up). THE BLACK HOLE, found in the 08 Aug 2026 inbox audit: the
   * reply brain answers an ack with deliberate silence, this ladder then
   * refused to chase because "they answered", and the slow ladder holds off
   * for 3 hours from their reply. So five creators mid-onboarding (Ankit,
   * Prem, Abdul Latif, Janice, Shahbaz) said "Ok" and NOTHING in the system
   * spoke to them again. An "Ok" is not a conversation, it is a pause, and
   * the clock keeps running from it.
   */
  theirReplyWasAckOnly?: boolean;
  /** Minutes since THEIR last message, used when that message was just an ack. */
  minutesSinceTheyWrote?: number;
  /** Check-ins already spent on the step they are on now. */
  checkInsThisStep: number;
  openStep: OnboardingStepId | null;
  /** Did they write to us in the last 24 hours? Free-form only lands if so. */
  windowOpen: boolean;
  firstName?: string | null;
  /** Their own bio sentence and saved link, so a bio rung is copy-paste ready. */
  bioSentence?: string | null;
  affiliateUrl?: string | null;
}

export type CheckInDecision =
  | { action: "send"; key: string; text: string; reason: string; rung: number; images?: string[] }
  | { action: "wait"; reason: string }
  | { action: "handover"; reason: string };

/**
 * The follow-up ladder for a creator sitting on an unfinished step.
 *
 * Hugo, 08 Aug 2026, after seeing 11 creators who had never saved their Skool
 * link: "for every action we do two follow-ups in the same hour, one after
 * ten minutes and another after thirty minutes, then another around six hours
 * and another around twenty-three hours", and "this is not one off, it is for
 * new accounts as well". So it is the SAME four rungs the pre-signup chase
 * uses, and it runs PER STEP: finishing a step resets the ladder, so every
 * one of the five gets its own four chances. A creator cannot fall silent on
 * step 3 and simply be forgotten, which is exactly what was happening.
 *
 * Rung 2 and rung 4 repeat the step itself WITH the guide pictures, because
 * by then "is everything ok" has already failed and what they need is the
 * instructions again, not another greeting.
 *
 * Beyond the four, the slow template ladder in onboarding-nudges.ts owns them
 * (22h then 44h, six lifetime), which is also the only thing that can reach
 * somebody whose 24h window has shut.
 *
 * Deliberately does no clock or timezone work: this file only decides. Quiet
 * hours in the creator's own timezone are checked at the sending layer, where
 * the phone number lives.
 */
export const CHECK_IN_LADDER_MINUTES = [10, 30, 360, 1380] as const;

/**
 * How long a message we could not answer is allowed to sit before the machine
 * answers it anyway. Long enough that a human genuinely could have stepped in,
 * short enough that nobody is left wondering for an afternoon.
 */
export const UNANSWERED_GRACE_MINUTES = 60;

export function decideCheckIn(ctx: CheckInContext): CheckInDecision {
  const ackPause = Boolean(ctx.repliedSinceWeWrote && ctx.theirReplyWasAckOnly);
  // THE SECOND BLACK HOLE, found the same day. When the brain cannot place
  // what somebody said it hands the thread to a human, and no human comes.
  // This ladder then refused to touch it, because "they answered", so Chiquita
  // ("Already joined. What next"), Lawrence and Danish sat unanswered for
  // three to six hours with nothing scheduled. A message we never replied to
  // is not a conversation, it is a debt. After the grace period, in which a
  // human genuinely might answer, the machine sends them the step they are on:
  // never a guess, always true, and it consumes a rung so it cannot loop.
  const owed =
    Boolean(ctx.repliedSinceWeWrote) &&
    !ackPause &&
    (ctx.minutesSinceTheyWrote ?? 0) >= UNANSWERED_GRACE_MINUTES;
  if (ctx.repliedSinceWeWrote && !ackPause && !owed) {
    return { action: "wait", reason: "they answered, this is a conversation not a chase" };
  }
  // After a bare "Ok" the clock runs from THEIR message, not ours: they were
  // last seen agreeing to do something, and the check-in asks whether it went
  // ok. Falls back to our own clock if the caller cannot supply theirs.
  const quietFor =
    ackPause || owed
      ? (ctx.minutesSinceTheyWrote ?? ctx.minutesSinceWeWrote)
      : ctx.minutesSinceWeWrote;
  if (ctx.openStep === null) {
    return { action: "wait", reason: "nothing left for them to do" };
  }
  if (ctx.checkInsThisStep >= CHECK_IN_LADDER_MINUTES.length) {
    return { action: "handover", reason: "all four check-ins spent, the slow nudge ladder has it" };
  }
  if (!ctx.windowOpen) {
    // Outside 24h only an approved template can be sent, and that is the nudge
    // brain's job. Trying here would just bounce with window_closed.
    return { action: "handover", reason: "24h window shut, needs a template" };
  }
  const rung = ctx.checkInsThisStep;
  const due = CHECK_IN_LADDER_MINUTES[rung];
  if (quietFor < due) {
    return { action: "wait", reason: `${due - Math.round(quietFor)} minutes early` };
  }
  // Rungs 2 and 4 are the step itself, with its pictures: by then asking "is
  // everything ok" again is noise, and what unsticks somebody is being shown
  // the thing to do one more time.
  // A debt is always answered with the step itself. "Is everything ok" is a
  // terrible reply to somebody who asked a real question an hour ago.
  const stepRung = owed || rung === 1 || rung === 3;
  const key = stepRung ? STEP_KEY[ctx.openStep] : rung === 0 ? "check_in_1" : "check_in_2";
  const vars: Vars = {
    hi: nameOf(ctx.firstName),
    code: "",
    sentence: ctx.bioSentence || "",
    link: ctx.affiliateUrl || "",
  };
  return {
    action: "send",
    key,
    rung: rung + 1,
    text: REPLIES[key](vars),
    reason: `quiet ${Math.round(quietFor)} minutes on ${ctx.openStep}, rung ${rung + 1} of ${CHECK_IN_LADDER_MINUTES.length}${ackPause ? " after an ok" : ""}`,
    ...(stepRung ? imagesFor(ctx.openStep) : {}),
  };
}

// ------------------------------------------------------------------
// Chasing an answered lead with no account. The 15/90 check-ins above are
// for creators mid-onboarding; these are for the people BEFORE the account:
// we answered, they went quiet, and the drip is stopped because the
// conversation exists.
//
// Hugo, 08 Aug 2026: "for every action we do two follow-ups in the same
// hour, like maybe one after ten minutes, and another one after thirty
// minutes, and then another one around six hours and then another one like
// twenty-three hours. So that means four follow-ups." All four ride the free
// 24h window their own message opened (23h is deliberately inside it), so
// none of this costs a template. If that whole ladder gets no reply, the
// spell is over and we stop; a lead whose window is ALREADY shut when we
// find them goes to the template drip instead, the only channel that still
// reaches them.
// ------------------------------------------------------------------

/** Minutes after THEIR last message that each chase goes out. */
export const LEAD_CHASE_RUNG_MINUTES = [10, 30, 360, 1380] as const;
/** Lifetime free-form chases per lead, across every quiet spell: two spells. */
export const LEAD_CHASE_LIFETIME_CAP = 8;

/** Which wording each rung uses. Rung 1 is contextual; the rest escalate. */
function chaseKeyFor(rung: number, sentVideo: boolean, sentSignup: boolean): string {
  if (rung === 0) return sentSignup ? "chase_signup" : sentVideo ? "chase_watch" : "chase_hello";
  if (rung === 1) return "chase_second";
  if (rung === 2) return "chase_third";
  return "chase_final";
}

export interface LeadChaseContext {
  /** Minutes since THEIR newest message: the spell clock every rung hangs off. */
  minutesSinceTheirMessage: number;
  /** They wrote after our last message: the reply engine owns this thread. */
  repliedSinceWeWrote: boolean;
  /** Their 24h free-form window is still open. */
  windowOpen: boolean;
  /** Chases already sent since THEIR newest message (this quiet spell). */
  chasesThisSpell: number;
  /** Lifetime chase_count from the lead row. */
  chaseCount: number;
  sentVideo: boolean;
  sentSignup: boolean;
  firstName?: string | null;
  watchCode?: string | null;
}

export type LeadChaseDecision =
  | { action: "send"; key: string; rung: number; text: string; reason: string }
  | { action: "wait"; reason: string; dueInMinutes?: number }
  | { action: "hand_to_drip"; reason: string }
  | { action: "stop"; reason: string };

export function decideLeadChase(ctx: LeadChaseContext): LeadChaseDecision {
  // "The reply engine owns it" is only true while the reply engine still has a
  // move. It gets ONE action per inbound message, so once it has handed a
  // question to a human, nobody owns it at all: Lawrence asked whether there
  // was an app to watch his traffic and sat for five hours (08 Aug 2026). Same
  // rule as the creator ladder: after the grace, we chase anyway.
  if (ctx.repliedSinceWeWrote && ctx.minutesSinceTheirMessage < UNANSWERED_GRACE_MINUTES) {
    return { action: "wait", reason: "they wrote last, the reply engine owns it" };
  }
  if (ctx.chaseCount >= LEAD_CHASE_LIFETIME_CAP) {
    return { action: "stop", reason: "lifetime chase cap spent" };
  }
  if (ctx.chasesThisSpell >= LEAD_CHASE_RUNG_MINUTES.length) {
    return { action: "stop", reason: "all four chases sent this spell, the ball is theirs" };
  }
  if (!ctx.windowOpen) {
    return { action: "hand_to_drip", reason: "24h window shut, only a template can reach them" };
  }
  const due = LEAD_CHASE_RUNG_MINUTES[ctx.chasesThisSpell];
  if (ctx.minutesSinceTheirMessage < due) {
    return {
      action: "wait",
      reason: `rung ${ctx.chasesThisSpell + 1} is ${Math.ceil(due - ctx.minutesSinceTheirMessage)} min away`,
      dueInMinutes: due - ctx.minutesSinceTheirMessage,
    };
  }
  const key = chaseKeyFor(ctx.chasesThisSpell, ctx.sentVideo, ctx.sentSignup);
  return {
    action: "send",
    key,
    rung: ctx.chasesThisSpell + 1,
    text: REPLIES[key]({
      hi: nameOf(ctx.firstName),
      code: ctx.watchCode || "",
      sentence: "",
      link: "",
    }),
    reason: `quiet ${Math.round(ctx.minutesSinceTheirMessage)} min with no account, rung ${ctx.chasesThisSpell + 1}: ${key}`,
  };
}

// ------------------------------------------------------------------
// Self-check
// ------------------------------------------------------------------

/**
 * Every sentence this file can produce, with the house rules measured on it.
 * Tests assert the offender lists are empty, so a new reply that mentions
 * money or carries a long dash fails the build rather than reaching a creator.
 */
export function replyBrainSelfCheck(): Array<{
  key: string;
  text: string;
  money: boolean;
  punctuation: boolean;
  length: number;
}> {
  const v: Vars = {
    hi: "Sam, ",
    code: "1234",
    // Realistic samples so the house rules are measured on what really goes
    // out. The sentence corpus itself is money-word-free by its own test.
    sentence: "AI made every clip on this page. The link below shows the tool.",
    link: "https://www.skool.com/ai-influencer-flywheel-5612/about?ref=abc123",
  };
  return Object.entries(REPLIES).map(([key, fn]) => {
    const text = fn(v);
    return {
      key,
      text,
      money: PAYOUT.test(text),
      // NOTE: this measures PAYOUT, not cost. A reply may say "it is free",
      // that is the answer to what it costs them. What no reply may do is
      // raise what they earn, when they are paid, or how they withdraw.
      // Long dashes, curly quotes and the ellipsis character. A standing
      // project rule, and on SMS one long dash cuts the segment from 160
      // characters to 70.
      punctuation: /[–—‘’“”…]/.test(text),
      length: text.length,
    };
  });
}
