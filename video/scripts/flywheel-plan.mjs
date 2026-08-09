/**
 * Turn the raw avatar recording into an edit plan.
 *
 * The recording is one locked-off take with 14.5 seconds of dead air spread
 * across 16 pauses. Removing those is both the tightening and the jump cuts:
 * every pause we close is a visible cut, and the video loses a fifth of its
 * length without losing a word.
 *
 * Everything downstream (captions, B-roll, emphasis hits) is timed against the
 * OUTPUT, so this file owns the source -> output mapping and nothing else may
 * re-derive it.
 *
 *   node video/scripts/flywheel-plan.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const FPS = 30
const SRC_DURATION = 74.197

/** A pause longer than this is a cut. Below it the speech still feels joined. */
const GAP_MIN = 0.28
/** What a cut pause is shortened to. Zero sounds clipped, this still breathes. */
const GAP_KEEP = 0.1
/** Lead-in before the first word, and tail after the last. */
const HEAD = 0.3
const TAIL = 0.34

/**
 * Framings, cycled so no two consecutive cuts share one. That mismatch across
 * a cut IS the jump-cut feel: same subject, different size, no camera move.
 *
 * The subject sits centred with his face high in frame, so every zoom biases
 * upward (negative y) or his head leaves the top of the crop.
 * Scale stays under 1.32; past that a 1080p source starts to show.
 */
const FRAMINGS = [
  { scale: 1.0, x: 0, y: 0 },
  { scale: 1.18, x: 0.01, y: -0.05 },
  { scale: 1.06, x: -0.02, y: -0.02 },
  { scale: 1.3, x: 0.02, y: -0.08 },
  { scale: 1.12, x: -0.03, y: -0.04 },
  { scale: 1.24, x: 0.03, y: -0.07 },
  { scale: 1.03, x: 0, y: -0.01 },
  { scale: 1.28, x: -0.02, y: -0.06 },
]

const transcript = JSON.parse(readFileSync(resolve(ROOT, 'src/flywheel/data/transcript.json'), 'utf8'))
const words = transcript.words

// --- the cuts -------------------------------------------------------------
// A cut runs from the end of one closed pause to the start of the next.

const boundaries = []
for (let i = 1; i < words.length; i++) {
  const gap = words[i].start - words[i - 1].end
  if (gap >= GAP_MIN) {
    boundaries.push({ outAt: words[i - 1].end, inAt: words[i].start })
  }
}

const pauseCuts = []
let srcCursor = Math.max(0, words[0].start - HEAD)
for (const b of boundaries) {
  // Keep a sliver of the pause on the outgoing side so consonants are not clipped.
  pauseCuts.push({ srcStart: srcCursor, srcEnd: b.outAt + GAP_KEEP, kind: 'pause' })
  srcCursor = b.inAt
}
pauseCuts.push({
  srcStart: srcCursor,
  srcEnd: Math.min(SRC_DURATION, words[words.length - 1].end + TAIL),
  kind: 'pause',
})

/**
 * Pauses alone do not pace this. They fall where the speaker breathed, which
 * here means one 14 second stretch with no cut in it at all, next to a shot of
 * 0.7s. So any shot over MAX_SHOT is subdivided at word boundaries.
 *
 * These are PUNCH cuts, and they are a different thing from a pause cut: no
 * footage is removed, only the framing changes. On a locked-off subject that
 * still reads as a cut, which is the whole trick, and it costs nothing because
 * the audio runs straight through it.
 */
const MAX_SHOT = 3.1

/** The word boundary nearest a target time, so a punch never lands mid-word. */
function nearestBoundary(target, lo, hi) {
  let best = null
  for (let i = 1; i < words.length; i++) {
    const mid = (words[i - 1].end + words[i].start) / 2
    if (mid <= lo || mid >= hi) continue
    if (best === null || Math.abs(mid - target) < Math.abs(best - target)) best = mid
  }
  return best
}

