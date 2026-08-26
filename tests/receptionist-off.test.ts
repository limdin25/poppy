// The AI receptionist is OFF, and so are its automatic texts.
//
// Hugo, 2026-08-26, twice and urgently: "we need to turn off the AI receptionist
// ASAP and also the text, very very important." And then: "make a note
// everyone, turn off all text automation and receptionist."
//
// WHAT IT DID. Every inbound call to the demo business fired two automatic texts
// at whoever had rung: a "Thanks for calling! Quick recap, this is how I'll send
// you every lead..." message, and then a sales pitch, "P.S. If you liked how
// that felt, I can set Elsie up to answer YOUR calls too."
//
// WHO IT DID IT TO. Jordan Lee of JL Brickwork, a builder we had already booked
// onto a viewing, rang the number our own text told him to ring. It reached the
// Retell receptionist, and he was sent both messages with his own mobile quoted
// back at him as a sales lead. To Pedro at 15:40:
//
//   "I tried phoning your number back and it sounded like a dodgy AI thing and
//    I'm getting loads of weird text software... that just led us to believe
//    it's not genuine."
//
// He nearly walked off the viewing. Twenty six of those pitches had already gone
// to eight people who rang that line.
//
// THERE ARE TWO HALVES AND BOTH ARE OFF:
//   1. the CODE half, this file: no business id may receive the auto texts.
//   2. the PHONE half, done on Twilio the same day: all three numbers were
//      removed from the Retell SIP trunk (TK6634fb175ebebc312bb6683327cb0ee6)
//      and repointed at the CRM's own inbound handler, so no number reaches the
//      receptionist at all. That half cannot be tested from here, so it is
//      written down instead. If you re-arm one half you have re-armed nothing;
//      check the trunk before you believe the receptionist is back.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const RETELL = readFileSync('api/webhooks/retell.ts', 'utf8');

describe('the AI receptionist sends nobody an automatic text', () => {
  it('has an EMPTY list of businesses that get the recap and the pitch', () => {
    expect(RETELL).toMatch(/const CALLER_RECAP_BUSINESS_IDS = new Set<string>\(\);/);
  });

  it('carries no business id in that set, however it is written', () => {
    const line = RETELL.slice(
      RETELL.indexOf('const CALLER_RECAP_BUSINESS_IDS'),
      RETELL.indexOf(';', RETELL.indexOf('const CALLER_RECAP_BUSINESS_IDS')),
    );
    // A uuid anywhere on that line means somebody put a business back in.
    expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('still explains why, so nobody re-arms it without reading the reason', () => {
    expect(RETELL).toMatch(/turn off all text automation and receptionist/i);
    expect(RETELL).toMatch(/dodgy AI thing/);
  });
});
