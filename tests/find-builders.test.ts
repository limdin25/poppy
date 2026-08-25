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
    // "texted", not "messaged on WhatsApp": text is the lane that opens now,
    // and the same set of numbers (UK mobiles) can receive either.
    expect(lines).toMatch(/1 can be texted, 1 are landlines/);
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

describe('the settings row finally has a screen', () => {
  const SETTINGS = readFileSync('api/admin/builder-settings.ts', 'utf8');
  const LIB = readFileSync('api/lib/builder-outreach.ts', 'utf8');
  const PANEL = readFileSync('src/features/crm/components/builders/OutreachSettingsPanel.tsx', 'utf8');

  it('is admin gated, unlike the rest of the desk', () => {
    expect(SETTINGS).toMatch(/requireAdminAny/);
  });

  it('merges rather than replacing, so query_sid cannot be blanked', () => {
    // query_sid drives the ops-question lane, not builders. A screen that only
    // knows about invite_sid must not wipe it and stop every escalation.
    expect(LIB).toMatch(/const merged: OutreachSettings = \{ \.\.\.current, \.\.\.patch \}/);
  });

  it('stringifies, because platform_settings.value is TEXT not jsonb', () => {
    expect(LIB).toMatch(/value: JSON\.stringify\(merged\)/);
  });

  it('saveOutreachSettings is appended AFTER the order-pinned functions', () => {
    // tests/builder-outreach.test.ts asserts on statement order inside those
    // four. Inserting above any of them moves the anchors.
    const save = LIB.indexOf('export async function saveOutreachSettings');
    for (const fn of ['sendOutreachRow', 'confirmBuilder', 'assignBuilderToProperty', 'sendMorningReminders']) {
      expect(save).toBeGreaterThan(LIB.indexOf(`export async function ${fn}`));
    }
  });

  it('refuses a template id that is not HX-shaped', () => {
    expect(SETTINGS).toMatch(/\^HX\[0-9a-f\]\{32\}\$/);
  });

  it('the panel is light mode and free of banned punctuation', () => {
    expect(PANEL).not.toMatch(/\bdark:/);
    expect(PANEL).not.toMatch(/[–—‘’“”…]/);
    expect(SETTINGS).not.toMatch(/[–—‘’“”…]/);
  });
});

/* ------------------------------------------------------------------------ *
 *  TEXT FIRST (2026-08-25). Hugo: "we have to have SMS first ... from there
 *  he can call, he can SMS ... let's fetch minimum 30 numbers for each
 *  property."
 * ------------------------------------------------------------------------ */

