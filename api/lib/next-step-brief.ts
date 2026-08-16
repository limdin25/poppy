// THE NEXT-STEP BRAIN. After every property call, what to do next, in writing.
//
// Hugo, 2026-08-14: "build the brain that always after the call gets the
// exactly instruction for the next step for me to read, so after call fires and
// confirm whats next step with confidence."
//
// A tag on a card ("Do the homework") tells you the STAGE. It does not tell you
// who does what, with which number, or what is standing in the way. Hugo was
// writing that by hand every evening, one paragraph per live deal:
//
//     KEEP: DDM Grimsby, Orion Way
//     Asking: £110k | Our offer: £96,375 (with the vendor)
//     Why it holds: two houses on the same street sold this winter ...
//     Pedro today: Ring Doug. Chase the answer. Ask again for the video.
//     Price ladder: hold at £96,375 ... never past £102,800
//     Board: Offer sent
//
// This file writes that paragraph, from the call that just happened. The SHAPE
// is copied from the two he wrote by hand, because that is the format he
// already reads without thinking.
//
// THREE LAWS, all of them learned the hard way in this codebase:
//
//   1. DETERMINISTIC. No model decides what to do next, exactly as
//      src/features/crm/lib/nextStep.ts says. A brief is a rule applied to
//      facts, so it can be tested, and it cannot invent a fact on a call sheet.
//   2. NEVER DERIVE THE MONEY. Every figure is READ: offerRange() for the band,
//      ladderText() for the climb, brrr-deal-facts for the strategy, the BMV
//      band and the condition read. Re-deriving any of them here would be a
//      second opinion about what we are willing to pay, which is the exact bug
//      api/lib/brrr-offer.ts exists to prevent.
//   3. SILENCE OVER GUESSWORK. A missing fact becomes a BLOCKER, never an
//      assumption. "No video walkthrough yet" is useful; a confident sentence
//      built on nothing is what puts a wrong number in front of an agent.
//
// The confidence level is about OUR EVIDENCE, not about how the call felt. It
// answers one question: how sure can Hugo be that this instruction is right?

import { offerRange, ladderText, fmtGBP, countComps, readDealMoney, type OfferPercents } from './brrr-offer.js';
import {
  dealStrategy, dealBmvBand, conditionClause, pluckString,
} from './brrr-deal-facts.js';

export type Verdict = 'KEEP' | 'HOLD' | 'DROP';
export type Confidence = 'high' | 'medium' | 'low';
export type Who = 'PEDRO' | 'HUGO' | 'NOBODY';

export interface NextStepBrief {
  /** Bumped if the shape changes, so an old brief on a row is recognisable. */
  version: 1;
  written_at: string;
  /** Keep going, hold until something is answered, or drop it. */
  verdict: Verdict;
  /** "KEEP: DDM Residential, Grimsby, Orion Way" */
  headline: string;
  /** The deal-process tag this leaves the branch on. */
  step: string;
  /** Who does the next thing. */
  who: Who;
  asking: number | null;
  offer: number | null;
  ceiling: number | null;
  /** The climb, e.g. "£96,375, then £100,500, then £102,800". */
  ladder: string;
  /** Why this is worth keeping, read from the engine, never argued here. */
  why: string[];
  /** The instruction. Short imperative lines, in the order they happen. */
  do_now: string[];
  /** What stops the next step, or would make it a guess. */
  blockers: string[];
  /** Which CRM board column it belongs in now. */
  board: string | null;
  confidence: {
    level: Confidence;
    /** One sentence: what the level is based on. */
    why: string;
    /** The cheapest missing thing that would raise it. Null when at high. */
    raise: string | null;
  };
}

/** Everything the brief is built from. All of it already exists on the row or
 *  in the call: nothing here is fetched, so this stays a pure function. */
