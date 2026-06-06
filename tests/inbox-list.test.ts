import { describe, it, expect } from 'vitest'
import {
  matchesSearch,
  filterBySearch,
  compareByMode,
  sortInbox,
  searchAndSort,
  type InboxListItem,
} from '../src/core/lib/inbox-list'

function item(over: Partial<InboxListItem> & { id: string }): InboxListItem {
  return { name: 'Unknown', ...over }
}

describe('matchesSearch', () => {
  const john = item({
    id: '1',
    name: 'John Smith',
    phone: '+44 7426 495169',
    email: 'john@acme.com',
    preview: 'Dinner tomorrow at 8',
  })

  it('matches everything on an empty query', () => {
    expect(matchesSearch(john, '')).toBe(true)
    expect(matchesSearch(john, '   ')).toBe(true)
  })

  it('matches on name, case-insensitively', () => {
    expect(matchesSearch(john, 'john')).toBe(true)
    expect(matchesSearch(john, 'SMITH')).toBe(true)
  })

  it('matches on email and preview text', () => {
    expect(matchesSearch(john, 'acme.com')).toBe(true)
    expect(matchesSearch(john, 'dinner')).toBe(true)
  })

  it('matches phone ignoring spaces and plus sign', () => {
    expect(matchesSearch(john, '447426495169')).toBe(true)
    expect(matchesSearch(john, '495169')).toBe(true)
    expect(matchesSearch(john, '+447426')).toBe(true)
  })

  it('does not match unrelated text', () => {
    expect(matchesSearch(john, 'zzz')).toBe(false)
    expect(matchesSearch(john, '999999')).toBe(false)
  })

  it('falls back gracefully when fields are missing', () => {
    const bare = item({ id: '2', name: 'Unknown' })
    expect(matchesSearch(bare, 'unknown')).toBe(true)
    expect(matchesSearch(bare, '123')).toBe(false)
  })
})

describe('filterBySearch', () => {
  const items = [
    item({ id: '1', name: 'John Smith', phone: '+447426495169' }),
    item({ id: '2', name: 'Jane Doe', email: 'jane@x.com' }),
    item({ id: '3', name: 'Acme Plumbing', preview: 'quote please' }),
  ]

  it('returns all when query is blank', () => {
    expect(filterBySearch(items, '')).toHaveLength(3)
  })

  it('filters to matching chats only', () => {
    expect(filterBySearch(items, 'jane').map((i) => i.id)).toEqual(['2'])
    expect(filterBySearch(items, '4495169'.slice(1)).map((i) => i.id)).toEqual(['1'])
    expect(filterBySearch(items, 'quote').map((i) => i.id)).toEqual(['3'])
  })
})

describe('compareByMode', () => {
  it('recent: newer lastMessageAt sorts first', () => {
    const older = item({ id: 'o', lastMessageAt: '2026-06-01T10:00:00Z' })
    const newer = item({ id: 'n', lastMessageAt: '2026-06-05T10:00:00Z' })
    expect(compareByMode(older, newer, 'recent')).toBeGreaterThan(0)
    expect(compareByMode(newer, older, 'recent')).toBeLessThan(0)
  })

  it('longest: bigger weight sorts first', () => {
    const short = item({ id: 's', weight: 30 })
    const long = item({ id: 'l', weight: 300 })
    expect(compareByMode(short, long, 'longest')).toBeGreaterThan(0)
    expect(compareByMode(long, short, 'longest')).toBeLessThan(0)
  })

  it('longest: ties break by recency', () => {
    const a = item({ id: 'a', weight: 100, lastMessageAt: '2026-06-01T00:00:00Z' })
    const b = item({ id: 'b', weight: 100, lastMessageAt: '2026-06-05T00:00:00Z' })
    expect(compareByMode(a, b, 'longest')).toBeGreaterThan(0)
  })
})

describe('sortInbox', () => {
  const items = [
    item({ id: 'old', lastMessageAt: '2026-06-01T00:00:00Z', weight: 10 }),
    item({ id: 'new', lastMessageAt: '2026-06-05T00:00:00Z', weight: 20 }),
    item({ id: 'mid-pinned', lastMessageAt: '2026-06-03T00:00:00Z', weight: 999, pinned: true }),
  ]

  it('always puts pinned chats first (recent mode)', () => {
    expect(sortInbox(items, 'recent').map((i) => i.id)).toEqual(['mid-pinned', 'new', 'old'])
  })

  it('always puts pinned chats first (longest mode)', () => {
    expect(sortInbox(items, 'longest').map((i) => i.id)).toEqual(['mid-pinned', 'new', 'old'])
  })

  it('does not mutate the input array', () => {
    const input = [...items]
    sortInbox(input, 'recent')
    expect(input.map((i) => i.id)).toEqual(['old', 'new', 'mid-pinned'])
  })

  it('orders unpinned by weight in longest mode', () => {
    const list = [
      item({ id: 'a', weight: 5 }),
      item({ id: 'b', weight: 50 }),
      item({ id: 'c', weight: 25 }),
    ]
    expect(sortInbox(list, 'longest').map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('searchAndSort', () => {
  it('filters then sorts with pinned first', () => {
    const items = [
      item({ id: 'j1', name: 'John A', lastMessageAt: '2026-06-01T00:00:00Z' }),
      item({ id: 'j2', name: 'John B', lastMessageAt: '2026-06-05T00:00:00Z', pinned: true }),
      item({ id: 'x', name: 'Other', lastMessageAt: '2026-06-09T00:00:00Z' }),
    ]
    const out = searchAndSort(items, 'john', 'recent')
    expect(out.map((i) => i.id)).toEqual(['j2', 'j1'])
  })
})
