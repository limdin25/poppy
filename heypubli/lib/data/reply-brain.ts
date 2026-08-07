import { ONBOARDING_STEPS } from "@/lib/data/onboarding";
import { COMMISSION_RATE } from "@/lib/earnings";
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
  /** Onboarding steps completed. Order does not matter. */
  stepsDone: readonly OnboardingStepId[];
  /** Whether a HeyPubli account exists for this person at all. */
  hasAccount: boolean;
  firstName?: string | null;
  /** Their per-lead code for heypubli.com/watch?u=CODE */
  watchCode?: string | null;
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
    `\\bnot${G}want\\b`,
    `\\bdon'?t${G}want\\b`,
    `\\bno${G}thanks?\\b`,
    "\\bstop\\b",
    "\\bunsubscribe\\b",
    `\\bremove${G}me\\b`,
    `\\bleave${G}me\\b`,
    "\\bnahi\\b",
    "\\bnever\\s*mind\\b",
    "^\\W*no\\W*$",
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

/** "Ok sir", "thanks", a lone thumbs up. Nothing is being asked. */
const ACK = /^\W*(ok(ay)?|k+|thanks?|thank\s*you|thx|ty|sure|fine|got\s*it|noted|great|nice|good|yes)?(\s*(ji|sir|ma'?am|bro|boss))?\W*$/i;

/** They are trying and it is not working. The most valuable signal we get. */
const STUCK = new RegExp(
  [
    "\\b(stuck|unable|problem|issue|error|help)\\b",
    "\\b(can'?t|cant|cannot|won'?t\\s+let|not\\s+allow)",
    "\\b(not|isn'?t|doesn'?t|does\\s+not)\\s+work",
    "\\bnot\\s+(find|showing|opening)\\b",
    "\\bno\\s+(option|email|invite|mail|link)\\b",
    "\\bwhere\\s+is\\b",
    "\\bhow\\s+do\\s+i\\b",
    "\\bnothing\\s+happen",
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
  /\b(details?|how\s+(does|do|it)|what\s+is\s+(this|it)|explain|tell\s+me|more\s+info|what\s+work|what\s+kind|what\s+now|what'?s\s+next|next\s+process|next\s+step)\b/i;

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

  // --- has an account ---
  already_have_account: ({ hi }) =>
    `${hi}your account is already made, so there is nothing to sign up for. Go straight to heypubli.com/onboarding and it carries on where you stopped.\n\nIf that page is what is stopping you, send me a screenshot of it and I will tell you exactly what to tap.`,
  all_done: ({ hi }) =>
    `${hi}nothing at all, you are set up. All five steps are done and your link is live on your page.\n\nYour videos start going out from here. I will let you know when the first one lands.`,

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
  step_bio: ({ hi }) =>
    `${hi}last step. Copy the sentence and your link from heypubli.com/onboarding into your Instagram bio, under Edit profile, then Links.`,

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
  stuck_bio: ({ hi }) =>
    `${hi}send me a screenshot of your Edit profile screen and I will tell you where it goes.\n\nThe sentence and the link are both ready to copy at heypubli.com/onboarding.`,

  // --- checking back on somebody who went quiet mid-step ---
  check_in_1: ({ hi }) =>
    `${hi}is everything ok? If you got stuck anywhere, just tell me what you can see on the screen and I will sort it.`,
  check_in_2: ({ hi }) =>
    `${hi}just checking again, I saw you stopped partway. Tell me where you got to and I will finish it with you, or send a screenshot and I will point at exactly what to tap. I am here to help.`,
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
  return REPLIES[key]({ hi: nameOf(ctx.firstName), code: ctx.watchCode || "" });
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

export function decideReply(ctx: ReplyContext): ReplyDecision {
  const said = ctx.said.map((s) => (s || "").trim()).filter(Boolean);
  if (said.length === 0) {
    return { action: "silence", reason: "nothing said since our last message" };
  }
  const text = said.join(" \n ");

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
  if (SAFETY.test(text)) {
    return {
      action: "send",
      key: "account_safe",
      text: render("account_safe", ctx),
      reason: "worried about the account",
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
    if (WHAT.test(text) || YES.test(text) || WATCHED.test(text)) {
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

  // Watched it, or said yes to a video they already have. Either way the next
  // thing they need is the account, not the video again.
  if (WATCHED.test(text) || (hasVideo && (YES.test(text) || onlyAck))) {
    if (hasSignup) {
      return { action: "human", reason: "already has the signup link and is still writing" };
    }
    return { action: "send", key: "signup", text: render("signup", ctx), reason: "ready for the account" };
  }
  if (hasVideo && WHAT.test(text)) {
    return { action: "human", reason: "has the video and is asking questions, answer properly" };
  }
  if (!ctx.watchCode) {
    return { action: "human", reason: "no video code for this lead" };
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
  /** Check-ins already spent on the step they are on now. */
  checkInsThisStep: number;
  openStep: OnboardingStepId | null;
  /** Did they write to us in the last 24 hours? Free-form only lands if so. */
  windowOpen: boolean;
  firstName?: string | null;
}

export type CheckInDecision =
  | { action: "send"; key: string; text: string; reason: string }
  | { action: "wait"; reason: string }
  | { action: "handover"; reason: string };

/**
 * The short follow-up ladder. Hugo, 07 Aug 2026: "we should have some small
 * follow-ups. Hey, is everything ok? Then take longer. Just checking again, I
 * saw you stopped, please let me know, I'm here to help."
 *
 * Two rungs and no more, both inside the day they started:
 *
 *   15 minutes  long enough to read an email and tap a button, short enough
 *               that they are still holding the phone. This is the one that
 *               actually saves people.
 *   90 minutes  they put it down. Ask once more, warmly, and offer to do it
 *               with them.
 *
 * Then it stops and the slow ladder in onboarding-nudges.ts takes over at 2h,
 * 22h and 44h. A third message the same day is pestering, and pestering on a
 * shared WhatsApp sender buys blocks, not signups.
 *
 * Deliberately does no clock or timezone work: this file only decides. Quiet
 * hours in the creator's own timezone are checked at the sending layer, where
 * the phone number lives.
 */
export const CHECK_IN_LADDER_MINUTES = [15, 90] as const;

export function decideCheckIn(ctx: CheckInContext): CheckInDecision {
  if (ctx.repliedSinceWeWrote) {
    return { action: "wait", reason: "they answered, this is a conversation not a chase" };
  }
  if (ctx.openStep === null) {
    return { action: "wait", reason: "nothing left for them to do" };
  }
  if (ctx.checkInsThisStep >= CHECK_IN_LADDER_MINUTES.length) {
    return { action: "handover", reason: "both check-ins spent, the slow nudge ladder has it" };
  }
  if (!ctx.windowOpen) {
    // Outside 24h only an approved template can be sent, and that is the nudge
    // brain's job. Trying here would just bounce with window_closed.
    return { action: "handover", reason: "24h window shut, needs a template" };
  }
  const due = CHECK_IN_LADDER_MINUTES[ctx.checkInsThisStep];
  if (ctx.minutesSinceWeWrote < due) {
    return { action: "wait", reason: `${due - Math.round(ctx.minutesSinceWeWrote)} minutes early` };
  }
  const key = ctx.checkInsThisStep === 0 ? "check_in_1" : "check_in_2";
  return {
    action: "send",
    key,
    text: REPLIES[key]({ hi: nameOf(ctx.firstName), code: "" }),
    reason: `quiet ${Math.round(ctx.minutesSinceWeWrote)} minutes on ${ctx.openStep}`,
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
  const v: Vars = { hi: "Sam, ", code: "1234" };
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
