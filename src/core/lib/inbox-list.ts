/**
 * Pure list logic for the Inbox chat list: search, sort and pin ordering.
 *
 * Kept UI-free and side-effect-free so it can be unit tested in isolation and
 * reused by InboxPage without pulling React in. The page maps each Conversation
 * (plus its contact + any linked call) onto an InboxListItem before calling
 * these.
 */

export type InboxSortMode = 'recent' | 'longest'

export interface InboxListItem {
  id: string
  /** Resolved display name (contact name, or number/email fallback). */
  name: string
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  /** Last message preview text (searchable). */
  preview?: string | null
  /** ISO timestamp of the last activity; used for the 'recent' sort. */
  lastMessageAt?: string | null
  /** Whether the user pinned this chat — pinned chats always sort to the top. */
  pinned?: boolean
  /**
   * Size of the interaction for the 'longest' sort — e.g. a call's duration in
   * seconds, or message length for text channels. Higher = longer.
   */
  weight?: number
}

/** Keep only digits — so "+44 7426 495169" and "447426495169" match. */
function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/**
 * Does this chat match a free-text search query? Matches against the display
 * name, phone / WhatsApp / email, and the last-message preview. Phone matching
 * is digit-normalised. An empty/whitespace query matches everything.
 */
export function matchesSearch(item: InboxListItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true

  const haystacks = [item.name, item.preview, item.email, item.phone, item.whatsapp]
  for (const h of haystacks) {
    if (h && h.toLowerCase().includes(q)) return true
  }

  // Numeric query → match against digit-normalised phone/whatsapp.
  const qDigits = digits(q)
  if (qDigits.length >= 3) {
    if (digits(item.phone).includes(qDigits)) return true
    if (digits(item.whatsapp).includes(qDigits)) return true
  }
  return false
}

/** Filter a list of chats by a search query (see matchesSearch). */
export function filterBySearch<T extends InboxListItem>(items: T[], query: string): T[] {
  if (!query.trim()) return items
  return items.filter((i) => matchesSearch(i, query))
}

function timeValue(iso: string | null | undefined): number {
  if (!iso) return -Infinity
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/** Compare two chats by the active sort mode (newest / longest first). */
export function compareByMode(a: InboxListItem, b: InboxListItem, mode: InboxSortMode): number {
  if (mode === 'longest') {
    const wa = a.weight ?? 0
    const wb = b.weight ?? 0
    if (wb !== wa) return wb - wa
    // tie-break by recency so equal-length chats stay in a sensible order
    return timeValue(b.lastMessageAt) - timeValue(a.lastMessageAt)
  }
  // 'recent'
  return timeValue(b.lastMessageAt) - timeValue(a.lastMessageAt)
}

/**
 * Sort chats for display: pinned chats always come first (in their own
 * mode-sorted order), then the rest. Stable and non-mutating.
 */
export function sortInbox<T extends InboxListItem>(items: T[], mode: InboxSortMode): T[] {
  const pinned = items.filter((i) => i.pinned)
  const rest = items.filter((i) => !i.pinned)
  pinned.sort((a, b) => compareByMode(a, b, mode))
  rest.sort((a, b) => compareByMode(a, b, mode))
  return [...pinned, ...rest]
}

/** Convenience: filter by search then sort (pinned first). */
export function searchAndSort<T extends InboxListItem>(
  items: T[],
  query: string,
  mode: InboxSortMode,
): T[] {
  return sortInbox(filterBySearch(items, query), mode)
}
