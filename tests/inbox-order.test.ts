import { describe, it, expect } from 'vitest';
import { isThreadUnread, sortInboxRows, inboxSections } from '../src/features/crm/lib/inboxOrder';

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
