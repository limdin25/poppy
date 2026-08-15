// The stress test. Nothing leaves the building without passing through here.
//
// Hugo, 2026-08-15: "every move is backed by a stress test to ensure zero
// errors", and "if a task requires a human touch the AI flags it clearly."
//
// PURE. No network, no database, no clock of its own: `now` is passed in, so
// every check is testable with fixtures and none of them can behave differently
// on a Tuesday.
//
// IT REUSES THE FENCES, IT DOES NOT REINVENT THEM. `figuresAreOnFile` and
// `figuresIn` come from deal-state.ts, `decideCounter` and `respectsCeiling`
// from counter-position.ts, `CHECKLIST_KEYS` from deal-state.ts, `compCount`
// and `streetOf` from next-step-brief.ts. A second currency parser living here
// would be a second opinion about what a figure is, and two places deciding one
// fact is the bug this codebase keeps having.
//
// ---------------------------------------------------------------------------
// THE BLOCK / WARN RULE, and why it matters more than any individual check
// ---------------------------------------------------------------------------
//
// BLOCK is for the provably wrong and the un-undoable: a figure in writing that
// is not on the file, a send with nowhere to send it, a number above the
// ceiling, an investor pack with a hole in it.
//
// WARN is for judgement, which stays with the human.
//
// A cockpit that blocks on judgement is a cockpit somebody learns to click
// through, and a gate that is always closed is a gate nobody reads. The point
// of keeping the blocking list short is that when one does fire, it means
// something.

import {
  CHECKLIST_KEYS, figuresIn, figuresAreOnFile, STALE_HOURS, type DealState,
} from './deal-state.js';
import { decideCounter, respectsCeiling, type CounterDecision } from './counter-position.js';
import { streetOf } from './next-step-brief.js';

export type CheckLevel = 'pass' | 'warn' | 'block';

/** What a BUTTON does, which is not the same vocabulary as what the AI INTENDS.
 *
 *  The contract in deal-manager-contract.ts holds the intents (`make_offer_call`,
 *  `chase_email_reply`). These are the executions, and executions are what can
 *  be stress-tested: you can test "send exactly this text", you cannot test
 *  "chase the reply". src/features/crm/components/cockpit/cockpitActions.ts
 *  holds the one total mapping between the two, and a test keeps it total. */
export const COCKPIT_ACTIONS = [
  'call_branch',
  'draft_video_email',
  'draft_address_only_email',
  'draft_offer_email',
  'draft_follow_up_email',
  'draft_counter_reply',
  'send_email',
  'book_builder',
  'book_followup',
  'compare_comps',
  'assemble_investor_pack',
  'escalate_hugo',
  'add_note',
  'hold',
] as const;

export type CockpitAction = (typeof COCKPIT_ACTIONS)[number];

/** Who actually performs it, and through what that already exists.
 *
 *  ONE table, read by the route and by the buttons, so an action cannot exist
 *  in one and not the other. Note how many say `client`: a call is placed by
 *  the browser's Twilio device and an email is sent by an edge function, so for
 *  those the server's job is to stress-test and to write down what happened,
 *  never to do it itself. */
export const ACTION_EXECUTION: Record<CockpitAction, { by: 'server' | 'client' | 'none'; via: string }> = {
  call_branch: { by: 'client', via: 'openDialerPro -> wk-calls-create -> Twilio device' },
  draft_video_email: { by: 'server', via: 'POST /api/crm/draft-offer-email kind=video_request' },
  draft_address_only_email: { by: 'server', via: 'POST /api/crm/draft-offer-email kind=address_only' },
  draft_offer_email: { by: 'server', via: 'POST /api/crm/draft-offer-email kind=offer' },
  draft_follow_up_email: { by: 'server', via: 'POST /api/crm/draft-offer-email kind=follow_up' },
  draft_counter_reply: { by: 'server', via: 'POST /api/crm/draft-offer-email kind=counter_reply' },
  send_email: { by: 'client', via: 'supabase.functions.invoke wk-email-send' },
  book_builder: { by: 'server', via: 'brrr_properties.assigned_builder_id + viewing_at' },
  book_followup: { by: 'server', via: 'wk_contact_followups insert' },
  compare_comps: { by: 'none', via: 'a reveal in the cockpit, nothing leaves' },
  assemble_investor_pack: { by: 'server', via: 'the completeness gate, then a notification' },
  escalate_hugo: { by: 'server', via: 'wk_notifications insert, drained by notify-drain' },
  add_note: { by: 'server', via: 'a human_note row on the log' },
  hold: { by: 'server', via: 'an action_executed row saying we chose to do nothing' },
};

