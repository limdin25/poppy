import { describe, it, expect } from 'vitest';
import {
  isThreadUnread, sortInboxRows, inboxSections,
  isAwaitingReply, waitingHours, sortWaitingRows,
} from '../src/features/crm/lib/inboxOrder';

// Hugo, 2026-08-06: "just make a normal inbox, last communication is always
// on top... unless I press the filters". This superseded his 2026-07-28
// unread-on-top rule: the default order is pinned then pure recency, and the
// UNREAD pill is where repliers-first lives now. These tests pin what counts
// as unread (unchanged, it drives the badge and the pill) and the new order.

const t = (iso: string) => iso;

describe('isThreadUnread', () => {
  it('is unread when the lead replied and we never answered', () => {
    expect(isThreadUnread({ lastInboundAt: t('2026-07-28T10:08:00Z'), lastOutboundAt: t('2026-07-28T10:04:00Z') })).toBe(true);
  });

  it('is read once we sent something after their message', () => {
    expect(isThreadUnread({ lastInboundAt: t('2026-07-28T10:08:00Z'), lastOutboundAt: t('2026-07-28T10:12:00Z') })).toBe(false);
  });

  it('is read once the agent opened the thread, even with no reply sent', () => {
    expect(
      isThreadUnread(
        { lastInboundAt: t('2026-07-28T10:08:00Z'), lastOutboundAt: t('2026-07-28T10:04:00Z') },
        t('2026-07-28T10:30:00Z'),
      ),
    ).toBe(false); // opened at 10:30, after the 10:08 reply landed
  });

  it('goes unread again when a NEWER message arrives after the last open', () => {
    expect(
      isThreadUnread(
        { lastInboundAt: t('2026-07-28T11:00:00Z'), lastOutboundAt: t('2026-07-28T10:04:00Z') },
        t('2026-07-28T10:30:00Z'),
      ),
    ).toBe(true);
  });

  it('a pure blast row (outbound only, no reply) is never unread', () => {
    // This is the whole reason the sort was wrong: 100 of these.
    expect(isThreadUnread({ lastInboundAt: null, lastOutboundAt: t('2026-07-28T10:04:00Z') })).toBe(false);
  });

  it('survives a missing or unparseable timestamp instead of throwing', () => {
    expect(isThreadUnread({})).toBe(false);
    expect(isThreadUnread({ lastInboundAt: 'not a date' })).toBe(false);
  });
});

