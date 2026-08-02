// Inbox ordering + unread rules. Pure functions so they can be unit tested
// without a browser or a database.
//
// Hugo 2026-07-28: "unread is always on the top, even if we have blasted
// messages". A 100-lead blast puts 100 outbound rows at the top of a
// recency-sorted list and buries the six people who actually replied. Recency
// alone is the wrong sort for a sales inbox.
//
// The order is: pinned, then unread, then newest first inside each band.
// Pinned outranks unread on purpose — a pin is a deliberate "keep this in front
// of me", and an unread pinned row is still pinned, so nothing gets lost.

export interface UnreadInput {
  /** Newest message FROM the lead. */
  lastInboundAt?: string | null;
  /** Newest message the workspace actually SENT (drafts do not count). */
  lastOutboundAt?: string | null;
}

export interface OrderableRow {
  unread: boolean;
  pinnedAt?: string | null;
  lastMessageAt: string | null;
}

const ts = (s?: string | null): number => {
  if (!s) return 0;
  const n = +new Date(s);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A thread is unread when the lead's newest message is newer than BOTH:
 *   - the newest message we sent them, and
 *   - the last time this agent opened the thread.
 *
 * The "newer than our reply" half is what makes it self-healing. Every thread
 * starts with no wk_inbox_state row, so without it the whole back catalogue of
 * answered conversations would light up unread on the day this shipped.
 */
export function isThreadUnread(row: UnreadInput, lastReadAt?: string | null): boolean {
  const inbound = ts(row.lastInboundAt);
  if (inbound === 0) return false;
  if (ts(row.lastOutboundAt) >= inbound) return false;
  if (ts(lastReadAt) >= inbound) return false;
  return true;
}

/** Pinned → unread → newest. Returns a new array; never mutates the input. */
export function sortInboxRows<T extends OrderableRow>(rows: T[]): T[] {
  const band = (r: T): number => (r.pinnedAt ? 0 : r.unread ? 1 : 2);
  return [...rows].sort((a, b) => {
    const ba = band(a);
    const bb = band(b);
    if (ba !== bb) return ba - bb;
    // Most recently pinned sits at the very top of the pinned band.
    if (ba === 0) return ts(b.pinnedAt) - ts(a.pinnedAt);
    return ts(b.lastMessageAt) - ts(a.lastMessageAt);
  });
}

export type InboxSectionKey = 'pinned' | 'unread' | 'rest';

export interface InboxSection<T> {
  key: InboxSectionKey;
  rows: T[];
}

/**
 * Split an ALREADY-SORTED list (sortInboxRows order) into its bands so the UI
 * can put a label above each one. Hugo 2026-08-02: the bands were invisible,
 * so the order read as random pollution; a labelled "Needs a reply" section
 * makes the same order self-explaining.
 *
 * Pure regrouping, no re-sort: concatenating the sections' rows reproduces the
 * input exactly. Empty bands are omitted, so a list that is all one band comes
 * back as a single section, which the UI renders without any header. Call rows
 * are never unread (their inbound/outbound stamps are hardcoded null), but
 * they CAN be pinned, pin state is per CONTACT (wk_inbox_state), so a contact
 * pinned in the message view is pinned under the Calls filter too and gets a
 * Pinned header there. That is one fact in one place, not a bug.
 */
export function inboxSections<T extends OrderableRow>(sorted: T[]): InboxSection<T>[] {
  const buckets: Record<InboxSectionKey, T[]> = { pinned: [], unread: [], rest: [] };
  for (const r of sorted) {
    buckets[r.pinnedAt ? 'pinned' : r.unread ? 'unread' : 'rest'].push(r);
  }
  return (['pinned', 'unread', 'rest'] as const)
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, rows: buckets[k] }));
}