export const ACTION_LABEL: Record<CockpitAction, string> = {
  call_branch: 'Ring the branch',
  draft_video_email: 'Draft the video email',
  draft_address_only_email: 'Draft the address email',
  draft_offer_email: 'Draft the offer email',
  draft_follow_up_email: 'Draft the follow up',
  draft_counter_reply: 'Draft the reply on price',
  send_email: 'Send the email',
  book_builder: 'Book the builder',
  book_followup: 'Book the follow up',
  compare_comps: 'Show the comparisons',
  assemble_investor_pack: 'Check the investor pack',
  escalate_hugo: 'Send it to Hugo',
  add_note: 'Write a note',
  hold: 'Hold, nothing today',
};

/** The actions that put words in front of an estate agent in writing. */
const WRITES_TO_THE_BRANCH: CockpitAction[] = [
  'draft_video_email', 'draft_address_only_email', 'draft_offer_email',
  'draft_follow_up_email', 'draft_counter_reply', 'send_email',
];

/** Call one's email, where the hard rule lives: not our figure, not their
 *  figure, not the asking price. See CLAUDE.md and the three fences already in
 *  draft-offer-email.ts. This is the fourth, and the only one that sees the
 *  text a human actually edited. */
const CALL_ONE_EMAILS: CockpitAction[] = ['draft_video_email', 'draft_address_only_email'];

/** Actions that only make sense once the deal has reached the money end of the
 *  board. Pressing one early is a real mistake, not a judgement call. */
const MONEY_ACTIONS: CockpitAction[] = [
  'draft_offer_email', 'draft_counter_reply', 'assemble_investor_pack',
];

/** Which board columns each money action belongs to. A card in the wrong column
 *  is a live, ordinary event (that is what the `stage_mismatch` flag is for),
 *  so everything not listed here only ever warns. */
const STAGE_FOR_MONEY_ACTION: Record<string, string[]> = {
  draft_offer_email: ['Ballpark agreed', 'Needs viewing', 'Offer sent', 'Renegotiate'],
  draft_counter_reply: ['Offer sent', 'Ballpark agreed', 'Renegotiate', 'Offer accepted'],
  assemble_investor_pack: ['Offer accepted', 'Sent to investor'],
};

export interface StressCheck {
  /** Stable machine tag: greppable, testable, and never shown to a human. */
  id: string;
  level: CheckLevel;
  /** One plain line. */
  title: string;
  /** Why, in British English, written to be printed verbatim next to a
   *  disabled button. Never a code, never "validation failed". */
  detail: string;
  /** The DealState paths this rests on. */
  evidence: string[];
}

export interface StressReport {
  action: CockpitAction;
  /** True when nothing blocks. Warnings do not clear this flag. */
  ok: boolean;
  level: CheckLevel;
  blocked: string[];
  warned: string[];
  checks: StressCheck[];
  /** Only on draft_counter_reply: the raise/hold/pass decided in code, so the
   *  button can say what the email will say before it is pressed. */
  counter?: CounterDecision;
}