describe('text is the lane that opens, and WhatsApp is still there', () => {
  const LIB = readFileSync('api/lib/builder-outreach.ts', 'utf8');
  const DIALOG = readFileSync('src/features/crm/components/builders/SendReviewDialog.tsx', 'utf8');

  it('the ONLY gate a text skips is the one about a WhatsApp template', () => {
    // The money gates (floor, discount, proven deal) and no_viewing_time are
    // facts about the HOUSE and apply to both channels. template_pending is a
    // fact about Meta. Skipping any other one here would let a text drive
    // somebody to a house we cannot buy.
    const fn = LIB.slice(LIB.indexOf('export function blockedReasonForChannel'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/reason === 'template_pending'/);
    expect(body).not.toMatch(/floor_above_ceiling|below_discount_rule|no_viewing_time/);
  });

  it('the text send re-reads the floor rather than trusting the row', () => {
    const fn = LIB.slice(LIB.indexOf('export async function sendOutreachSms'));
    const gate = fn.indexOf('await floorRefusalFor(');
    const wire = fn.indexOf('api.twilio.com/2010-04-01');
    expect(gate).toBeGreaterThan(-1);
    expect(wire).toBeGreaterThan(gate);
  });

  it('the message row goes in BEFORE the wire, the ai-reply double-send rule', () => {
    const fn = LIB.slice(LIB.indexOf('export async function sendOutreachSms'));
    expect(fn.indexOf("status: 'sending'")).toBeLessThan(fn.indexOf('api.twilio.com/2010-04-01'));
  });

  it('rewrites the body to GSM-7 before the wire, or a curly quote triples the cost', () => {
    const fn = LIB.slice(LIB.indexOf('export async function sendOutreachSms'));
    expect(fn.indexOf('toGsm7(')).toBeLessThan(fn.indexOf('api.twilio.com/2010-04-01'));
    expect(fn).toMatch(/smsSegments\(body\) > MAX_SMS_SEGMENTS/);
  });

  it('the do-not-text tag blocks a text exactly like it blocks a WhatsApp', () => {
    const fn = LIB.slice(LIB.indexOf('export async function sendOutreachSms'));
    expect(fn).toMatch(/'do-not-text'/);
  });

  it('sends from a UK number only: a US line cannot text a UK mobile at all', () => {
    // Twilio 21612, learned 2026-07-16, and it fails in a way that reads as a
    // successful send.
    const fn = LIB.slice(LIB.indexOf('export async function resolveSmsFrom'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/startsWith\('\+44'\)/);
  });

  it('never moves sent_at forward, or a second text re-counts against the cap', () => {
    expect(LIB).toMatch(/async function firstContactStamp/);
    const fn = LIB.slice(LIB.indexOf('async function firstContactStamp'));
    expect(fn).toMatch(/\?\.sent_at \? \{\} : \{ sent_at: now \}/);
  });

  it('the two channels keep their own stamps, so the WhatsApp tag survives a text', () => {
    const fn = LIB.slice(LIB.indexOf('export async function sendOutreachSms'));
    const update = fn.slice(fn.indexOf("status: 'sent',"));
    expect(update).toMatch(/sms_sent_at: now/);
    // No ASSIGNMENT to it. The comment above the block explains why, and the
    // comment is allowed to name the column it is explaining.
    expect(update).not.toMatch(/whatsapp_sent_at:/);
  });

  it('everything below saveOutreachSettings is appended, never inserted', () => {
    // tests/builder-outreach.test.ts reads this file as source text and pins
    // statement order inside four functions. Append only.
    const anchor = LIB.indexOf('export async function saveOutreachSettings');
    for (const fn of ['sendOutreachSms', 'resolveSmsFrom', 'recordCallOutcome']) {
      expect(LIB.indexOf(`function ${fn}`)).toBeGreaterThan(anchor);
    }
  });

  it('the dialog opens on text and still offers the template lane', () => {
    expect(DIALOG).toMatch(/useState<SendChannel>\('sms'\)/);
    expect(DIALOG).toMatch(/\['sms', 'Text'\], \['whatsapp', 'WhatsApp'\]/);
    expect(DIALOG).toMatch(/isApproved/);
  });

  it('the dialog costs the text with the same rules the wire uses', () => {
    expect(DIALOG).toMatch(/from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/api\/lib\/sms-charset'/);
  });

  it('the route asks the lib to send, never Twilio itself', () => {
    expect(ROUTE).toMatch(/sendOutreachSms\(/);
    expect(ROUTE).not.toMatch(/api\.twilio\.com/);
  });
});

describe('ringing a builder, and what he said', () => {
  const LIB = readFileSync('api/lib/builder-outreach.ts', 'utf8');
  const TABLE = readFileSync('src/features/crm/components/builders/BuilderTable.tsx', 'utf8');

  it('a landline gets a contact record too, or it can never be rung', () => {
    // draftOutreachForProperty filters the roster to UK mobiles because
    // WhatsApp cannot reach a landline. Ringing one is the whole job.
    const start = ROUTE.indexOf('async function prepareBuilder');
    const fn = ROUTE.slice(start, ROUTE.indexOf('async function saveCallOutcome'));
    expect(fn).toMatch(/ensureBuilderContact\(/);
    expect(fn).not.toMatch(/isUkMobile/);
  });

  it('the contact is owned by whoever pressed the button', () => {
    // An ownerless contact is one no agent's RLS lets them read, so the builder
    // would be invisible in the inbox of the person who rang him.
    const fn = ROUTE.slice(ROUTE.indexOf('async function prepareBuilder'));
    expect(fn).toMatch(/ensureBuilderContact\(\s*\n?\s*sb, \{ id: b\.id, name: b\.name, phone: b\.phone \}, who\.id,/);
  });

  it('the call goes through the CRM softphone, not a tel: link', () => {
    // A tel: link writes no wk_calls row, records nothing, and ignores the
    // spend limit.
    expect(PAGE).toMatch(/useActiveCallCtx/);
    expect(PAGE).toMatch(/startCall\(contactId, b\.phone, b\.name, \{ openRoom: false \}\)/);
    expect(PAGE).not.toMatch(/href=\{`tel:/);
  });

  it('the contact record is made BEFORE the call, or it has nowhere to write itself', () => {
    const fn = PAGE.slice(PAGE.indexOf('const ringBuilder'));
    expect(fn.indexOf("action: 'prepare'")).toBeLessThan(fn.indexOf('await startCall('));
  });

  it('an outcome is one of the listed ones, never free text', () => {
    const fn = LIB.slice(LIB.indexOf('export async function recordCallOutcome'));
    expect(fn.indexOf('isCallOutcome(outcome)')).toBeLessThan(fn.indexOf('call_outcome: outcome'));
  });

  it('the outcome never changes the row status', () => {
    // "He says he is coming" and "we have told him where to go" are different
    // facts, and collapsing them is how a house ends up with a builder who was
    // never sent an address.
    const fn = LIB.slice(LIB.indexOf('export async function recordCallOutcome'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).not.toMatch(/status:/);
  });

  it('the screen and the server offer the same outcomes', () => {
    const ids = (src: string) => (src.match(/id: '([a-z_]+)', label:/g) ?? []).sort().join('|');
    expect(ids(TABLE)).toBe(ids(LIB));
    expect(ids(TABLE)).not.toBe('');
  });

  it('a DRAFTED builder can still be ticked', () => {
    // A draft is a row nobody has written to. Treating it as sent is why
    // nobody could select a builder once the five-minute sweep had run.
    expect(TABLE).toMatch(/const ALREADY_SENT = new Set\(\['sent', 'replied', 'confirmed', 'declined', 'skipped'\]\)/);
    expect(TABLE).not.toMatch(/b\.isMobile && !b\.status/);
  });

  it('the table is light mode and free of banned punctuation', () => {
    expect(TABLE).not.toMatch(/\bdark:/);
    expect(TABLE).not.toMatch(/[–—‘’“”…]/);
  });
});

describe('thirty builders for a house, not eight', () => {
  it('the desk asks for the target, the crons still ask for one', () => {
    // minCount defaults to 1, which is the stop-at-the-first-hit behaviour the
    // crons have always had, so this cannot quietly raise their bill.
    expect(SCRAPE).toMatch(/const want = Math\.max\(1, opts\.minCount \?\? 1\)/);
    expect(ROUTE).toMatch(/minCount: TARGET_BUILDERS/);
  });

  it('paging is opt-in, so the five-minute cron costs what it always cost', () => {
    expect(SCRAPE).toMatch(/opts\.pages \?\? 1/);
    expect(ROUTE).toMatch(/pages: MAX_NEARBY_PAGES/);
  });

  it('the widening ladder ACCUMULATES rather than restarting at each ring', () => {
    const fn = SCRAPE.slice(SCRAPE.indexOf('export async function scrapeBuildersWidening'));
    expect(fn).toMatch(/byPhone\.set\(b\.phoneE164, b\)/);
    expect(fn).toMatch(/if \(byPhone\.size >= want\) break/);
  });

  it('the radius reported is the one that last found a NEW name', () => {
    // A wider ring re-finds everything the narrow one found, so testing
    // found.length would report "searched 40km" against a house whose builders
    // all came from 10km.
    const fn = SCRAPE.slice(SCRAPE.indexOf('export async function scrapeBuildersWidening'));
    expect(fn).toMatch(/if \(byPhone\.size > before\) radiusM = r/);
  });

  it('a duplicate place across pages is not paid for twice', () => {
    expect(SCRAPE).toMatch(/seenPlace\.has\(r\.place_id!\)/);
  });

  it('detail lookups run in batches, or the route times out before it answers', () => {
    // Sixty sequential lookups is about twelve seconds per radius, three radii
    // is most of the sixty-second budget, and a timeout looks to Pedro exactly
    // like an area with no builders in it.
    expect(SCRAPE).toMatch(/const CONCURRENCY = 8/);
    expect(SCRAPE).toMatch(/await Promise\.all\(chunk\.map\(/);
  });

  it('stops paying the moment it has enough', () => {
    expect(SCRAPE).toMatch(/i < shortlist\.length && out\.length < cap/);
  });

  it('says out loud when an area simply has fewer than the target', () => {
    const lines = scrapeLogLines({
      outcode: 'SK17', tried: [10_000, 20_000, 40_000], radiusM: 40_000,
      scraped: [{ name: 'A', phoneE164: '+447000000001', address: '', placeId: 'p', rating: null, reviews: null }],
      plan: { inserts: [], extendIds: [] }, mobiles: 1, target: 30,
    }).map((l) => l.text).join(' ');
    expect(lines).toMatch(/short of the 30/);
    expect(lines).toMatch(/whole market rather than a short search/);
  });

  it('says nothing about a target when none was asked for', () => {
    const lines = scrapeLogLines({
      outcode: 'SK17', tried: [10_000], radiusM: 10_000,
      scraped: [{ name: 'A', phoneE164: '+447000000001', address: '', placeId: 'p', rating: null, reviews: null }],
      plan: { inserts: [], extendIds: [] }, mobiles: 1,
    }).map((l) => l.text).join(' ');
    expect(lines).not.toMatch(/short of/);
  });
});
