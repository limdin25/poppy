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

/** The default script for an agent whose profiles.landing_path points at the
 *  dialer with a ?script= of its own, e.g.
 *  '/admin/crm/dialer-pro?script=property_call'.
 *
 *  Why this exists: the sidebar Dialer link, a bookmark, and a redial from
 *  History all open /admin/crm/dialer-pro with no query string, and the page
 *  used to hard-default that to the cold plumber script. Pedro Houses landed
 *  on the dead Google-reviews pitch every time he arrived any way other than
 *  the one deep link (Hugo, 2026-08-10, tenth time: "this business is dead,
 *  he should land on the real estate business"). landing_path already says
 *  which room is HIS; this reads the script off it so every road into the
 *  dialer agrees. NULL landing_path (everyone else) keeps cold_call exactly.
 *
 *  'vsl_close' is deliberately NOT honoured here: that script belongs to one
 *  lead the funnel opened the room for (see scriptForCall below), never to a
 *  person as their standing default. */
export function scriptFromLandingPath(landingPath: string | null | undefined): ScriptKey | null {
  const lp = (landingPath ?? '').trim();
  if (!lp.startsWith('/')) return null;
  const q = lp.indexOf('?');
  if (q === -1) return null;
  if (!lp.slice(0, q).includes('/dialer')) return null;
  const script = new URLSearchParams(lp.slice(q + 1)).get('script');
  return script === 'property_call' ? 'property_call' : null;
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