export interface StressInput {
  state: DealState;
  action: CockpitAction;
  /** The exact text about to leave the building, when the button carries one.
   *  On send_email this is what the human edited, which is the only version
   *  that matters. */
  draft?: { subject?: string | null; body?: string | null; kind?: string | null } | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Builders whose coverage includes this house's outcode, already matched. */
  builderMatches?: number;
  /** For book_followup. */
  dueAt?: string | null;
  /** For draft_counter_reply. */
  counter?: { theirFigure?: number | null; currentOffer?: number | null } | null;
  /** Passed in, never read off the wall clock, so tests are stable. */
  now: Date;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const pass = (id: string, title: string, detail: string, evidence: string[] = []): StressCheck =>
  ({ id, level: 'pass', title, detail, evidence });
const warn = (id: string, title: string, detail: string, evidence: string[] = []): StressCheck =>
  ({ id, level: 'warn', title, detail, evidence });
const block = (id: string, title: string, detail: string, evidence: string[] = []): StressCheck =>
  ({ id, level: 'block', title, detail, evidence });

const gbp = (n: number) => `GBP ${Math.round(n).toLocaleString('en-GB')}`;

/** Everything the human is about to put in writing, as one string. */
function draftText(input: StressInput): string {
  const d = input.draft;
  if (!d) return '';
  return `${d.subject ?? ''}\n${d.body ?? ''}`.trim();
}

/** Plain English for the checklist keys, because "condition_band" means nothing
 *  to somebody about to pick up a phone. */
const CHECKLIST_WORDS: Record<string, string> = {
  still_available: 'whether it is still available',
  why_selling: 'why they are selling',
  motivation: 'how motivated the seller is',
  condition_notes: 'what condition it is in',
  condition_band: 'how bad the works are',
  water: 'whether there is any water coming in',
  tenure: 'freehold or leasehold',
  floor_area: 'the floor area',
  rejected_offer: 'any offer already turned down, and at what level',
  agent_comparable: 'what a done up one sold for on that street',
  rent_estimate: 'what it would rent for',
  best_price_indicated: 'the best price they have hinted at',
};

const inWords = (keys: string[]): string =>
  keys.map((k) => CHECKLIST_WORDS[k] ?? k.replace(/_/g, ' ')).join(', ');

/** The durable part of an address: the street name, lowercased, with any
 *  leading house number, flat number or unit letter taken off.
 *
 *  This refines streetOf() rather than replacing it. streetOf is what a human
 *  says ("12 Welwyn Park Road"); this is what survives being retyped by an
 *  estate agent in a hurry. Returns '' when there is no usable address, and
 *  never returns streetOf's 'this property' sentinel, which would match
 *  nothing and block everything. */
function streetNameOf(address?: string | null): string {
  const first = streetOf(address);
  if (!first || first === 'this property') return '';
  const name = first
    .replace(/^(flat|apartment|apt|unit)\s+\S+\s*,?\s*/i, '')
    .replace(/^\d+[a-z]?\s*[-/]?\s*\d*[a-z]?\s+/i, '')
    .trim()
    .toLowerCase();
  // Too short to identify anything: "the" or a stray letter matches half the
  // inbox, so treat it as no address at all rather than as a free pass.
  return name.length >= 4 ? name : '';
}

// ---------------------------------------------------------------------------
// the universal checks
// ---------------------------------------------------------------------------

function universalChecks(input: StressInput): StressCheck[] {
  const { state, action } = input;
  const out: StressCheck[] = [];
  const text = draftText(input);
  const touchesBranch = action !== 'compare_comps' && action !== 'add_note'
    && action !== 'hold' && action !== 'escalate_hugo';

  // ---- the house is still a house ------------------------------------
  if (state.status === 'auditor_killed') {
    out.push(touchesBranch
      ? block('property_alive', 'The second brain withdrew this deal',
        'The auditor pulled this valuation, so the figures on it are not ones we stand behind. '
        + 'Nothing should go to the branch about this house until somebody re-prices it.',
        ['status'])
      : warn('property_alive', 'The second brain withdrew this deal',
        'The auditor pulled this valuation. You can still look and make notes.', ['status']));
  }

  // ---- THE FIGURE FENCE ----------------------------------------------
  // The same fence the Manager's own words go through. Here it is applied to
  // what a HUMAN typed, which is the version that actually reaches the branch.
  if (text) {
    const named = figuresIn(text);
    if (!figuresAreOnFile(text, state)) {
      const orphans = named.filter((n) => !state.money.figuresOnFile
        .map((f) => Math.round(f)).includes(Math.round(n)));
      out.push(block('figures_on_file', 'A figure in this is not on the deal file',
        `This names ${orphans.map(gbp).join(' and ')}, which is not a figure the engine has for this house. `
        + 'Every number that goes to a branch has to come off the file, because a number said out loud cannot be unsaid.',
        ['money.figuresOnFile']));
    } else if (named.length) {
      out.push(pass('figures_on_file', 'Every figure is on the deal file',
        `${named.map(gbp).join(', ')}, all read from the engine.`, ['money.figuresOnFile']));
    }

    // ---- THE CEILING IS NEVER SAID OUT LOUD --------------------------
    // A new fence, and the reason it is needed: the walk-away IS on the file,
    // so figuresAreOnFile would wave it straight through. THE_STRATEGY: "The
    // ceiling is never said out loud." He climbs towards it and stops dead.
    if (state.money.ceiling !== null
      && named.map((n) => Math.round(n)).includes(Math.round(state.money.ceiling))) {
      out.push(block('ceiling_not_in_writing', 'This puts our maximum in writing',
        `${gbp(state.money.ceiling)} is the most we would ever pay for this house. `
        + 'Once a branch has that in an email there is no negotiation left, only that number. '
        + 'Say a figure below it, or say no figure at all.',
        ['money.ceiling']));
    }
  }

  // ---- Hugo's rule, enforced rather than remembered -------------------
  if (text && /[–—]/.test(text)) {
    out.push(block('long_dash', 'There is a long dash in this',
      'We never use long dashes. Use a comma, a full stop or a new sentence.', []));
  }

  // ---- the card is in the right part of the board ---------------------
  if (MONEY_ACTIONS.includes(action)) {
    const wanted = STAGE_FOR_MONEY_ACTION[action] ?? [];
    const col = (state.board.column ?? '').trim();
    if (wanted.length && !wanted.includes(col)) {
      out.push(block('stage_matches_action', 'The card is not at this stage yet',
        `This house is in ${col || 'no column at all'}, and this step belongs in ${wanted.join(' or ')}. `
        + 'Move the card first if it really has got that far, so the board and the deal agree.',
        ['board.column']));
    }
  }

  // ---- Hugo's own words outrank the machine's -------------------------
  if (state.pinnedNote?.trim() && action !== 'add_note' && action !== 'hold') {
    out.push(warn('pinned_note_read', 'Hugo has pinned an instruction on this house',
      `Read it before you go: ${state.pinnedNote.trim()}`, ['pinnedNote']));
  }

  // ---- the silence itself ---------------------------------------------
  if (state.clock.stale) {
    const h = state.clock.hoursSinceTouch;
    out.push(warn('deal_gone_stale', 'Nothing has happened on this for a while',
      `Last touch was ${h === null ? 'never recorded' : `${Math.round(h / 24)} days ago`}, `
      + `and anything past ${Math.round(STALE_HOURS / 24)} working days is drifting.`,
      ['clock.stale']));
  }

  // ---- writing to a branch nobody has rung -----------------------------
  if (WRITES_TO_THE_BRANCH.includes(action)) {
    const h = state.calls.hoursSinceLast;
    if (h === null || h > 336) {
      out.push(warn('branch_not_rung_14_days', 'Nobody has rung this branch in a fortnight',
        h === null
          ? 'There is no call on file for this branch at all, so this email arrives cold.'
          : `The last call was ${Math.round(h / 24)} days ago.`,
        ['calls.hoursSinceLast']));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// per action
// ---------------------------------------------------------------------------

function actionChecks(input: StressInput): { checks: StressCheck[]; counter?: CounterDecision } {
  const { state, action, now } = input;
  const out: StressCheck[] = [];
  const text = draftText(input);
  const email = (input.contactEmail ?? '').trim();
  const phone = (input.contactPhone ?? '').trim();

  const needEmail = () => {
    if (!email) {
      out.push(block('has_email', 'There is no email address for this branch',
        'Nothing can be sent until somebody gets the address. That is the ask on the next call, '
        + 'and the video is the bonus, the address is the call.',
        ['contact.email']));
    } else {
      out.push(pass('has_email', 'There is an address to send to', email, ['contact.email']));
    }
  };

  const flagChecklistGaps = () => {
    const missing = state.checklist.missing.slice(0, 3);
    if (missing.length) {
      out.push(warn('checklist_gaps', 'Some of the call one answers are still missing',
        `Still unknown: ${inWords(missing)}. Take them with you.`,
        ['checklist.missing']));
    }
  };

  switch (action) {
    // ---- the phone --------------------------------------------------
    case 'call_branch': {
      if (!phone) {
        out.push(block('has_phone', 'There is no number for this branch',
          'There is nothing to ring. The branch record has no phone on it.', ['contact.phone']));
      } else {
        out.push(pass('has_phone', 'There is a number to ring', phone, ['contact.phone']));
      }

      // A call two with no band is somebody negotiating with no numbers, which
      // is the exact thing the two call process exists to prevent.
      const col = (state.board.column ?? '').trim();
      if ((col === 'Ready for call 2' || col === 'Ballpark agreed')
        && (state.money.open === null || state.money.ceiling === null)) {
        out.push(block('offer_band_ready', 'There is no offer band on this house yet',
          'This card is at the stage where a figure gets floated, and the engine has not finished pricing it. '
          + 'Ringing now means going in with nothing to say.',
          ['money.open', 'money.ceiling']));
      }

      if (state.calls.hoursSinceLast !== null && state.calls.hoursSinceLast < 0.5) {
        out.push(warn('redial_spacing', 'This branch was rung in the last half hour',
          'Ringing the same office twice inside thirty minutes is how a number gets a reputation.',
          ['calls.hoursSinceLast']));
      }
      flagChecklistGaps();
      break;
    }

    // ---- call one's email, where no figure may ever appear -------------
    case 'draft_video_email':
    case 'draft_address_only_email': {
      needEmail();
      const named = figuresIn(text);
      if (named.length) {
        out.push(block('call_one_carries_no_figure', 'This is a call one email and it names a figure',
          `It mentions ${named.map(gbp).join(' and ')}. The first email never carries a figure: `
          + 'not ours, not theirs, not the asking price. An email cannot be unsent.',
          ['money.figuresOnFile']));
      } else if (text) {
        out.push(pass('call_one_carries_no_figure', 'No figure anywhere in this',
          'Which is exactly right for a first email.', []));
      }
      if (state.calls.count === 0) {
        out.push(warn('discovery_call_happened', 'There is no call on file for this branch',
          'This email reads as though a conversation has just happened, and none is recorded.',
          ['calls.count']));
      }
      break;
    }

    // ---- the offer ----------------------------------------------------
    case 'draft_offer_email': {
      needEmail();
      if (state.money.open === null) {
        out.push(block('offer_on_file', 'There is no opening figure on this house',
          'The engine has not produced an opener, so there is no offer to put in writing.',
          ['money.open']));
      }
      if (state.money.ceiling === null) {
        out.push(block('ceiling_on_file', 'There is no maximum on this house',
          'Without a ceiling from the engine there is no way to know whether any figure is safe.',
          ['money.ceiling']));
      }
      if (state.money.open !== null && state.money.ceiling !== null
        && state.money.open > state.money.ceiling) {
        out.push(block('open_within_ceiling', 'The opener is above our own maximum',
          `The engine has an opener of ${gbp(state.money.open)} against a maximum of ${gbp(state.money.ceiling)}. `
          + 'That is a bad row, not a good deal, and it must not reach a branch.',
          ['money.open', 'money.ceiling']));
      }
      const tier = (state.money.compsTier ?? '').toLowerCase();
      if (tier !== 'gold' && tier !== 'strong') {
        out.push(warn('evidence_shippable', 'The evidence behind this price is below our standard',
          `The comparables are ${tier || 'not graded'}, and we normally want gold or strong before making an offer.`,
          ['money.compsTier']));
      }
      flagChecklistGaps();
      break;
    }

    // ---- they came back on price --------------------------------------
    case 'draft_counter_reply': {
      needEmail();
      const decision = decideCounter({
        ceiling: state.money.ceiling,
        currentOffer: input.counter?.currentOffer ?? state.money.open,
        theirFigure: input.counter?.theirFigure ?? null,
        evidenceTier: state.money.compsTier,
      });
      if (!respectsCeiling(decision, state.money.ceiling)) {
        out.push(block('counter_respects_ceiling', 'That reply would take us past our maximum',
          'The position worked out here pays more than the ceiling on this house, so it cannot go.',
          ['money.ceiling']));
      } else if (decision.position === 'raise') {
        out.push(pass('counter_position', 'We can move on this one', decision.reason,
          ['money.ceiling', 'money.compsTier']));
      } else {
        out.push(warn('counter_position', `The answer here is to ${decision.position}`,
          decision.reason, ['money.ceiling', 'money.compsTier']));
      }
      if ((input.counter?.theirFigure ?? null) === null) {
        out.push(warn('their_figure_known', 'We do not have the figure they asked for',
          'Without their number this reply is a guess at what they want.', []));
      }
      return { checks: out, counter: decision };
    }

    // ---- the chase ----------------------------------------------------
    case 'draft_follow_up_email': {
      needEmail();
      if (state.brief.blockers.length === 0) {
        out.push(warn('blocker_known', 'There is nothing specific to chase',
          'The brief lists no blocker, so this will read as a generic nudge.',
          ['brief.blockers']));
      }
      break;
    }

    // ---- the last gate ------------------------------------------------
    case 'send_email': {
      needEmail();
      if (!(input.draft?.subject ?? '').trim()) {
        out.push(block('subject_present', 'This email has no subject',
          'It cannot be sent without one.', []));
      }
      const hour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: 'numeric', hour12: false,
      }).format(now));
      if (hour < 8 || hour >= 20) {
        out.push(warn('quiet_hours', 'It is outside working hours',
          'It is currently outside 08:00 to 20:00 UK time. It will still go if you send it.', []));
      }
      break;
    }

    // ---- the builder --------------------------------------------------
    case 'book_builder': {
      if (!input.builderMatches) {
        out.push(block('builder_on_roster', 'No builder covers this postcode',
          'The roster has nobody for this outcode, so there is nothing to book. '
          + 'Somebody has to add a builder for this area first.',
          ['builder.matches']));
      }
      if (state.builder.booked && state.builder.viewingAt
        && Date.parse(state.builder.viewingAt) > now.getTime()) {
        out.push(warn('viewing_not_already_booked', 'A viewing is already booked on this house',
          `There is one on file for ${state.builder.viewingAt}.`, ['builder.viewingAt']));
      }
      if (state.checklist.missing.includes('condition_notes')) {
        out.push(warn('builder_has_something_to_price', 'We have no condition notes for the builder',
          'They would be going in with nothing to price off.', ['checklist.missing']));
      }
      break;
    }

    // ---- the diary ----------------------------------------------------
    case 'book_followup': {
      const due = input.dueAt ? Date.parse(input.dueAt) : NaN;
      if (!Number.isFinite(due) || due <= now.getTime()) {
        out.push(block('due_in_future', 'That time has already passed',
          'A follow up has to be booked for a time that has not happened yet.', []));
      }
      if (state.followups.nextDueAt) {
        out.push(warn('not_double_booked', 'There is already a follow up on this branch',
          `One is due at ${state.followups.nextDueAt}.`, ['followups.nextDueAt']));
      }
      break;
    }

    // ---- looking, which can never be wrong ------------------------------
    case 'compare_comps': {
      if (state.pack.compsCount === 0) {
        out.push(warn('comps_on_file', 'There are no sold comparables on file',
          'The valuation on this house does not have comps behind it yet.', ['deal.cmv.audit']));
      }
      if (state.checklist.missing.includes('floor_area')) {
        out.push(warn('size_known', 'We do not know how big it is',
          'Without a floor area the price is worked out size blind, which is how 39 Orion Way went wrong.',
          ['checklist.missing']));
      }
      break;
    }

    // ---- the pack, where every hole blocks -----------------------------
    case 'assemble_investor_pack':
      return { checks: [...out, ...packChecks(state)] };

    // ---- the three that can never be wrong -----------------------------
    case 'escalate_hugo':
    case 'add_note':
    case 'hold':
      break;
  }

  return { checks: out };
}

// ---------------------------------------------------------------------------
// the investor pack gate
// ---------------------------------------------------------------------------

/** AI_DEAL_MANAGER_PLAN section 6, mirroring BRRR_STRATEGY section 11.
 *
 *  EVERY MISSING LINE BLOCKS, deliberately, because this is the one place where
 *  the brief's own law applies hardest: a missing fact is a blocker, never an
 *  assumption. A pack that goes to an investor with a hole in it is the whole
 *  business's reputation. */
function packChecks(state: DealState): StressCheck[] {
  const out: StressCheck[] = [];

  // ---- the price, in writing, with the address ------------------------
  //
  // Match on the street NAME, not on what streetOf() returns. streetOf keeps
  // the house number ("12 Welwyn Park Road") because that is how Pedro says it
  // out loud, and a branch writing back says "for Welwyn Park Road" or "re:
  // Welwyn Park Rd". Demanding the house number would block genuinely complete
  // packs, which is the one way a blocking check does real damage.
  const street = streetNameOf(state.address);
  const inbound = (state.writing.lastInboundPreview ?? '').toLowerCase();
  const acceptedFigures = figuresIn(inbound)
    .filter((n) => state.money.figuresOnFile.map((f) => Math.round(f)).includes(Math.round(n)));
  if (!street || !inbound.includes(street) || acceptedFigures.length === 0) {
    out.push(block('pack_written_acceptance', 'We do not have the acceptance in writing',
      'The pack needs an email from the branch naming the address and the agreed price. '
      + 'A yes on the phone is not enough to send to an investor.',
      ['writing.lastInboundPreview', 'address']));
  }

  // ---- the numbers -----------------------------------------------------
  const missingNumbers = ([
    ['the asking price', state.money.asking],
    ['our agreed figure', state.money.open],
    ['the finished value', state.money.gdv],
    ['the market value today', state.money.tmv],
    ['the refurbishment cost', state.money.refurb],
  ] as const).filter(([, v]) => v === null).map(([k]) => k);
  if (missingNumbers.length) {
    out.push(block('pack_numbers', 'Some of the numbers are missing',
      `Still missing: ${missingNumbers.join(', ')}. Every figure in the pack comes off the engine.`,
      ['money']));
  }

  // ---- three sold comps, one rent comp ---------------------------------
  if (state.pack.compsCount < 3) {
    out.push(block('pack_three_sold_comps', 'There are not three sold comparables',
      `The file has ${state.pack.compsCount}. An investor pack carries three sold comparables as links.`,
      ['pack.compsCount']));
  }
  if (!state.pack.rentComp) {
    out.push(block('pack_one_rent_comp', 'There is no rent comparable',
      'The pack needs one rent comparable, because the whole case rests on what it lets for.',
      ['qualification.rent_estimate']));
  }

  // ---- photos and the floor plan ---------------------------------------
  if (!state.pack.floorplans) {
    out.push(block('pack_photos_floorplan', 'There is no floor plan on file',
      'The pack needs the photos and the floor plan.', ['floorplan_urls']));
  }

  // ---- the builder's own number ----------------------------------------
  if (state.builder.quote === null) {
    out.push(block('pack_builder_quote', 'There is no builder quote',
      'The pack needs the itemised quote from the viewing, not our own estimate.',
      ['builder.quote']));
  }

  if (out.length === 0) {
    out.push(pass('pack_complete', 'Every line of the pack is on file',
      'Acceptance in writing, the numbers, three sold comps, a rent comp, the plan and the builder quote.',
      ['money', 'builder.quote']));
  }
  return out;
}

// ---------------------------------------------------------------------------
// the entry points
// ---------------------------------------------------------------------------

export function stressTest(input: StressInput): StressReport {
  const { checks: specific, counter } = actionChecks(input);
  const checks = [...universalChecks(input), ...specific];

  const blocked = checks.filter((c) => c.level === 'block').map((c) => c.id);
  const warned = checks.filter((c) => c.level === 'warn').map((c) => c.id);

  return {
    action: input.action,
    ok: blocked.length === 0,
    level: blocked.length ? 'block' : warned.length ? 'warn' : 'pass',
    blocked,
    warned,
    // Blocks first, then warnings, then the passes, because the eye should land
    // on what is wrong rather than on a wall of ticks.
    checks: [...checks].sort((a, b) => rank(a.level) - rank(b.level)),
    ...(counter ? { counter } : {}),
  };
}

const rank = (l: CheckLevel) => (l === 'block' ? 0 : l === 'warn' ? 1 : 2);

/** Every action's report in one pass, so the cockpit can colour a whole row of
 *  buttons without a round trip each. */
export function stressAll(input: Omit<StressInput, 'action'>): Record<CockpitAction, StressReport> {
  const out = {} as Record<CockpitAction, StressReport>;
  for (const action of COCKPIT_ACTIONS) out[action] = stressTest({ ...input, action });
  return out;
}

/** One paragraph for the log row, so a refusal reads as a sentence months
 *  later rather than as a list of tags. */
export function stressToText(r: StressReport): string {
  if (r.ok && !r.warned.length) return `${ACTION_LABEL[r.action]}: every check passed.`;
  const lines = r.checks
    .filter((c) => c.level !== 'pass')
    .map((c) => `${c.level === 'block' ? 'Blocked' : 'Warning'}: ${c.title}. ${c.detail}`);
  return [`${ACTION_LABEL[r.action]}:`, ...lines].join(' ');
}

/** The checklist keys, re-exported so nothing downstream re-lists them. */
export { CHECKLIST_KEYS };
