import { describe, it, expect } from 'vitest';
import { isThreadUnread, sortInboxRows } from '../src/features/crm/lib/inboxOrder';

// Hugo, 2026-07-28, looking at Maria's inbox after the 100-lead blast:
// "make sure unread is always on the top, even if we have blasted messages".
//
// The blast wrote 100 outbound rows in a few minutes. Sorted by recency alone,
// the six people who actually replied sat below all of them. These tests pin
// the two rules that fix it: what counts as unread, and what order the list is
// in.

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

  it('puts an unread reply above a newer outbound blast', () => {
    const out = sortInboxRows([
      row('blast', { lastMessageAt: '2026-07-28T10:04:00Z' }),
      row('reply', { unread: true, lastMessageAt: '2026-07-28T08:00:00Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['reply', 'blast']);
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

  it('falls back to newest-first inside each band', () => {
    const out = sortInboxRows([
      row('older', { lastMessageAt: '2026-07-26T09:00:00Z' }),
      row('newer', { lastMessageAt: '2026-07-28T09:00:00Z' }),
      row('unread-older', { unread: true, lastMessageAt: '2026-07-20T09:00:00Z' }),
      row('unread-newer', { unread: true, lastMessageAt: '2026-07-27T09:00:00Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['unread-newer', 'unread-older', 'newer', 'older']);
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