describe('sortInboxRows', () => {
  const row = (id: string, over: Partial<Parameters<typeof sortInboxRows>[0][number]> = {}) => ({
    id,
    unread: false,
    pinnedAt: null as string | null,
    lastMessageAt: '2026-07-28T09:00:00Z',
    ...over,
  });

  // The 2026-08-06 rule: a normal inbox. The newest conversation wins even
  // when an older one is unread; unread is a badge and a pill, not a hoist.
  it('keeps the newest conversation on top even when an older one is unread', () => {
    const out = sortInboxRows([
      row('blast', { lastMessageAt: '2026-07-28T10:04:00Z' }),
      row('reply', { unread: true, lastMessageAt: '2026-07-28T08:00:00Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['blast', 'reply']);
  });

  it('holds pinned rows above everything, newest pin first', () => {
    const out = sortInboxRows([
      row('unread', { unread: true, lastMessageAt: '2026-07-28T12:00:00Z' }),
      row('pin-old', { pinnedAt: '2026-07-01T00:00:00Z', lastMessageAt: '2026-01-01T00:00:00Z' }),
      row('pin-new', { pinnedAt: '2026-07-28T00:00:00Z', lastMessageAt: '2026-01-01T00:00:00Z' }),
      row('quiet', { lastMessageAt: '2026-07-28T11:00:00Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['pin-new', 'pin-old', 'unread', 'quiet']);
  });

  it('orders everything unpinned by recency alone, unread mixed in', () => {
    const out = sortInboxRows([
      row('older', { lastMessageAt: '2026-07-26T09:00:00Z' }),
      row('newer', { lastMessageAt: '2026-07-28T09:00:00Z' }),
      row('unread-older', { unread: true, lastMessageAt: '2026-07-20T09:00:00Z' }),
      row('unread-newer', { unread: true, lastMessageAt: '2026-07-27T09:00:00Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['newer', 'unread-newer', 'older', 'unread-older']);
  });

  it('does not mutate the array it was given', () => {
    const input = [row('a', { lastMessageAt: '2026-07-01T00:00:00Z' }), row('b', { unread: true })];
    const before = input.map((r) => r.id);
    sortInboxRows(input);
    expect(input.map((r) => r.id)).toEqual(before);
  });

  it('handles a null lastMessageAt without reordering by NaN', () => {
    const out = sortInboxRows([row('null-ts', { lastMessageAt: null }), row('dated')]);
    expect(out.map((r) => r.id)).toEqual(['dated', 'null-ts']);
  });
});

// Hugo, 2026-08-02: the bands were invisible, so the order read as random.
// inboxSections regroups the SORTED list under labels without moving a row.
describe('inboxSections', () => {
  const row = (id: string, over: Partial<Parameters<typeof sortInboxRows>[0][number]> = {}) => ({
    id,
    unread: false,
    pinnedAt: null as string | null,
    lastMessageAt: '2026-08-02T09:00:00Z',
    ...over,
  });

  // Since 2026-08-06 there are only two possible bands: pinned and the rest.
  // An unread row is badged where it sits, never pulled into its own section.
  it('groups a mixed list into pinned and rest only', () => {
    const sorted = sortInboxRows([
      row('quiet', { lastMessageAt: '2026-08-02T08:00:00Z' }),
      row('pinned', { pinnedAt: '2026-08-01T00:00:00Z' }),
      row('reply', { unread: true, lastMessageAt: '2026-08-02T10:00:00Z' }),
    ]);
    const sections = inboxSections(sorted);
    expect(sections.map((s) => s.key)).toEqual(['pinned', 'rest']);
    expect(sections.map((s) => s.rows.map((r) => r.id))).toEqual([['pinned'], ['reply', 'quiet']]);
  });

  it('omits empty bands, an all-quiet list is one headerless section', () => {
    const sections = inboxSections([row('a'), row('b')]);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('rest');
  });

  it('concatenating the sections reproduces the input order exactly', () => {
    const sorted = sortInboxRows([
      row('u1', { unread: true, lastMessageAt: '2026-08-02T10:00:00Z' }),
      row('u2', { unread: true, lastMessageAt: '2026-08-02T08:00:00Z' }),
      row('p1', { pinnedAt: '2026-08-01T00:00:00Z' }),
      row('r1', { lastMessageAt: '2026-08-02T09:00:00Z' }),
    ]);
    const flat = inboxSections(sorted).flatMap((s) => s.rows.map((r) => r.id));
    expect(flat).toEqual(sorted.map((r) => r.id));
  });

  it('a pinned row that is also unread stays in the pinned band (never counted twice)', () => {
    const sections = inboxSections(sortInboxRows([
      row('both', { pinnedAt: '2026-08-01T00:00:00Z', unread: true }),
      row('plain'),
    ]));
    expect(sections.map((s) => s.key)).toEqual(['pinned', 'rest']);
    expect(sections[0].rows.map((r) => r.id)).toEqual(['both']);
  });

  it('an all-rest list (e.g. unpinned call rows) is a single headerless section', () => {
    const sections = inboxSections([row('call1'), row('call2'), row('call3')]);
    expect(sections).toHaveLength(1);
    expect(sections[0].rows).toHaveLength(3);
  });

  it('a pinned CALL row still forms a pinned band, pin state is per contact', () => {
    // Pins live in wk_inbox_state keyed by contact, so a contact pinned in the
    // message view is pinned under the Calls filter too. Call rows are never
    // unread (stamps hardcoded null) but they absolutely can be pinned.
    const sections = inboxSections(sortInboxRows([
      row('call-pinned', { pinnedAt: '2026-08-01T00:00:00Z' }),
      row('call-plain'),
    ]));
    expect(sections.map((s) => s.key)).toEqual(['pinned', 'rest']);
    expect(sections[0].rows.map((r) => r.id)).toEqual(['call-pinned']);
  });
});

// ===========================================================================
// WAITING ON US. THE FORTY-ONE HOURS THAT COST A VIEWING.
// ===========================================================================
//
// 2026-08-19, real timeline off wk_sms_messages:
//   14:02  we send Lunar Builders the WhatsApp viewing invite
//   14:04  Shakeel: "Yes, I'd be happy to come out... Could you please send me
//          the full address and a little more information on the works?"
//   ~14:20 somebody opens the thread. Nothing is sent.
//   07:01 on the 21st, we send a confirmation that answers neither question
//   07:44 "unfortunately I won't be able to make it today as I needed the full
//          address in advance and didn't receive it in time"
//
// The inbox had stopped showing it as needing a reply at 14:20, because a
// CLICK stamps lastReadAt. These tests are the fence.
describe('the Lunar Builders 41 hours (2026-08-19)', () => {
  const invite = '2026-08-19T14:02:00Z';
  const question = '2026-08-19T14:04:00Z';
  const glanced = '2026-08-19T14:20:00Z';
  const now = new Date('2026-08-21T07:00:00Z');
  const row = { lastInboundAt: question, lastOutboundAt: invite };

  it('THE INCIDENT: the old rule called it read, the new rule calls it waiting', () => {
    expect(isThreadUnread(row, glanced)).toBe(false);   // what shipped
    expect(isAwaitingReply(row, now)).toBe(true);       // what should have
  });

  it('says 41 hours, not "a while"', () => {
    expect(Math.round(waitingHours(row, now)!)).toBe(41);
  });

  it('a click cannot clear it: there is no read stamp to pass', () => {
    // If somebody ever adds a third argument here, this stops compiling, which
    // is the point.
    expect(isAwaitingReply(row, now)).toBe(true);
    expect(isAwaitingReply.length).toBeLessThanOrEqual(2);
  });

  it('the confirmation we did send does not count, because it came after', () => {
    // 07:01 on the 21st IS newer than his question, so by then we had answered
    // in the eyes of the rule. That is correct and it is why the fix is speed,
    // not bookkeeping.
    expect(isAwaitingReply({ ...row, lastOutboundAt: '2026-08-21T07:01:00Z' }, now)).toBe(false);
  });
});

describe('the two builders nobody ever answered', () => {
  const now = new Date('2026-08-21T15:00:00Z');
  it('Four Oaks said "Yes I\'m coming Monday 24 August" and is waiting', () => {
    expect(isAwaitingReply({
      lastInboundAt: '2026-08-19T17:47:00Z', lastOutboundAt: '2026-08-19T14:46:00Z',
    }, now)).toBe(true);
  });
  it('PSS Constructions likewise', () => {
    expect(isAwaitingReply({
      lastInboundAt: '2026-08-19T15:03:00Z', lastOutboundAt: '2026-08-19T14:46:00Z',
    }, now)).toBe(true);
  });
});

describe('what counts as having answered them', () => {
  const now = new Date('2026-08-21T12:00:00Z');
  const base = { lastInboundAt: '2026-08-21T09:00:00Z', lastOutboundAt: '2026-08-21T08:00:00Z' };

  it('a reply on ANY channel counts: they WhatsApp, we email back', () => {
    // The thread is per contact for exactly this reason.
    expect(isAwaitingReply({ ...base, lastOutboundAt: '2026-08-21T09:30:00Z' }, now)).toBe(false);
  });

  it('ringing them back counts', () => {
    expect(isAwaitingReply({ ...base, lastOutboundCallAt: '2026-08-21T09:30:00Z' }, now)).toBe(false);
  });

  it('a call BEFORE their message does not', () => {
    expect(isAwaitingReply({ ...base, lastOutboundCallAt: '2026-08-21T08:30:00Z' }, now)).toBe(true);
  });

  it('a deliberate "Answered" press counts, and re-arms on the next message', () => {
    expect(isAwaitingReply({ ...base, handledAt: '2026-08-21T09:30:00Z' }, now)).toBe(false);
    // They wrote again afterwards: back on the list, no press required.
    expect(isAwaitingReply({
      ...base, lastInboundAt: '2026-08-21T10:00:00Z', handledAt: '2026-08-21T09:30:00Z',
    }, now)).toBe(true);
  });

  it('a stale press does NOT suppress a newer message', () => {
    expect(isAwaitingReply({ ...base, handledAt: '2026-08-21T08:30:00Z' }, now)).toBe(true);
  });

  it('nothing at all from them is not waiting', () => {
    expect(isAwaitingReply({ lastOutboundAt: '2026-08-21T08:00:00Z' }, now)).toBe(false);
    expect(isAwaitingReply({}, now)).toBe(false);
    expect(isAwaitingReply({ lastInboundAt: 'not a date' }, now)).toBe(false);
  });
});

describe('snooze', () => {
  const now = new Date('2026-08-21T12:00:00Z');
  const base = { lastInboundAt: '2026-08-21T09:00:00Z', lastOutboundAt: '2026-08-21T08:00:00Z' };

  it('a live snooze puts it down', () => {
    expect(isAwaitingReply({ ...base, snoozedUntil: '2026-08-21T18:00:00Z' }, now)).toBe(false);
  });
  it('an expired snooze brings it back on its own', () => {
    expect(isAwaitingReply({ ...base, snoozedUntil: '2026-08-21T11:00:00Z' }, now)).toBe(true);
  });
  it('a message arriving DURING a snooze re-arms it immediately', () => {
    expect(isAwaitingReply({
      ...base, lastInboundAt: '2026-08-21T19:00:00Z', snoozedUntil: '2026-08-21T18:00:00Z',
    }, new Date('2026-08-21T19:30:00Z'))).toBe(true);
  });
  it('waitingHours is null for anything not waiting', () => {
    expect(waitingHours({ ...base, snoozedUntil: '2026-08-21T18:00:00Z' }, now)).toBeNull();
  });
});

describe('sortWaitingRows: the longest wait at the top', () => {
  const r = (id: string, lastInboundAt: string, pinnedAt: string | null = null) =>
    ({ id, unread: true, pinnedAt, lastMessageAt: lastInboundAt, lastInboundAt });

  it('puts 41 hours above 2 minutes, which recency gets exactly backwards', () => {
    const out = sortWaitingRows([
      r('fresh', '2026-08-21T14:58:00Z'),
      r('lunar', '2026-08-19T14:04:00Z'),
      r('week-old', '2026-08-08T09:00:00Z'),
    ]);
    expect(out.map((x) => x.id)).toEqual(['week-old', 'lunar', 'fresh']);
  });

  it('a pin still outranks the wait: it is a deliberate keep-this-in-front-of-me', () => {
    const out = sortWaitingRows([
      r('old', '2026-08-08T09:00:00Z'),
      r('pinned-but-recent', '2026-08-21T14:00:00Z', '2026-08-21T10:00:00Z'),
    ]);
    expect(out[0].id).toBe('pinned-but-recent');
  });

  it('never mutates the input', () => {
    const rows = [r('b', '2026-08-21T10:00:00Z'), r('a', '2026-08-08T10:00:00Z')];
    sortWaitingRows(rows);
    expect(rows.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
