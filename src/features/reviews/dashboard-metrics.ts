// Pure dashboard math (TDD). No React, no I/O — unit-tested in isolation.

/**
 * Projected average rating after adding N five-star reviews.
 *   (avg*count + 5*added) / (count + added)
 * Edge cases: adding 0 → unchanged; from a zero base → 5.0; empty+none → avg.
 */
export function projectRating(currentAvg: number, currentCount: number, addedFiveStar: number): number {
  const added = Math.max(0, Math.floor(addedFiveStar))
  const denom = currentCount + added
  if (denom === 0) return currentAvg
  return (currentAvg * currentCount + 5 * added) / denom
}

/** Whole 5-star reviews needed to lift the average to `target` (< 5). */
export function reviewsNeeded(currentAvg: number, currentCount: number, target: number): number {
  if (target <= currentAvg) return 0
  if (target >= 5) return Infinity // never reachable with 5-star reviews
  return Math.ceil((currentCount * (target - currentAvg)) / (5 - target))
}

export interface Milestone { target: number; needed: number }

/**
 * The next few rating milestones (+0.1★ each) and the reviews needed to hit them.
 * Empty when there's no base yet, or the rating is already at the ceiling.
 */
export function milestonesToRatings(currentAvg: number, currentCount: number, steps = 5): Milestone[] {
  if (currentCount <= 0 || currentAvg >= 4.9) return []
  const out: Milestone[] = []
  for (let i = 1; i <= steps; i++) {
    const target = Math.min(5, Math.round((currentAvg + i * 0.1) * 10) / 10)
    const needed = reviewsNeeded(currentAvg, currentCount, target)
    if (Number.isFinite(needed) && needed > 0) out.push({ target, needed })
  }
  return out
}

/** Clamp a numeric input to an inclusive range (used by the slider ↔ input pair). */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** Google Maps deep link for a place CID (spec: maps?cid=<cid>). */
export function mapsUrlForCid(cid: string): string {
  return `https://maps.google.com/maps?cid=${encodeURIComponent(cid)}`
}
