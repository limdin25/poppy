import { describe, it, expect } from 'vitest';
import { nonGsm7, smsSegments } from '../api/lib/sms-charset';
import { ladderCopy, LADDER_STAGES, type LadderContext } from '../src/core/site-demo/ladder';
import { SITE_DEMO_SMS } from '../src/core/site-demo/messages';

// Hugo's standing rule, machine enforced rather than remembered.
//
// It is not taste. A text is GSM-7, and therefore 160 characters a segment,
// only if EVERY character is in the GSM 03.38 table. One long dash or one
// curly apostrophe flips the whole message to UCS-2 and the segment drops to
// 70, so a two part text quietly becomes a three part text on every send, to
// every lead, forever.

const ctx: LadderContext = {
  now: new Date('2026-07-28T09:00:00.000Z'),
  ownerFirst: 'Matthew',
  businessName: 'MJR Plumbing',
  url: 'https://heyelsie.com/s/mjr-plumbing',
  demoNumber: '07576 558278',
  maxOutboundCalls: 2,
};

const everyBody = [
  ...LADDER_STAGES.map((s) => ({ what: `ladder:${s}`, body: ladderCopy(s, ctx) })),
  ...Object.entries(SITE_DEMO_SMS).map(([k, fn]) => ({
    what: `message:${k}`,
    body: fn({
      ownerFirst: 'Matthew',
      businessName: 'MJR Plumbing',
      url: 'https://heyelsie.com/s/mjr-plumbing',
      demoNumber: '07576 558278',
      checkoutUrl: 'https://heyelsie.com/s/mjr-plumbing',
    }),
  })),
];

describe('every message a lead can receive', () => {
  it.each(everyBody)('$what is pure GSM-7', ({ body }) => {
    expect(nonGsm7(body)).toEqual([]);
  });

  it.each(everyBody)('$what contains no long dash, curly quote or ellipsis', ({ body }) => {
    expect(body).not.toMatch(/[‐-―‘’“”…]/);
  });

  // Not a hard failure at 2, but a body that has quietly grown to 4 segments
  // is a 100 percent cost increase nobody asked for.
  it.each(everyBody)('$what costs no more than 2 segments', ({ body }) => {
    expect({ what: body.slice(0, 40), segments: smsSegments(body) }).toEqual({
      what: body.slice(0, 40),
      segments: expect.any(Number),
    });
    expect(smsSegments(body)).toBeLessThanOrEqual(2);
  });

  it.each(everyBody)('$what never leaks an unfilled token', ({ body }) => {
    expect(body).not.toMatch(/\[[a-z_]+\]|\{\{|\}\}|undefined|null/);
  });
});

describe('the greeting degrades without a name', () => {
  it.each(Object.entries(SITE_DEMO_SMS))('%s survives an unknown owner', (_k, fn) => {
    const body = fn({
      ownerFirst: null,
      businessName: 'MJR Plumbing',
      url: 'https://heyelsie.com/s/mjr-plumbing',
      demoNumber: '07576 558278',
      checkoutUrl: 'https://heyelsie.com/s/mjr-plumbing',
    });
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
    expect(nonGsm7(body)).toEqual([]);
  });
});
