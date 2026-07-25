// Deterministic human-motion toolkit for the VSL.
// Principles from ghost-cursor / Fitts's law / minimum-jerk research:
// - cursor travels on cubic Beziers (arcs, never straight lines)
// - velocity follows a minimum-jerk bell profile (slow-fast-slow)
// - long moves overshoot the target ~4-8% and correct back
// - idle hands tremble slightly (layered sines — no Math.random at render time)
// Everything is seeded + precomputed at module scope so every render worker
// produces identical frames.

export interface Pt { x: number; y: number }

// mulberry32 — tiny seeded RNG
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// minimum-jerk velocity profile: position along a 0..1 move at time 0..1
export function minJerk(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 10 * c ** 3 - 15 * c ** 4 + 6 * c ** 5
}

// Fitts-ish duration (frames @30fps) for a move of `dist` px
export function moveFrames(dist: number): number {
  return Math.round(Math.min(48, Math.max(12, 8 + 6 * Math.log2(dist / 160 + 1))))
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
  }
}

export interface PathSegment { startFrame: number; points: Pt[] }

// A human move from a→b starting at startFrame. Long distances overshoot then
// correct. Returns one point per frame.
export function humanMove(a: Pt, b: Pt, startFrame: number, seed: number): PathSegment {
  const rand = rng(seed)
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const frames = moveFrames(dist)
  const overshoots = dist > 380
  const travel = overshoots ? Math.round(frames * 0.72) : frames

  // control points pulled perpendicular to the path so the arc bends naturally
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const nx = -(b.y - a.y) / (dist || 1)
  const ny = (b.x - a.x) / (dist || 1)
  const bend = (rand() - 0.5) * Math.min(180, dist * 0.35)
  const c1: Pt = { x: a.x + (mx - a.x) * 0.6 + nx * bend, y: a.y + (my - a.y) * 0.6 + ny * bend }
  const c2: Pt = { x: mx + (b.x - mx) * 0.5 + nx * bend * 0.6, y: my + (b.y - my) * 0.5 + ny * bend * 0.6 }

  const target = overshoots
    ? { x: b.x + (b.x - a.x) * (0.04 + rand() * 0.04), y: b.y + (b.y - a.y) * (0.04 + rand() * 0.04) }
    : b

  const points: Pt[] = []
  for (let i = 0; i <= travel; i++) points.push(cubic(a, c1, c2, target, minJerk(i / travel)))
  if (overshoots) {
    const back = frames - travel
    for (let i = 1; i <= back; i++) {
      const t = minJerk(i / back)
      points.push({ x: target.x + (b.x - target.x) * t, y: target.y + (b.y - target.y) * t })
    }
  }
  return { startFrame, points }
}

// Idle tremor — two incommensurate sines, ±2px. Deterministic, smooth.
export function tremor(frame: number, amp = 2): Pt {
  return {
    x: Math.sin(frame * 0.31) * amp * 0.6 + Math.sin(frame * 0.113 + 1.7) * amp * 0.4,
    y: Math.cos(frame * 0.27 + 0.8) * amp * 0.6 + Math.sin(frame * 0.091 + 3.1) * amp * 0.4,
  }
}

export interface CursorStep {
  /** absolute frame this step starts */
  at: number
  /** move destination; omit = dwell */
  to?: Pt
  /** frames held before this step's move (implicit dwell) */
  click?: boolean
}

/**
 * Compile a waypoint script into a frame-indexed cursor track.
 * steps: [{ at, to, click }] — `at` is when the cursor ARRIVES (move ends);
 * the move begins after the previous step ends. Dwell = gap between steps.
 */
export function compileTrack(origin: Pt, steps: { at: number; to: Pt; click?: boolean }[], totalFrames: number, seed = 7): { pos: Pt[]; clicks: number[] } {
  const pos: Pt[] = new Array(totalFrames)
  const clicks: number[] = []
  let cur = origin
  let cursor = 0
  steps.forEach((s, i) => {
    const dist = Math.hypot(s.to.x - cur.x, s.to.y - cur.y)
    const frames = moveFrames(dist)
    const start = Math.max(cursor, s.at - frames)
    const seg = humanMove(cur, s.to, start, seed + i * 131)
    // dwell until the move starts
    for (let f = cursor; f < start && f < totalFrames; f++) pos[f] = { ...cur }
    seg.points.forEach((p, j) => {
      const f = start + j
      if (f < totalFrames) pos[f] = p
    })
    cursor = start + seg.points.length
    cur = s.to
    if (s.click) clicks.push(cursor)
  })
  for (let f = cursor; f < totalFrames; f++) pos[f] = { ...cur }
  return { pos, clicks }
}

// A wheel-flick: one strong impulse decaying exponentially, ~22 frames.
// Sums a few flicks with gaps for that bursty human scroll feel.
export function flickSeries(flicks: { at: number; strength: number }[], totalFrames: number): number[] {
  const dy = new Array(totalFrames).fill(0)
  for (const { at, strength } of flicks) {
    for (let i = 0; i < 26 && at + i < totalFrames; i++) {
      dy[at + i] += strength * Math.exp(-i / 7.5)
    }
  }
  // integrate into cumulative scroll position
  const out = new Array(totalFrames).fill(0)
  let acc = 0
  for (let f = 0; f < totalFrames; f++) { acc += dy[f]; out[f] = acc }
  return out
}