export interface BriefInput {
  property: {
    address?: string | null;
    agent_name?: string | null;
    asking_price?: number | string | null;
    price_text?: string | null;
    bedrooms?: number | null;
    floor_area_sqm?: number | null;
    status?: string | null;
    deal?: Record<string, unknown> | null;
  };
  /** The outcome the agent pressed. */
  outcome: string;
  /** The 16-question checklist as it now stands on the property. */
  qualification?: Record<string, unknown> | null;
  /** Free text the agent typed on this call. */
  note?: string | null;
  /** The deal-process tag the outcome maps to. '' means the deal is dead,
   *  undefined means the outcome says nothing about progress. Passed in rather
   *  than recomputed: STEP_FOR_OUTCOME already lives in the outcome route and
   *  two copies of that map is how a card ends up pointing at nothing. */
  step?: string;
  /** The board column the outcome moves the card to, when it moves one. */
  board?: string | null;
  /** The address on the CRM lead behind this branch, when it has one.
   *
   *  Hugo, 2026-08-14, clicking Email on a live deal and getting "contact has no
   *  email address": "on the notes there's the instructions, one is to get the
   *  ballpark confirmed and the other one is to get their email." Nothing about
   *  this deal can be put in writing without it, so a branch we cannot email is
   *  a blocker in its own right and the chase is an instruction, not a wish. */
  contactEmail?: string | null;
  /** Live offer percentages, for the fallback band on a property that arrived
   *  with no valuation. */
  percents?: Partial<OfferPercents> | null;
  /** Overrideable clock, so a test can assert the whole object. */
  now?: Date;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** True when an answer means "yes, we have it", not merely "the field exists".
 *  "no", "not yet", "n/a" and "-" are all answers, and all of them mean the
 *  thing is still missing. */
function has(v: unknown): boolean {
  const s = str(v).toLowerCase();
  if (!s) return false;
  return !['no', 'none', 'n/a', 'na', '-', 'not yet', 'nope', 'no answer', 'unknown', 'not asked'].includes(s);
}

/** The street, as Pedro says it: the first part of the address. */
export function streetOf(address?: string | null): string {
  const s = str(address);
  if (!s) return 'this property';
  return s.split(',')[0].trim() || s;
}

/** "DDM Residential, Grimsby, Orion Way" */
function headlineFor(verdict: Verdict, input: BriefInput): string {
  const branch = str(input.property.agent_name);
  const street = streetOf(input.property.address);
  return `${verdict}: ${[branch, street].filter(Boolean).join(', ')}`;
}

/** What the branch actually said, when they said a number. */
function theirFigure(q: Record<string, unknown>): string {
  return str(q.best_price_indicated);
}

/** Do we have somewhere to send this branch an email?
 *
 *  Two places hold one: the CRM lead (written the moment Pedro sends the video
 *  request from the dialer) and the checklist, when he typed it on the call and
 *  never sent anything. Either counts. */
function hasEmail(input: BriefInput): boolean {
  const q = (input.qualification ?? {}) as Record<string, unknown>;
  const candidate = str(input.contactEmail) || str(q.branch_email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(candidate);
}

/** The one line that unblocks everything else, when we cannot write to them. */
function emailLine(input: BriefInput): string | null {
  if (hasEmail(input)) return null;
  return 'Ask for their email address and send the video request while they are still on the phone. Nothing can be put in writing until we have it.';
}

/**
 * Everything we asked for on the call and did not get, in the order it costs us.
 *
 * This is the part Hugo cannot hold in his head across forty branches, and it
 * is why the brief exists: the next step is nearly always "chase the one thing
 * that is missing", not "wait".
 */
function blockersFor(input: BriefInput, band: { min: number; max: number }): string[] {
  const q = (input.qualification ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  const text = `${str(input.note)} ${Object.values(q).map(str).join(' ')}`.toLowerCase();

  if (input.property.status === 'auditor_killed') {
    out.push('The auditor withdrew this valuation, so no figure on it may be quoted.');
  }
  if (!band.max) {
    out.push('No offer band on this one, so nobody may name a figure until it is priced.');
  }
  // Said out loud by an agent, on a real call, and it stops everything: an
  // offer nobody will put to the vendor is not an offer. Matched on the words
  // rather than guessed, so it only appears when somebody actually wrote it.
  if (/proof of fund|pof\b|evidence of fund/.test(text)) {
    out.push('The branch wants proof of funds before the offer goes to the vendor. A dated bank statement is enough.');
  }
  if (/viewing first|before (a|any) viewing|want(s)? a viewing|must view/.test(text)) {
    out.push('They want somebody to view it before they will put an offer forward. Our builder is the viewer.');
  }
  if (!hasEmail(input)) {
    out.push('No email address for this branch, so nothing about this deal can go to them in writing.');
  }
  if (!has(q.video_walkthrough)) {
    out.push('No video walkthrough yet, so the builder cannot price the works without a trip.');
  }
  if (!Number(input.property.floor_area_sqm)) {
    out.push('No floor area on file, so the valuation cannot be checked against what sold nearby.');
  }
  if (!theirFigure(q)) {
    out.push('They have not named a figure yet, so we are still negotiating against ourselves.');
  }
  if (!has(q.condition_notes)) {
    out.push('The condition was never pinned down, and that is the refurb number.');
  }
  return out;
}

/** How sure Hugo can be that this instruction is right.
 *
 *  Scored on EVIDENCE, never on how the call felt. The engine's own confidence
 *  in the valuation is worth the most, because everything downstream (the
 *  opener, the ladder, the ceiling) is built on it. */
function confidenceFor(input: BriefInput, band: { min: number; max: number }) {
  const deal = input.property.deal ?? {};
  const q = (input.qualification ?? {}) as Record<string, unknown>;
  const cmv = (deal.cmv && typeof deal.cmv === 'object' ? deal.cmv : {}) as Record<string, unknown>;
  const level = str(cmv.confidence ?? deal.cmv_confidence).toLowerCase();
  const nUsed = compCount(deal);

  let score = 0;
  const good: string[] = [];
  const bad: string[] = [];

  if (level === 'high') { score += 2; good.push('a high-confidence valuation'); }
  else if (level === 'medium') { score += 2; good.push('a fair-evidence valuation'); }
  else if (level === 'low') { score += 1; bad.push('a thin valuation'); }
  else { bad.push('no valuation confidence at all'); }

  if (nUsed >= 3) { score += 1; good.push(`${nUsed} sold comparables`); }
  else if (nUsed > 0) { bad.push(`only ${nUsed} sold comparable${nUsed === 1 ? '' : 's'}`); }
  else bad.push('no sold comparables on file');

  if (Number(input.property.floor_area_sqm) > 0) { score += 1; good.push('a floor area'); }
  else bad.push('no floor area');

  if (theirFigure(q)) { score += 1; good.push('a figure from the branch'); }
  else bad.push('no figure from the branch');

  if (has(q.condition_notes)) { score += 1; good.push('the condition from the call'); }
  else bad.push('no condition read');

  if (!band.max) score = 0;

  const cLevel: Confidence = score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';
  const why = cLevel === 'high'
    ? `Built on ${good.slice(0, 3).join(', ')}.`
    : good.length
      ? `Built on ${good.slice(0, 2).join(' and ')}, but ${bad.slice(0, 2).join(' and ')}.`
      : `Nothing solid behind it: ${bad.slice(0, 3).join(', ')}.`;

  // The cheapest thing that moves the needle, in the order it is easy to get.
  const raise = cLevel === 'high' ? null
    : !theirFigure(q) ? 'Get a figure out of the branch on the next call.'
      : !Number(input.property.floor_area_sqm) ? 'Ask the branch for the floor plan, it is on their file.'
        : !has(q.condition_notes) ? 'Pin the condition down: the big four, and how old the kitchen and bathroom are.'
          : 'Get a done-up sale on that street out of the agent.';

  return { level: cLevel, why, raise };
}

/** How many sold comparables the valuation actually stands on.
 *
 *  THREE PLACES, all of them real and all of them live in the table today:
 *  valuation.py writes deal.cmv.comps (a count) and deal.evidence (the rows);
 *  the older shape wrote cmv.n_used with the rows under cmv.audit. Reading only
 *  one of them is how a house with three sold comps 400m away reported "no sold
 *  comparables on file" and dropped its own confidence a whole level, which was
 *  the first thing this brain got wrong on real data (checked against Welwyn
 *  Park Road, 2026-08-14). */
export function compCount(deal: Record<string, unknown> | null | undefined): number {
  // Delegates to the canon in brrr-offer.ts so there is exactly one counter.
  return countComps(deal);
}

/** Why this is worth keeping, in the engine's own terms. Read, never argued. */
function whyFor(input: BriefInput, band: { min: number; max: number }): string[] {
  const deal = input.property.deal ?? {};
  const subject = { deal };
  const out: string[] = [];

  const strategy = dealStrategy(subject);
  const bmv = dealBmvBand(subject);
  if (strategy && bmv) out.push(`${strategy}, ${bmv.label.toLowerCase()}. ${bmv.note}`);
  else if (strategy) out.push(`The engine calls this a ${strategy}.`);
  else if (bmv) out.push(`${bmv.label}. ${bmv.note}`);

  // THE ENGINE'S OWN PARAGRAPH, when it wrote one. deal.why already says what
  // it is worth, what the refurb costs, what the comps are and why the seller
  // looks warm, in one sentence Hugo can read. Anything assembled here would be
  // a worse second version of it, so it wins and the fallback below only runs
  // when the property arrived without it.
  const engineWhy = typeof deal.why === 'string' ? deal.why.trim() : '';
  const worth = readDealMoney({ deal }).cmv ?? 0;
  const asking = Number(input.property.asking_price) || 0;

  if (engineWhy) {
    // The engine's paragraph opens with "Open at X, never above Y." The brief
    // prints the band and the ladder in their own lines, so leaving it here
    // states the walk-away twice, and the walk-away is the one figure that
    // should appear as rarely as possible.
    const trimmed = engineWhy.replace(/^Open at [^.]*\.\s*/i, '');
    out.push(trimmed.length > 600 ? `${trimmed.slice(0, 600)}...` : trimmed);
  } else {
    if (worth > 0) {
      const cond = conditionClause(subject);
      out.push(
        `Worth about ${fmtGBP(worth)} today${cond ? `, ${cond}` : ''}` +
        `${asking > 0 ? `, against ${fmtGBP(asking)} asking` : ''}.`,
      );
    }
    // The sold comparables. The engine's own sentence when it wrote one,
    // otherwise the rows themselves: raw sold price and date, never the
    // time-adjusted figure, because these get said out loud to somebody who
    // can look them up.
    const compsNote = typeof deal.comps_note === 'string' ? deal.comps_note.trim() : '';
    if (compsNote) {
      out.push(`Evidence: ${compsNote}.`);
    } else {
      const cmvObj = (deal.cmv && typeof deal.cmv === 'object' ? deal.cmv : {}) as Record<string, unknown>;
      const rows = [
        ...(Array.isArray(cmvObj.audit) ? cmvObj.audit as Array<Record<string, unknown>> : [])
          .filter((a) => a.included === true),
        ...(Array.isArray(deal.evidence) ? deal.evidence as Array<Record<string, unknown>> : [])
          .filter((e) => typeof e === 'object' && e !== null),
      ];
      const comps = rows
        .filter((a) => Number(a.price) > 0)
        .slice(0, 2)
        .map((a) => `${str(a.address)} sold for ${fmtGBP(Number(a.price))}${a.date ? ` (${str(a.date)})` : ''}`);
      if (comps.length) out.push(`Evidence: ${comps.join('; ')}.`);
    }
  }

  // deal.verdict is a CODE on the live engine ("pass"), not a sentence, and
  // printing it dropped the word "pass" into the middle of the paragraph. Only
  // something that reads like a sentence is worth showing.
  const verdict = pluckString(deal, 'verdict');
  if (verdict && verdict.includes(' ') && verdict.length <= 200) out.push(verdict);

  if (band.max > 0 && asking > 0) {
    const pct = Math.round((1 - band.min / asking) * 100);
    if (pct > 0) out.push(`Our opener is ${pct}% under the asking price, the ceiling is ${fmtGBP(band.max)}.`);
  }
  return out.filter(Boolean);
}

/** The instruction itself: who, and the lines they act on, in order. */
function doNowFor(
  input: BriefInput,
  step: string,
  band: { min: number; max: number },
  ladder: string,
  blockers: string[],
): { who: Who; lines: string[] } {
  const q = (input.qualification ?? {}) as Record<string, unknown>;
  const branch = str(input.property.agent_name) || 'the branch';
  const person = str(q.branch_contact_name);
  const ring = person ? `Ring ${person} at ${branch}` : `Ring ${branch}`;
  const street = streetOf(input.property.address);
  const figure = theirFigure(q);
  const lines: string[] = [];

  // Whatever the step, an unanswered blocker IS the next action. Chasing the
  // missing thing beats every other instruction on the page.
  const email = emailLine(input);
  const chase = (): void => {
    if (email) lines.push(email);
    if (!has(q.video_walkthrough)) lines.push('Ask again for the video walkthrough, that is what the builder prices from.');
    if (!Number(input.property.floor_area_sqm)) lines.push('Ask for the floor plan by email, it is on their file.');
  };

  switch (step) {
    case 'Discovery call':
      return {
        who: 'PEDRO',
        lines: [
          `Nobody has spoken to ${branch} about ${street} yet. ${ring} again.`,
          'Try a different hour to the last attempt, and ask for whoever is on the desk.',
          'Discovery only: no number of ours, get THEIR figure.',
        ],
      };

    case 'Do the homework':
      lines.push(
        figure
          ? `${branch} said ${figure} on ${street}. Price it against that, then confirm the band.`
          : `Price ${street} off what the agent said, then confirm the band.`,
      );
      if (band.max > 0) lines.push(`Today's band opens at ${fmtGBP(band.min)} and stops at ${fmtGBP(band.max)}. Confirm or move it before call two.`);
      lines.push(
        blockers.some((b) => b.startsWith('No video'))
          ? 'No video yet, so the builder cannot ballpark it. Chase the video, then send it with the floor plan.'
          : 'Send the video, the photos and the floor plan to the builder for a ballpark.',
      );
      lines.push(
        has(q.viewing_availability) || person
          ? `Then Pedro rings ${person || branch} back with the confirmed figure. Call two, offer call.`
          : 'Then Pedro rings back at the booked time with the confirmed figure. Call two, offer call.',
      );
      if (email) lines.push(`Pedro, before any of that: ${email.charAt(0).toLowerCase()}${email.slice(1)}`);
      return { who: 'HUGO', lines };

    case 'Chase the agent':
      lines.push(`${ring} back on ${street}. Chase the answer, nothing new to add.`);
      if (figure) lines.push(`They are on ${figure}. Do not move off our number until they do.`);
      chase();
      lines.push('If they still have no answer, book the next time and log it. A booked time is not pestering.');
      return { who: 'PEDRO', lines };

    case 'Offer call':
      lines.push(`${ring} at the booked time: "I said I'd do the homework and come back to you, so here I am."`);
      if (band.min > 0) lines.push(`Open at ${fmtGBP(band.min)}. One number, then silence.`);
      if (ladder) lines.push(`Climb one rung at a time: ${ladder}.`);
      lines.push('Never say the ceiling out loud, and never book a viewing.');
      return { who: 'PEDRO', lines };

    case 'Email the offer':
      // No address means there is no offer to send, so that is the step, and it
      // is Pedro's, not Hugo's. Printing "Hugo emails the offer" over a lead
      // with nowhere to send it is how a deal sits still for a week.
      if (email) {
        lines.push(`There is nowhere to send it. ${email}`);
        lines.push(`Then Hugo emails the offer on ${street}${band.min > 0 ? ` at ${fmtGBP(band.min)}` : ''}, subject to our builder.`);
        return { who: 'PEDRO', lines };
      }
      lines.push(`Hugo emails the offer on ${street}${band.min > 0 ? ` at ${fmtGBP(band.min)}` : ''}, subject to our builder.`);
      lines.push('Pedro rings the same day to say it has landed and to ask when the vendor will have seen it.');
      return { who: 'HUGO', lines };

    case 'Book the viewing':
      lines.push('The ballpark is agreed, so the builder goes round. He is the viewing and he prices the works in the same trip.');
      lines.push('Itemised, in writing, and tell him the budget so he flags an overrun before we confirm.');
      return { who: 'HUGO', lines };

    case 'Get it in writing':
      lines.push(`${ring} and ask for one email confirming ${street} and the agreed price. A yes on the phone is not a deal.`);
      return { who: 'PEDRO', lines };

    default:
      // No step: either the deal is dead, or the outcome said nothing about
      // progress. Both are honest answers and neither is an instruction.
      if (input.outcome === 'not_qualified') {
        return {
          who: 'NOBODY',
          lines: [
            `Filed as not for us. Nothing to do on ${street} today.`,
            'It stays on the board for a six-week follow up. A no is not dead, it is just not now.',
          ],
        };
      }
      lines.push(`Nothing has changed on ${street}. The step it was on still stands.`);
      chase();
      return { who: 'PEDRO', lines };
  }
}

/**
 * Build the brief. Pure: the same inputs always produce the same paragraph.
 */
export function buildNextStepBrief(input: BriefInput): NextStepBrief {
  const band = offerRange(
    { asking_price: input.property.asking_price, deal: input.property.deal },
    input.percents,
  );
  const deal = input.property.deal ?? {};
  const isAuction = deal.is_auction === true || deal.is_auction === '1';
  const ladder = band.max > 0 ? ladderText(deal, band, isAuction) : '';
  const step = str(input.step);
  const blockers = blockersFor(input, band);
  const { who, lines } = doNowFor(input, step, band, ladder, blockers);
  const confidence = confidenceFor(input, band);

  // The verdict is about whether this house is still worth our time, and it is
  // decided by facts, not by tone. A withdrawn valuation or a "not for us" is a
  // DROP; a house nobody can price yet is a HOLD, which is not the same as a no.
  const verdict: Verdict =
    input.outcome === 'not_qualified' || input.property.status === 'auditor_killed'
      ? 'DROP'
      : band.max > 0
        ? 'KEEP'
        : 'HOLD';

  return {
    version: 1,
    written_at: (input.now ?? new Date()).toISOString(),
    verdict,
    headline: headlineFor(verdict, input),
    step: step || (verdict === 'DROP' ? '' : 'Chase the agent'),
    who,
    asking: Number(input.property.asking_price) || null,
    offer: band.min || null,
    ceiling: band.max || null,
    ladder,
    why: verdict === 'DROP' ? [] : whyFor(input, band),
    do_now: lines,
    blockers,
    board: input.board ?? null,
    confidence,
  };
}

/**
 * The brief as Hugo reads it: plain text, no markup, no long dashes.
 *
 * This is what goes in the notification that lands on his phone the moment
 * Pedro presses an outcome, and it is the same text the screen renders.
 */
/** The do-now lines that are safe to put in front of a MODEL WRITING TO THE
 *  BRANCH. Never use `brief.do_now` directly for that.
 *
 *  WHY THIS EXISTS. `do_now` is written for Pedro and Hugo and it states our
 *  money: "Today's band opens at X and stops at Y", and "Climb one rung at a
 *  time: A, B, C", whose last rung IS the ceiling. The very next line of the
 *  same array says "Never say the ceiling out loud".
 *
 *  ContactSmsModal was handing that whole array to SYSTEM_FOLLOW_UP as "what we
 *  have already decided to do, say only the parts that concern THEM". That
 *  prompt is forbidden from re-opening price, but forbidding a model to mention
 *  a number while showing it the number is not a fence, it is a hope. The
 *  walk-away price is the one figure in the business that must never reach the
 *  person we are negotiating against.
 *
 *  So the rule is blunt on purpose: a do-now line carrying a money figure is
 *  ours. A follow-up email has no legitimate reason to carry one, because it is
 *  not allowed to discuss price at all. */
export function externalDoNow(lines: readonly string[] | null | undefined): string[] {
  return (lines ?? []).filter((l) => !/[£$]\s?\d|\bGBP\s?\d/i.test(String(l)));
}

export function briefToText(b: NextStepBrief): string {
  const money = [
    b.asking ? `Asking: ${fmtGBP(b.asking)}` : null,
    b.offer ? `Our offer: ${fmtGBP(b.offer)}` : null,
  ].filter(Boolean).join(' | ');

  const out: string[] = [b.headline];
  if (money) out.push(money);
  if (b.why.length) out.push('', `Why it holds: ${b.why.join(' ')}`);
  if (b.do_now.length) {
    out.push('', `${b.who === 'NOBODY' ? 'Next' : `${b.who} next`}: ${b.do_now.join(' ')}`);
  }
  if (b.blockers.length) out.push('', `In the way: ${b.blockers.join(' ')}`);
  if (b.ladder) out.push('', `Price ladder: ${b.ladder}. Never past ${fmtGBP(b.ceiling)}, and never say it out loud.`);
  if (b.board) out.push('', `Board: ${b.board}`);
  out.push('', `Confidence: ${b.confidence.level}. ${b.confidence.why}${b.confidence.raise ? ` ${b.confidence.raise}` : ''}`);
  return out.join('\n');
}
