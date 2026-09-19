// Which desk an inbound call belongs to, and whether it may ring.
//
// Hugo, 2026-09-18, on the Auction desk: "no communication comes even if
// someone from the past contacts him, should go to the right CRM, the older
// one". Asked what an old contact's PHONE CALL should do while Pedro is on
// Auction, he chose "do not ring at all": it goes to voicemail and waits on
// the Houses callback strip.
//
// The rule, in one sentence: a known contact belongs to its own desk and only
// rings on that desk; a caller nobody knows belongs to whichever desk the
// agent is on, and rings.
//
// It is symmetric on purpose. An auctioneer ringing back while Pedro is on
// Houses would open on a screen that cannot show the lot, so it waits on the
// Auction strip the same way.
//
// MIRRORED VERBATIM in supabase/functions/wk-voice-twiml-incoming/index.ts,
// because Deno cannot import from api/. tests/auction-inbound-routing.test.ts
// fails if the two drift.

export type Desk = 'houses' | 'auction';

export interface DeskRoute {
  /** The desk the call is filed under. */
  desk: Desk;
  /** False = send straight to voicemail, do not ring the agent's browser. */
  ring: boolean;
}

export function inboundDeskRoute(contactDesk: string | null | undefined, agentDesk: string | null | undefined): DeskRoute {
  const onDesk: Desk = agentDesk === 'auction' ? 'auction' : 'houses';
  if (!contactDesk) return { desk: onDesk, ring: true };
  const theirs: Desk = contactDesk === 'auction' ? 'auction' : 'houses';
  return { desk: theirs, ring: theirs === onDesk };
}
