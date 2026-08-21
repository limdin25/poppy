// Inbox ordering + unread rules. Pure functions so they can be unit tested
// without a browser or a database.
//
// Hugo 2026-08-06: "just make a normal inbox, last communication is always on
// top... unless I press the filters". This SUPERSEDES the 2026-07-28
// unread-on-top rule: the default list is pinned, then pure recency, exactly
// like a phone's messaging app. Unread still gets its badge and its own
// filter pill; it just no longer jumps the queue. The 2026-07-28 blast
// problem (100 outbound rows burying six repliers) is what the UNREAD pill is
// for now.
//
// Pinned stays hoisted in every view: a pin is a deliberate "keep this in
// front of me", and recency must not wash it away.

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

// ---------------------------------------------------------------------------
// WAITING ON US, WHICH IS NOT THE SAME THING AS UNREAD.   (2026-08-21)
// ---------------------------------------------------------------------------
//
// The day it cost a deal. On 19 August a builder was sent a WhatsApp invite and
// replied two minutes later agreeing to the viewing AND asking a direct
// question: "could you please send me the full address". Nobody answered him
// for FORTY-ONE HOURS. He cancelled on the morning of the viewing, saying he
// "needed the full address in advance and didn't receive it in time". Two other
// builders replied "yes I'm coming Monday 24 August" and were never answered
// either. On 21 August, ten threads had an inbound newer than our last
// outbound, some since 8 August.
//
// The rule to spot it already existed, one function up. What broke it is that
// isThreadUnread ANDs it with `lastReadAt`, and openThread() stamps that the
// instant somebody CLICKS a row. So reading a message without answering it made
// it stop looking like it needed an answer.
//
// Hence the split. `unread` means "I have not looked at this" and keeps driving
// the bold row and the blue tint, which is right and which Hugo asked for.
// `awaiting reply` means "they spoke last and nobody has answered", it takes NO
// lastReadAt argument at all, and it is the only one allowed to raise an alarm.
//
// Look at the signature below before adding a read stamp to it. There is
// nowhere to put one on purpose.

/** How long an outbound call has to last before it counts as having answered
 *  somebody. Below this it is a ring-out or a wrong number, not a reply. */
export const ANSWERED_CALL_MIN_SECONDS = 20;

export interface AwaitingInput extends UnreadInput {
  /** When we last RANG them and got through (>= ANSWERED_CALL_MIN_SECONDS).
   *  Ringing a builder back is answering him, and without this the nag would
   *  chase a conversation that has already happened out loud. */
  lastOutboundCallAt?: string | null;
  /** When a human deliberately pressed "Answered". For the cases the machine
   *  cannot see: replied from a personal phone, sorted it in person. It only
   *  suppresses while it is NEWER than their last message, so the next thing
   *  they send re-arms it by itself. */
  handledAt?: string | null;
  /** Deliberately put down until this time. Same self-healing rule: a message
   *  arriving during a snooze re-arms immediately. */
  snoozedUntil?: string | null;
}

/**
 * Are they waiting on us right now?
 *
 * True when the lead's newest message is newer than everything we have said
 * back: our newest sent message on ANY channel, a call we got through on, and
 * any deliberate "Answered" press. Cross-channel matters, they often reply to a
 * WhatsApp by email, and a thread is per contact for exactly that reason.
 *
 * NOTE THE MISSING ARGUMENT. There is no lastReadAt here and there must never
 * be one: opening a thread is not answering it. See the block above.
 */
export function isAwaitingReply(row: AwaitingInput, now: Date = new Date()): boolean {
  const inbound = ts(row.lastInboundAt);
  if (inbound === 0) return false;
  if (ts(row.lastOutboundAt) >= inbound) return false;
  if (ts(row.lastOutboundCallAt) >= inbound) return false;
  if (ts(row.handledAt) >= inbound) return false;
  // A live snooze hides it, but only while their newest message predates it.
  const snoozed = ts(row.snoozedUntil);
  if (snoozed > now.getTime() && snoozed >= inbound) return false;
  return true;
}

/** How many hours they have been waiting, or null when they are not.
 *  Fractional on purpose: the caller decides how to round it. */
export function waitingHours(row: AwaitingInput, now: Date = new Date()): number | null {
  if (!isAwaitingReply(row, now)) return null;
  return Math.max(0, (now.getTime() - ts(row.lastInboundAt)) / 3_600_000);
}

/**
 * The waiting list: pinned first (a pin is still a deliberate "keep this in
 * front of me"), then THE LONGEST WAIT AT THE TOP.
 *
 * Deliberately not sortInboxRows. The default list stays pinned then recency
 * because Hugo killed unread-on-top on 2026-08-06, and this order applies only
 * inside the waiting view, which a person has to press to see. Recency is
 * exactly the wrong order here: it buries the 41-hour thread under one that
 * arrived a minute ago.
 */
export function sortWaitingRows<T extends OrderableRow & { lastInboundAt?: string | null }>(
  rows: T[],
): T[] {
  const band = (r: T): number => (r.pinnedAt ? 0 : 1);
  return [...rows].sort((a, b) => {
    const ba = band(a);
    const bb = band(b);
    if (ba !== bb) return ba - bb;
    if (ba === 0) return ts(b.pinnedAt) - ts(a.pinnedAt);
    return ts(a.lastInboundAt) - ts(b.lastInboundAt);   // oldest first
  });
}

/** Pinned → newest. Returns a new array; never mutates the input. */
export function sortInboxRows<T extends OrderableRow>(rows: T[]): T[] {
  const band = (r: T): number => (r.pinnedAt ? 0 : 1);
  return [...rows].sort((a, b) => {
    const ba = band(a);
    const bb = band(b);
    if (ba !== bb) return ba - bb;
    // Most recently pinned sits at the very top of the pinned band.
    if (ba === 0) return ts(b.pinnedAt) - ts(a.pinnedAt);
    return ts(b.lastMessageAt) - ts(a.lastMessageAt);
  });
}

// 'unread' left this type on 2026-08-21. It had been unreachable since the
// 2026-08-06 reorder: inboxSections never put a row in that bucket and never
// returned the key, so the "Needs a reply" header it fed could not render. A
// dead label that says the one thing the inbox was getting wrong was worse than
// no label. The waiting pill is the honest version of it.
export type InboxSectionKey = 'pinned' | 'rest';

export interface InboxSection<T> {
  key: InboxSectionKey;
  rows: T[];
}

/**
 * Split an ALREADY-SORTED list (sortInboxRows order) into its bands so the UI
 * can put a label above each one. Since 2026-08-06 the default list has only
 * two possible bands, pinned and everything else: unread rows sit in plain
 * recency order (badged, not hoisted), so a "Needs a reply" header would lie
 * about the order.
 *
 * Pure regrouping, no re-sort: concatenating the sections' rows reproduces the
 * input exactly. Empty bands are omitted, so a list that is all one band comes
 * back as a single section, which the UI renders without any header. Call rows
 * CAN be pinned, pin state is per CONTACT (wk_inbox_state), so a contact
 * pinned in the message view is pinned under the Calls filter too and gets a
 * Pinned header there. That is one fact in one place, not a bug.
 */
export function inboxSections<T extends OrderableRow>(sorted: T[]): InboxSection<T>[] {
  const buckets: Record<InboxSectionKey, T[]> = { pinned: [], rest: [] };
  for (const r of sorted) {
    buckets[r.pinnedAt ? 'pinned' : 'rest'].push(r);
  }
  return (['pinned', 'rest'] as const)
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, rows: buckets[k] }));
}
