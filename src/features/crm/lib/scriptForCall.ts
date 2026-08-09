// Which script belongs on screen for the lead currently on the phone.
//
// THE BUG THIS EXISTS TO PREVENT (caught in pre-deploy review, 2026-07-31):
// the dialer window remembers "the video funnel opened me with the close
// script" for as long as it stays open, but the call room does NOT stay on one
// lead. "Next call" and "Dial next" pull the next lead straight off the agent's
// normal cold campaign queue. So without this rule, Pedro clicks Call to close
// on a lead who watched the video, finishes that call, hits Next call, and
// reads "I sent you a short video, I saw you'd watched it, what did you make of
// it?" to a plumber who has never heard of us. Every following lead in that
// session gets it too, until he closes the window.
//
// The close script belongs to ONE lead: the one the funnel button opened the
// room for. Everyone after them is a normal cold dial.
//
// Pure and separate from the component so this is testable for real
// (tests/script-for-call.test.ts) rather than only reachable by placing a
// live phone call to a real plumber.

import type { ScriptKey } from '../components/live-call/DialerScriptPane';

export interface ScriptForCallArgs {
  /** What the room was OPENED with — 'vsl_close' only from the video funnel. */
  openedWith: ScriptKey;
  /** The lead the funnel opened this room to close. Null when the room was
   *  opened without a specific lead (e.g. the bare ?script= URL). */
  openedForContactId: string | null;
  /** Who is actually on the phone right now. Null when idle/between calls. */
  currentLeadContactId: string | null;
}

export function scriptForCall({
  openedWith,
  openedForContactId,
  currentLeadContactId,
}: ScriptForCallArgs): ScriptKey {
  // The property call belongs to the CAMPAIGN, not to one lead. Every lead in
  // the Houses queue is an estate agency, so unlike the close script there is
  // no "the next lead is a stranger" problem to guard against: Next call pulls
  // another estate agency and the same script is still the right one.
  if (openedWith === 'property_call') return 'property_call';

  // A room opened normally is always the cold script, whoever is on the phone.
  if (openedWith !== 'vsl_close') return 'cold_call';
  // Idle, or still on the lead the funnel sent us to close: close script.
  // Idle counts because the agent reads the opener BEFORE the call connects.
  if (currentLeadContactId == null) return 'vsl_close';
  return currentLeadContactId === openedForContactId ? 'vsl_close' : 'cold_call';
}
