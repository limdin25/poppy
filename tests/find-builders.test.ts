// The Find builders desk: the rules that must not quietly rot.
//
// These are mostly source pins rather than behaviour tests, the same shape as
// tests/builder-outreach.test.ts, because the things that go wrong here are
// orderings and gates rather than arithmetic: a radius stamped after the search
// instead of before, a template written after the send instead of before, a
// second road onto a house that skips the floor gate.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scrapeLogLines } from '../api/lib/builder-scrape';

const ROUTE = readFileSync('api/crm/find-builders.ts', 'utf8');
const PAGE = readFileSync('src/features/crm/pages/FindBuildersPage.tsx', 'utf8');
const SCRAPE = readFileSync('api/lib/builder-scrape.ts', 'utf8');

describe('who is allowed in', () => {
  it('uses the agent-or-admin gate, not the admin_users table', () => {
    // The whole reason this route exists: every builder route before it was
    // admin-gated, so the cockpit panel was silently blank for Pedro.
    expect(ROUTE).toMatch(/wk_is_agent_or_admin/);
    expect(ROUTE).not.toMatch(/from\('admin_users'\)/);
  });

  it('is a Node route, because sending needs Buffer', () => {
    expect(ROUTE).toMatch(/IncomingMessage/);
    expect(ROUTE).toMatch(/maxDuration/);
    expect(ROUTE).not.toMatch(/runtime: 'edge'/);
  });
});