const cuts = []
for (const c of pauseCuts) {
  const span = c.srcEnd - c.srcStart
  if (span <= MAX_SHOT) {
    cuts.push(c)
    continue
  }
  // Split into near-equal shots, each under MAX_SHOT.
  const pieces = Math.ceil(span / MAX_SHOT)
  let from = c.srcStart
  for (let p = 1; p <= pieces; p++) {
    const target = c.srcStart + (span * p) / pieces
    const at =
      p === pieces ? c.srcEnd : (nearestBoundary(target, from + 0.7, c.srcEnd - 0.7) ?? target)
    cuts.push({ srcStart: from, srcEnd: at, kind: p === 1 ? c.kind : 'punch' })
    from = at
  }
}

// Snap to whole frames so no cut lands mid-frame, and lay them end to end.
let outCursor = 0
for (const [i, c] of cuts.entries()) {
  c.srcStartFrame = Math.round(c.srcStart * FPS)
  c.srcEndFrame = Math.round(c.srcEnd * FPS)
  c.durationInFrames = c.srcEndFrame - c.srcStartFrame
  c.fromFrame = outCursor
  c.framing = FRAMINGS[i % FRAMINGS.length]
  outCursor += c.durationInFrames
}
const totalFrames = outCursor

/** Source seconds -> output seconds. Returns null for time inside a removed pause. */
function toOut(srcTime) {
  for (const c of cuts) {
    if (srcTime >= c.srcStartFrame / FPS && srcTime <= c.srcEndFrame / FPS) {
      return c.fromFrame / FPS + (srcTime - c.srcStartFrame / FPS)
    }
  }
  return null
}

/** Same, but a time inside a removed pause snaps to the next cut's first frame. */
function toOutSnapped(srcTime) {
  const exact = toOut(srcTime)
  if (exact !== null) return exact
  for (const c of cuts) {
    if (srcTime < c.srcStartFrame / FPS) return c.fromFrame / FPS
  }
  return totalFrames / FPS
}

const outWords = words.map((w) => ({
  word: w.word,
  start: toOutSnapped(w.start),
  end: toOutSnapped(w.end),
}))

const outSegments = transcript.segments.map((s) => ({
  text: s.text.trim(),
  start: toOutSnapped(s.start),
  end: toOutSnapped(s.end),
}))

const plan = {
  fps: FPS,
  totalFrames,
  totalSeconds: +(totalFrames / FPS).toFixed(3),
  sourceSeconds: SRC_DURATION,
  savedSeconds: +(SRC_DURATION - totalFrames / FPS).toFixed(3),
  cuts,
  words: outWords,
  segments: outSegments,
}

writeFileSync(resolve(ROOT, 'src/flywheel/data/plan.json'), JSON.stringify(plan, null, 2))

console.log(`${cuts.length} cuts`)
console.log(`${SRC_DURATION.toFixed(1)}s -> ${plan.totalSeconds}s (saved ${plan.savedSeconds}s)`)
console.log(`${totalFrames} frames at ${FPS}fps`)
const lens = cuts.map((c) => c.durationInFrames / FPS)
console.log(
  `shots: ${cuts.filter((c) => c.kind === 'pause').length} pause, ` +
    `${cuts.filter((c) => c.kind === 'punch').length} punch`,
)
console.log(
  `shot length: min ${Math.min(...lens).toFixed(2)}s  ` +
    `mean ${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(2)}s  ` +
    `max ${Math.max(...lens).toFixed(2)}s`,
)
console.log('\ncut  out       src            len   scale  kind')
for (const [i, c] of cuts.entries()) {
  console.log(
    String(i).padStart(3),
    (c.fromFrame / FPS).toFixed(2).padStart(6),
    `${(c.srcStartFrame / FPS).toFixed(2)}-${(c.srcEndFrame / FPS).toFixed(2)}`.padStart(13),
    `${(c.durationInFrames / FPS).toFixed(2)}s`.padStart(7),
    c.framing.scale.toFixed(2).padStart(6),
    ' ' + c.kind,
  )
}
