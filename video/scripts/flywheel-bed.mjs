/**
 * Build the background bed for the Flywheel VSL.
 *
 *   cd video && node scripts/flywheel-bed.mjs [--force]
 *
 * WHY THIS IS SYNTHESISED RATHER THAN DOWNLOADED.
 *
 * A sales video that gets posted, embedded and re-uploaded needs a bed whose
 * licence nobody ever has to argue about. Every free-music route carries a
 * condition: attribution, a non-commercial clause, or a licence that a content
 * ID system will still flag on someone else's upload. Generating it means the
 * file is ours outright, with nothing to attribute and nothing to claim.
 *
 * It is also the only option available here. The image model does not make
 * audio, and the speech model refuses music in as many words.
 *
 * WHAT IT IS: a four chord loop in A minor, played as soft sine pads with a slow
 * attack, heavily low-passed and drowned in reverb so it reads as atmosphere
 * rather than as a tune. Nothing above ~1.6kHz, which is exactly where the
 * voice lives, so the bed never competes for the words. Levelled to a known
 * loudness so the gain in the composition is predictable.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(VIDEO_DIR, 'public', 'flywheel')
const OUT = join(OUT_DIR, 'bed.mp3')
const TMP = join(VIDEO_DIR, 'out', 'bed-tmp')

const force = process.argv.includes('--force')
if (existsSync(OUT) && !force) {
  console.log('bed.mp3 exists, pass --force to rebuild')
  process.exit(0)
}

/** Seconds per chord. Slow: a fast progression under a voice reads as agitation. */
const BAR = 4.8
/**
 * Loops. Do NOT compute the final length from BAR x chords x LOOPS: each
 * crossfade SHORTENS the chain by its own duration, so the arithmetic answer is
 * about 20% long. The first build came out 59s when the formula said 75s. The
 * real duration is probed below and the tail fade is placed from that.
 */
const LOOPS = 5
/** The take this sits under. The bed only has to cover it. */
const TARGET = 74.2

/**
 * A minor, i - VI - III - VII. Voiced low and open, root plus fifth plus a
 * third up top. Minor because the script is about being on the wrong side of a
 * shift; it wants unease under it, not triumph.
 */
const CHORDS = [
  { name: 'Am', notes: [110.0, 164.81, 261.63] },
  { name: 'F', notes: [87.31, 130.81, 220.0] },
  { name: 'C', notes: [130.81, 196.0, 329.63] },
  { name: 'G', notes: [98.0, 146.83, 246.94] },
]

function ff(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: 'inherit' })
}

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })

// One file per chord. Each note is a sine detuned a few cents against a twin,
// which is what stops a pure tone sounding like a test signal.
CHORDS.forEach((chord, i) => {
  const inputs = []
  const filters = []
  let n = 0
  for (const f of chord.notes) {
    for (const cents of [-4, 4]) {
      const freq = f * Math.pow(2, cents / 1200)
      inputs.push('-f', 'lavfi', '-t', String(BAR), '-i', `sine=frequency=${freq.toFixed(3)}:sample_rate=48000`)
      // Top note quieter than the root, or the chord sounds thin and shrill.
      const gain = f > 200 ? 0.1 : 0.2
      filters.push(`[${n}:a]volume=${gain}[n${n}]`)
      n++
    }
  }
  const mix = Array.from({ length: n }, (_, k) => `[n${k}]`).join('')
  ff([
    ...inputs,
    '-filter_complex',
    `${filters.join(';')};${mix}amix=inputs=${n}:normalize=0[m];` +
      // Slow swell in and out so chords breathe into each other on the crossfade.
      `[m]afade=t=in:st=0:d=1.6:curve=qsin,afade=t=out:st=${(BAR - 1.6).toFixed(2)}:d=1.6:curve=qsin[o]`,
    '-map', '[o]', '-ac', '2', join(TMP, `c${i}.wav`),
  ])
})

// Chain the four chords with long crossfades, then loop the result.
let prev = join(TMP, 'c0.wav')
for (let i = 1; i < CHORDS.length; i++) {
  const out = join(TMP, `seq${i}.wav`)
  ff(['-i', prev, '-i', join(TMP, `c${i}.wav`),
      '-filter_complex', '[0:a][1:a]acrossfade=d=1.4:c1=tri:c2=tri[o]', '-map', '[o]', out])
  prev = out
}

// Loop and shape, but do NOT fade yet: the length is not known until it exists.
const looped = join(TMP, 'looped.wav')
ff([
  '-stream_loop', String(LOOPS - 1), '-i', prev,
  '-filter_complex',
  // Roll everything off well below the voice, add a long tail so it sits behind
  // the picture rather than on top of it, then level it to a known loudness.
  'lowpass=f=1600:poles=2,' +
    'aecho=0.8:0.9:180|340|620:0.35|0.24|0.15,' +
    'lowpass=f=1400:poles=2,' +
    'loudnorm=I=-30:TP=-6:LRA=7',
  '-ac', '2', '-ar', '48000', looped,
])

function seconds(file) {
  return +execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]).toString().trim()
}

const raw = seconds(looped)
if (raw < TARGET) {
  console.warn(`WARNING: bed is ${raw.toFixed(2)}s, short of the ${TARGET}s take. Raise LOOPS.`)
}
const end = Math.min(raw, TARGET)

// Trim to the take and place the tail fade against the real length.
ff([
  '-i', looped, '-t', String(end),
  '-af', `afade=t=in:st=0:d=2.5,afade=t=out:st=${(end - 3).toFixed(2)}:d=3`,
  '-ac', '2', '-ar', '48000', '-b:a', '192k', OUT,
])

rmSync(TMP, { recursive: true, force: true })

console.log(`wrote ${OUT}`)
console.log(`${seconds(OUT).toFixed(2)}s (from ${raw.toFixed(2)}s of loop), ` +
  `${CHORDS.map((c) => c.name).join(' ')} x${LOOPS}`)