describe('every road onto a house passes the same gate', () => {
  it('checks the vendor floor before sending anything', () => {
    // Inside sendInvites, not across the whole file: the imports at the top
    // would otherwise decide the ordering rather than the code.
    const body = ROUTE.slice(ROUTE.indexOf('async function sendInvites'));
    const gate = body.indexOf('await floorRefusalFor(');
    const send = body.indexOf('await sendOutreachRow(');
    expect(gate).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(send);
  });

  it('never writes assigned_builder_id itself', () => {
    // assignBuilderToProperty is the only road, because it carries the floor
    // gate and the board move with it. Reading the column is fine; the ban is
    // on updating it, which is what an .update({ ... }) payload would show.
    expect(ROUTE).not.toMatch(/update\(\{[^}]*assigned_builder_id/s);
  });

  it('never talks to Twilio directly', () => {
    expect(ROUTE).not.toMatch(/api\.twilio\.com/);
  });
});

describe('the search cannot become a runaway spend', () => {
  it('stamps the radius and the scraped-at BEFORE calling Google', () => {
    const stamp = ROUTE.indexOf('builder_scraped_at: new Date()');
    const search = ROUTE.indexOf('await scrapeBuildersWidening');
    expect(stamp).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(search);
  });

  it('keeps the once-ever guard rather than deleting it', () => {
    expect(ROUTE).toMatch(/already been searched/);
  });

  it('widens along the shared ladder, never a hand-typed radius', () => {
    expect(ROUTE).toMatch(/nextRadiusM\(/);
    expect(ROUTE).toMatch(/WIDENING_RADII_M/);
  });
});

describe('the house number', () => {
  it('writes viewing_address and never address', () => {
    // draft-guards and branch-email-match both read the street as
    // address.split(',')[0], so a leading "10, " breaks both.
    expect(ROUTE).toMatch(/update\(\{ viewing_address: full/);
    // The audit row is allowed to record the composed address; the house row
    // is not allowed to have its street overwritten by it.
    expect(ROUTE).not.toMatch(/update\(\{[^}]*\baddress: full/s);
  });

  it('composes with the same function the overnight brain uses', () => {
    expect(ROUTE).toMatch(/addressFromAnswer\(/);
  });

  it('hands the answer to the open question so every builder is told', () => {
    expect(ROUTE).toMatch(/builder_needs_address/);
    expect(ROUTE).toMatch(/answerQuery\(/);
  });

  it('never claims builders were told when no question was open', () => {
    expect(ROUTE).toMatch(/waiting\s*\?/);
    expect(ROUTE).toMatch(/Every invite from now on carries it/);
  });
});

describe('the send', () => {
  it('writes the chosen template onto the row before sending it', () => {
    const write = ROUTE.indexOf('content_sid: contentSid');
    const send = ROUTE.indexOf('await sendOutreachRow(sb, row.id)');
    expect(write).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(write);
  });

  it('only ever touches a draft row', () => {
    expect(ROUTE).toMatch(/\.in\('status', \['draft', 'approved'\]\)/);
  });

  it('re-derives the block with the chosen template substituted', () => {
    // Clearing blocked_reason outright would punch through the floor and the
    // discount rules too.
    expect(ROUTE).toMatch(/blockedReasonFor\(prop, \{ \.\.\.settings, invite_sid: contentSid \}\)/);
  });

  it('materialises rows first, or a freshly scraped builder has nothing to send', () => {
    const draft = ROUTE.indexOf('draftOutreachForProperty(sb, prop, settings)');
    const send = ROUTE.indexOf('await sendOutreachRow(sb, row.id)');
    expect(draft).toBeGreaterThan(-1);
    expect(draft).toBeLessThan(send);
  });

  it('enforces the daily cap, which the manual path never did', () => {
    expect(ROUTE).toMatch(/settings\.daily_cap - already/);
  });

  it('refuses anything that is not an approved template shape', () => {
    expect(ROUTE).toMatch(/\^HX\[0-9a-f\]\{32\}\$/);
  });
});

describe('the page', () => {
  it('is light mode only', () => {
    expect(PAGE).not.toMatch(/\bdark:/);
  });

  it('reads the response as text first, because a scrape can time out', () => {
    expect(PAGE).toMatch(/await res\.text\(\)/);
  });

  it('cannot send without the review dialog', () => {
    // The dialog is the only thing between a press and a cold WhatsApp.
    expect(PAGE).toMatch(/setReviewOpen\(true\)/);
    expect(PAGE).toMatch(/<SendReviewDialog/);
  });
});

describe('no banned punctuation anywhere in the new screens', () => {
  const BANNED = /[–—‘’“”…]/;
  const files = [
    'api/crm/find-builders.ts',
    'src/features/crm/pages/FindBuildersPage.tsx',
    'src/features/crm/components/builders/PropertyPicker.tsx',
    'src/features/crm/components/builders/HouseNumberBar.tsx',
    'src/features/crm/components/builders/BuilderTable.tsx',
    'src/features/crm/components/builders/SendReviewDialog.tsx',
  ];
  for (const f of files) {
    it(f, () => {
      expect(readFileSync(f, 'utf8')).not.toMatch(BANNED);
    });
  }
});

describe('scrapeLogLines says what actually happened', () => {
  const b = (phone: string) => ({
    placeId: phone, name: 'A Builder', address: 'somewhere',
    phoneE164: phone, reviews: 5, rating: 4.5,
  });

  it('separates the ones we can message from the ones we can only ring', () => {
    const lines = scrapeLogLines({
      outcode: 'B44', tried: [10000], radiusM: 10000,
      scraped: [b('+447000000001'), b('+441204000000')],
      plan: { inserts: [b('+447000000001')], extendIds: [] },
      mobiles: 1,
    }).map((l) => l.text).join(' ');
    expect(lines).toMatch(/1 can be messaged on WhatsApp, 1 are landlines/);
  });

  it('reports coverage extensions separately from new builders', () => {
    // Extending is how a builder 25 miles away quietly becomes local to an
    // outcode forever, so it is said out loud rather than hidden.
    const lines = scrapeLogLines({
      outcode: 'B44', tried: [10000], radiusM: 10000,
      scraped: [b('+447000000001')],
      plan: { inserts: [], extendIds: ['abc'] },
      mobiles: 1,
    }).map((l) => l.text).join(' ');
    expect(lines).toMatch(/now also count as covering B44/);
  });

  it('says plainly when nobody was found at any radius', () => {
    const lines = scrapeLogLines({
      outcode: 'ZZ99', tried: [10000, 20000, 40000], radiusM: null,
      scraped: [], plan: { inserts: [], extendIds: [] }, mobiles: 0,
    }).map((l) => l.text).join(' ');
    expect(lines).toMatch(/found nobody/);
  });
});

describe('the manual press can reach further than the cron', () => {
  it('maxDetailCalls is an option, defaulting to the cron budget', () => {
    expect(SCRAPE).toMatch(/opts\.maxDetailCalls \?\? MAX_DETAIL_CALLS/);
  });
});
