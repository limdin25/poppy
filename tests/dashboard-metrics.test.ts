import { describe, it, expect } from 'vitest'
import {
  projectRating, reviewsNeeded, milestonesToRatings, clamp, mapsUrlForCid,
} from '../src/features/reviews/dashboard-metrics'

describe('projectRating', () => {
  it('applies the weighted-average formula', () => {
    // 4.0 avg over 10 reviews, add 10 five-stars → (40+50)/20 = 4.5
    expect(projectRating(4.0, 10, 10)).toBe(4.5)
  })
  it('adding 0 leaves the average unchanged', () => {
    expect(projectRating(4.2, 37, 0)).toBe(4.2)
  })
  it('from a zero base (no reviews), any 5-stars give exactly 5.0', () => {
    expect(projectRating(0, 0, 3)).toBe(5)
  })
  it('empty base and no additions returns the current average', () => {
    expect(projectRating(0, 0, 0)).toBe(0)
  })
  it('ignores negative additions', () => {
    expect(projectRating(4.0, 10, -5)).toBe(4.0)
  })
  it('trends toward 5 as additions grow', () => {
    expect(projectRating(3.0, 5, 100)).toBeGreaterThan(4.5)
  })
})

describe('reviewsNeeded', () => {
  it('needs none when already at/above target', () => {
    expect(reviewsNeeded(4.5, 20, 4.5)).toBe(0)
    expect(reviewsNeeded(4.6, 20, 4.5)).toBe(0)
  })
  it('computes whole reviews to lift the average', () => {
    // to go 4.0 → 4.1 with 10 reviews: ceil(10*0.1/0.9) = ceil(1.11) = 2
    expect(reviewsNeeded(4.0, 10, 4.1)).toBe(2)
  })
  it('a 5.0 target is unreachable', () => {
    expect(reviewsNeeded(4.0, 10, 5)).toBe(Infinity)
  })
})

describe('milestonesToRatings', () => {
  it('is empty with no reviews yet', () => {
    expect(milestonesToRatings(0, 0)).toEqual([])
  })
  it('is empty when already at the ceiling', () => {
    expect(milestonesToRatings(4.95, 100)).toEqual([])
  })
  it('returns ascending targets each needing >0 reviews', () => {
    const ms = milestonesToRatings(4.0, 20)
    expect(ms.length).toBeGreaterThan(0)
    expect(ms.every((m) => m.needed > 0 && Number.isFinite(m.needed))).toBe(true)
    const targets = ms.map((m) => m.target)
    expect([...targets]).toEqual([...targets].sort((a, b) => a - b))
  })
})

describe('clamp', () => {
  it('bounds to the range', () => {
    expect(clamp(150, 0, 100)).toBe(100)
    expect(clamp(-5, 0, 100)).toBe(0)
    expect(clamp(42, 0, 100)).toBe(42)
  })
  it('NaN falls back to min', () => {
    expect(clamp(NaN, 0, 100)).toBe(0)
  })
})

describe('mapsUrlForCid', () => {
  it('builds the cid deep link', () => {
    expect(mapsUrlForCid('12345678901234567890')).toBe('https://maps.google.com/maps?cid=12345678901234567890')
  })
})
