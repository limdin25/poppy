// The buttons: what each one is called, what kind it is, and what the human is
// told just before it commits.
//
// TWO VOCABULARIES, ONE MAPPING, and this is the thing to get right.
//
//   The CONTRACT's actions (make_offer_call, chase_email_reply, ...) are what
//   the AI INTENDS. They live in api/lib/deal-manager-contract.ts, per stage.
//
//   The COCKPIT's actions (call_branch, draft_offer_email, send_email, ...) are
//   what a BUTTON EXECUTES. They live in api/lib/deal-stress-test.ts, because
//   executions are the things that can be stress-tested: you can test "send
//   exactly this text", you cannot test "chase the reply".
//
// PRIMARY_BUTTON_FOR maps one to the other, and a test keeps it total, so a new
// action added to the contract fails the build rather than rendering to Pedro
// as a raw code like `chase_written_acceptance`.
//
// Presentation only. This module contains no fetch and no supabase: the only
// component allowed to commit anything is ActionConfirmDialog.

import {
  Phone, Mail, FileText, HardHat, CalendarClock, Scale, PackageCheck,
  AlertTriangle, StickyNote, PauseCircle, MessageSquareReply, Send,
  MoveRight, Calculator, Ban,
  type LucideIcon,
} from 'lucide-react';

/** Mirrors COCKPIT_ACTIONS in api/lib/deal-stress-test.ts. */
export type CockpitAction =
  | 'call_branch'
  | 'draft_video_email'
  | 'draft_address_only_email'
  | 'draft_offer_email'
  | 'draft_follow_up_email'
  | 'draft_counter_reply'
  | 'send_email'
  | 'book_builder'
  | 'book_followup'
  | 'compare_comps'
  | 'move_stage'
  | 'mark_lost'
  | 'fetch_ballpark'
  | 'assemble_investor_pack'
  | 'escalate_hugo'
  | 'add_note'
  | 'hold';

/** How the button behaves in the UI, which decides what the gate shows.
 *   call   the dialer opens over the cockpit and rings
 *   email  a draft is fetched, edited, then sent by the browser
 *   server one POST, done
 *   reveal nothing leaves the building, it just expands */
export type ActionKind = 'call' | 'email' | 'server' | 'reveal' | 'stage';

export interface ActionSpec {
  label: string;
  kind: ActionKind;
  icon: LucideIcon;
  /** The commit button's own words. Present tense, never "the AI will". */
  commitVerb: string;
  /** For email actions: which draft api/crm/draft-offer-email.ts should write. */
  draftKind?: 'video_request' | 'address_only' | 'offer' | 'follow_up' | 'counter_reply';
}

export const COCKPIT_ACTIONS: Record<CockpitAction, ActionSpec> = {
  call_branch: { label: 'Ring the branch', kind: 'call', icon: Phone, commitVerb: 'Ring them' },
  draft_video_email: {
    label: 'Draft the video email', kind: 'email', icon: Mail,
    commitVerb: 'Send it', draftKind: 'video_request',
  },
  draft_address_only_email: {
    label: 'Draft the address email', kind: 'email', icon: Mail,
    commitVerb: 'Send it', draftKind: 'address_only',
  },
  draft_offer_email: {
    label: 'Draft the offer email', kind: 'email', icon: FileText,
    commitVerb: 'Send the offer', draftKind: 'offer',
  },
  draft_follow_up_email: {
    label: 'Draft the follow up', kind: 'email', icon: MessageSquareReply,
    commitVerb: 'Send it', draftKind: 'follow_up',
  },
  draft_counter_reply: {
    label: 'Draft the reply on price', kind: 'email', icon: Scale,
    commitVerb: 'Send the reply', draftKind: 'counter_reply',
  },
  send_email: { label: 'Send the email', kind: 'email', icon: Send, commitVerb: 'Send it' },
  book_builder: { label: 'Book the builder', kind: 'server', icon: HardHat, commitVerb: 'Book them' },
  book_followup: { label: 'Book the follow up', kind: 'server', icon: CalendarClock, commitVerb: 'Book it' },
  compare_comps: { label: 'Comparisons', kind: 'reveal', icon: Scale, commitVerb: 'Show them' },
  move_stage: { label: 'Move the stage', kind: 'stage', icon: MoveRight, commitVerb: 'Move it' },
  // Hugo, 16 Aug: "seems like it's not a good deal, there should be a button
  // there, send to the lost pipeline column." One press, the card lands in
  // Not interested and leaves the cockpit.
  mark_lost: { label: 'Send to Lost', kind: 'server', icon: Ban, commitVerb: 'Send it to Lost' },
  fetch_ballpark: { label: 'Fetch the ballpark', kind: 'server', icon: Calculator, commitVerb: 'Price it' },
  assemble_investor_pack: {
    label: 'Check the investor pack', kind: 'server', icon: PackageCheck, commitVerb: 'Check it',
  },
  escalate_hugo: { label: 'Send it to Hugo', kind: 'server', icon: AlertTriangle, commitVerb: 'Send it to Hugo' },
  add_note: { label: 'Write a note', kind: 'server', icon: StickyNote, commitVerb: 'Save the note' },
  hold: { label: 'Hold, nothing today', kind: 'server', icon: PauseCircle, commitVerb: 'Hold it' },
};

