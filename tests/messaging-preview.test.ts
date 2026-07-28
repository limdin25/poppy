import { describe, it, expect } from 'vitest'
import {
  interpolate, charsRemaining, hasReviewLink, insertToken, lintCustom,
  SAMPLE_VARS, CUSTOM_DEFAULT, MESSAGE_MAX,
} from '../src/features/reviews/messaging-preview'

describe('interpolate', () => {
  it('substitutes every token with sample values', () => {
    const out = interpolate(CUSTOM_DEFAULT, SAMPLE_VARS)
    expect(out).toContain('Jessica')
    expect(out).toContain('Your Business')
    expect(out).toContain('go.heyelsie.com/r/abc123')
    expect(out).not.toContain('{')
  })
  it('replaces every occurrence and leaves unknown tokens alone', () => {
    expect(interpolate('{first_name} {first_name} {mystery}', SAMPLE_VARS)).toBe('Jessica Jessica {mystery}')
  })
  it('resolves owner_name', () => {
    expect(interpolate('by {owner_name}', SAMPLE_VARS)).toBe('by Mark')
  })
})

describe('charsRemaining', () => {
  it('counts down from the max', () => {
    expect(charsRemaining('', MESSAGE_MAX)).toBe(400)
    expect(charsRemaining('hello', 400)).toBe(395)
  })
  it('never goes negative', () => {
    expect(charsRemaining('x'.repeat(500), 400)).toBe(0)
  })
})

describe('hasReviewLink', () => {
  it('true only when the review-link token is present', () => {
    expect(hasReviewLink('leave a review {review_link}')).toBe(true)
    expect(hasReviewLink('no link here')).toBe(false)
  })
})

describe('lintCustom', () => {
  it('requires the review link', () => {
    expect(lintCustom('leave a review').ok).toBe(false)
    expect(lintCustom('review us {review_link}').ok).toBe(true)
  })
  it('blocks incentive wording like the server does', () => {
    expect(lintCustom('Get 10% off — review us {review_link}').ok).toBe(false)
    expect(lintCustom('Free gift for a review {review_link}').ok).toBe(false)
    expect(lintCustom('Win a prize! {review_link}').ok).toBe(false)
  })
  it('passes a clean compliant template', () => {
    expect(lintCustom(CUSTOM_DEFAULT).ok).toBe(true)
  })
})

describe('insertToken', () => {
  it('inserts at the caret with a leading space when needed', () => {
    const r = insertToken('Hi there', '{first_name}', 8, 8)
    expect(r.text).toBe('Hi there {first_name}')
    expect(r.cursor).toBe('Hi there {first_name}'.length)
  })
  it('does not add a leading space at the start or after whitespace', () => {
    expect(insertToken('', '{first_name}', 0, 0).text).toBe('{first_name}')
    expect(insertToken('Hi ', '{first_name}', 3, 3).text).toBe('Hi {first_name}')
  })
  it('replaces a selected range', () => {
    const r = insertToken('Hi NAME end', '{first_name}', 3, 7)
    expect(r.text).toBe('Hi {first_name} end')
  })
  it('clamps out-of-range selections', () => {
    const r = insertToken('abc', '{x}', 99, 99)
    expect(r.text).toBe('abc {x}')
  })
})
