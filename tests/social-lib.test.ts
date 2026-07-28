import { describe, it, expect, beforeAll } from 'vitest'
import {
  isAllowedBackground, captionFor, enabledTypesToday, weekdayKey, reviewTextForLength,
  type ReviewRow, type ScheduleMap,
} from '../api/lib/social'

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://loggyxryrhqsbtqpteog.supabase.co'
})

describe('isAllowedBackground (SSRF guard)', () => {
  it('accepts preset specs (rendered locally, never fetched)', () => {
    expect(isAllowedBackground('solid:#ffffff')).toBe(true)
    expect(isAllowedBackground('gradient:135,#7c3aed,#ec4899')).toBe(true)
    expect(isAllowedBackground('dots:#111827,#374151')).toBe(true)
    expect(isAllowedBackground('stripes:#1e3a8a,#1d4ed8')).toBe(true)
  })

  it('accepts allowlisted https hosts (supabase bucket + unsplash)', () => {
    expect(isAllowedBackground('https://loggyxryrhqsbtqpteog.supabase.co/storage/v1/object/public/review-assets/x.png')).toBe(true)
    expect(isAllowedBackground('https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=1080')).toBe(true)
  })

  it('blocks internal / metadata / private targets', () => {
    expect(isAllowedBackground('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isAllowedBackground('http://localhost:5432/')).toBe(false)
    expect(isAllowedBackground('http://127.0.0.1/')).toBe(false)
    expect(isAllowedBackground('http://10.0.0.5/internal')).toBe(false)
    expect(isAllowedBackground('https://evil.example.com/x.png')).toBe(false)
  })

  it('blocks non-http(s) schemes and junk', () => {
    expect(isAllowedBackground('file:///etc/passwd')).toBe(false)
    expect(isAllowedBackground('ftp://images.unsplash.com/x')).toBe(false)
    expect(isAllowedBackground('http://images.unsplash.com/x')).toBe(false) // must be https
    expect(isAllowedBackground('')).toBe(false)
    expect(isAllowedBackground(undefined)).toBe(false)
    expect(isAllowedBackground(123 as unknown as string)).toBe(false)
  })
})

describe('captionFor', () => {
  const review: ReviewRow = { id: '1', rating: 5, comment: 'Great job!', reviewer_name: 'Jo', reply_text: 'Thanks Jo!', review_created_at: null }
  it('comment mode uses the review comment', () => {
    expect(captionFor('comment', 'ignored', review)).toBe('Great job!')
  })
  it('reply mode uses the reply, falling back to comment when empty', () => {
    expect(captionFor('reply', null, review)).toBe('Thanks Jo!')
    expect(captionFor('reply', null, { ...review, reply_text: null })).toBe('Great job!')
  })
  it('custom mode uses custom text, falling back to comment when empty', () => {
    expect(captionFor('custom', 'Book us today!', review)).toBe('Book us today!')
    expect(captionFor('custom', '  ', review)).toBe('Great job!')
  })
})

describe('enabledTypesToday / weekdayKey', () => {
  const schedule: ScheduleMap = {
    monday: { story: false, feed: true },
    tuesday: { story: true, feed: true },
    wednesday: { story: false, feed: false },
  }
  it('weekdayKey resolves a known date (Europe/London)', () => {
    expect(weekdayKey(new Date('2026-07-20T12:00:00Z'))).toBe('monday')
    expect(weekdayKey(new Date('2026-07-21T12:00:00Z'))).toBe('tuesday')
  })
  it('returns only the enabled types for the day', () => {
    expect(enabledTypesToday(schedule, new Date('2026-07-20T12:00:00Z'))).toEqual(['feed'])
    expect(enabledTypesToday(schedule, new Date('2026-07-21T12:00:00Z'))).toEqual(['feed', 'story'])
    expect(enabledTypesToday(schedule, new Date('2026-07-22T12:00:00Z'))).toEqual([])
    expect(enabledTypesToday(null, new Date('2026-07-20T12:00:00Z'))).toEqual([])
  })
})

describe('reviewTextForLength', () => {
  const long = 'x'.repeat(700)
  it('short trims to ~90 with ellipsis', () => {
    expect(reviewTextForLength(long, 'short').length).toBeLessThanOrEqual(90)
    expect(reviewTextForLength(long, 'short').endsWith('…')).toBe(true)
  })
  it('medium trims to ~220', () => {
    expect(reviewTextForLength(long, 'medium').length).toBeLessThanOrEqual(220)
  })
  it('long keeps up to ~600', () => {
    expect(reviewTextForLength(long, 'long').length).toBeLessThanOrEqual(600)
  })
  it('short passthrough for brief text', () => {
    expect(reviewTextForLength('Nice work', 'short')).toBe('Nice work')
    expect(reviewTextForLength(null, 'short')).toBe('')
  })
})