/** WHAT THE BUTTON SAYS TO THE PERSON READING IT.
 *
 *  Hugo, 2026-08-17, signed in as an admin and looking at a card whose primary
 *  button said "Send it to Hugo": "what is it send to Hugo, I am Hugo logged in
 *  as everyone."
 *
 *  He is right that the words were written for one reader. `escalate_hugo`
 *  means "this one is the boss's, put it on his list", which reads correctly to
 *  Pedro and reads as nonsense to the boss. The action does not change, only
 *  the sentence: pressing it as an admin still raises the notification and
 *  still writes the history row, which is what makes the deal visibly HIS
 *  rather than sitting unclaimed in the queue.
 *
 *  Labels for everything else are untouched. */
export function labelFor(action: CockpitAction, isAdmin: boolean): string {
  if (isAdmin && action === 'escalate_hugo') return 'Put it on my list';
  return COCKPIT_ACTIONS[action].label;
}

export function commitVerbFor(action: CockpitAction, isAdmin: boolean): string {
  if (isAdmin && action === 'escalate_hugo') return 'Put it on my list';
  return COCKPIT_ACTIONS[action].commitVerb;
}

/** Every action the AI is allowed to intend, mapped to the button that does it.
 *
 *  Total by test against ACTIONS_BY_STAGE + UNIVERSAL_ACTIONS. `wait_for_engine`
 *  and `flag_mismatch` map to actions a human can actually press: there is
 *  nothing to do about the engine but wait, and a wrong column is Hugo's to
 *  judge, never the machine's to correct. */
export const PRIMARY_BUTTON_FOR: Record<string, CockpitAction> = {
  // Discovery done, evaluating
  confirm_ballpark: 'fetch_ballpark',
  get_the_ballpark: 'fetch_ballpark',
  wait_for_engine: 'hold',
  chase_missing_fact: 'call_branch',
  escalate_hugo: 'escalate_hugo',
  // Ready for call 2
  make_offer_call: 'call_branch',
  chase_email_reply: 'draft_follow_up_email',
  rebook_followup: 'book_followup',
  // Ballpark agreed
  send_offer_email: 'draft_offer_email',
  chase_written_confirmation: 'draft_follow_up_email',
  // Viewing booked
  book_builder: 'book_builder',
  chase_video_for_builder: 'draft_video_email',
  // Offer sent
  reply_with_counter: 'draft_counter_reply',
  chase_the_answer: 'draft_follow_up_email',
  // Offer accepted
  assemble_investor_pack: 'assemble_investor_pack',
  chase_written_acceptance: 'draft_follow_up_email',
  // Sent to investor
  chase_investor: 'draft_follow_up_email',
  // Any stage
  // The ordinary answer to an ordinary question. NOT draft_counter_reply,
  // which is the money reply behind decideCounter and the ceiling fences.
  reply_to_their_email: 'draft_follow_up_email',
  flag_mismatch: 'escalate_hugo',
  hold: 'hold',
  // The brain ordering a door shut ("offer accepted elsewhere, mark the deal
  // dead") points at the button that actually shuts it.
  close_lost: 'mark_lost',
};

/** The button an instruction points at, or a safe one if the action is unknown.
 *  Never throws and never renders a raw code: an unmapped action is a bug the
 *  test catches, and in the meantime the human gets something they can press. */
export function primaryButtonFor(action: string | null | undefined): CockpitAction {
  return PRIMARY_BUTTON_FOR[String(action ?? '')] ?? 'hold';
}

/** The buttons to offer on a deal: the AI's pick first, then everything else
 *  this stage allows, so a human can disagree without leaving the page.
 *  Comparisons is always there, because looking can never be wrong. */
export function buttonsFor(deal: { action: string; allowedActions: string[] }): CockpitAction[] {
  const primary = primaryButtonFor(deal.action);
  const rest = deal.allowedActions
    .map(primaryButtonFor)
    .filter((a) => a !== primary);
  // THE ALWAYS-ON SET. Hugo, 2026-08-16: "I cannot make calls from the
  // cockpit", and he was right: RINGING A BRANCH only appeared when the AI
  // happened to name it, so on a deal where the instruction was "chase the
  // reply" there was no way to pick up the phone without leaving the page.
  //
  // Ringing, writing, looking, moving and noting are the things a person may
  // decide to do about any deal at any moment, whatever the machine thinks.
  // The stress test is what says whether a given one is a good idea, not the
  // absence of the button.
  return [...new Set([
    primary, ...rest,
    'call_branch' as CockpitAction,
    'draft_follow_up_email' as CockpitAction,
    'compare_comps' as CockpitAction,
    'move_stage' as CockpitAction,
    'mark_lost' as CockpitAction,
    'book_followup' as CockpitAction,
    'add_note' as CockpitAction,
  ])];
}

/** The one sentence the gate opens with. Present tense, and it names the thing
 *  that is about to happen rather than describing something already done. */
export function confirmSentence(
  action: CockpitAction,
  deal: { address: string | null; contactName: string | null; branchEmail: string | null; branchPhone: string | null },
): string {
  const where = deal.address ?? 'this property';
  const who = deal.contactName ?? 'the branch';
  if (action === 'mark_lost') {
    return `Move ${where} to Not interested and close the card.`;
  }
  switch (COCKPIT_ACTIONS[action].kind) {
    case 'call':
      return `Ring ${who}${deal.branchPhone ? ` on ${deal.branchPhone}` : ''} about ${where}.`;
    case 'email':
      return `Send this email to ${deal.branchEmail ?? 'the branch'} about ${where}.`;
    case 'reveal':
      return `Show the sold comparables behind the valuation on ${where}.`;
    case 'stage':
      return `Move ${where} to a different stage on the board.`;
    default:
      return `${COCKPIT_ACTIONS[action].label} on ${where}.`;
  }
}
