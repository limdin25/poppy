// make-ambience.mjs: build the pool of ambient beds.
//
//   cd /Users/hugo/Whats/Poppy/video && node scripts/make-ambience.mjs
//
// Called automatically by ingest-sources.mjs, so you rarely run this by hand.
// Idempotent: existing beds are kept. --force rebuilds them.
//
// WHY THESE ARE GENERATED AND NOT DOWNLOADED, which is the whole design decision.
//
// The obvious route is a royalty-free sound library: Freesound, Pixabay, an
// ElevenLabs sound-effects call. All three work and all three are the wrong
// answer here, for one reason: a library gives you a FIXED SET of recordings. A
// thousand videos sharing twenty ambient loops means fifty videos each carrying
// a byte-for-byte identical, trivially fingerprintable audio signature that is
// present in no other account's content. That is not camouflage, it is a
// tracking beacon, and it would be a stronger cluster signal than the one it was
// added to hide.
//
// Generated noise has no such set. Every bed is a different realisation of a
// random process, so no two share a sample. It is also free, offline, instant,
// carries no licence or attribution obligation, and works on a VPS with no
// network. There is nothing a library does better for this job.
//
// (If real recorded room tone is ever wanted for its own sake rather than for
// camouflage, Pixabay's audio API is the one to use: permissive licence, no
// attribution required. But that is a creative choice, not this.)
//
// WHAT IT IS: brown noise for the deep end, the sort of thing a room and an air
// system make, plus a quiet band-limited pink layer for air, decorrelated across
// the two channels so it reads as space rather than as hiss in the middle of
// your head, with a very slow amplitude drift so it is not perfectly stationary.
// Levelled to a known loudness so the per-variant gain is predictable.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(VIDEO_DIR, 'public', 'ambience');

/**
 * How many beds, and how long each one is.
 *
 * Must match AMBIENCE_COUNT and AMBIENCE_SECONDS in src/variants/recipe.ts.
 * A test fails if they drift, because a variant asking for bed 24 of 20 would
 * render silently without one.
 *
 * 180 seconds is comfortably longer than any output plus the largest start
 * offset, so the bed never has to loop. A loop point is an audible artefact and,
 * worse, a periodic one.
 */
export const COUNT = 20;
export const SECONDS = 180;

const force = process.argv.includes('--force');

/** Deterministic per-bed parameters. Same bed index, same bed, on any machine. */
function params(i) {
  // A small integer hash, so the beds differ from each other in more than seed.
  const h = (n) => ((i + 1) * 2654435761 + n * 40503) >>> 0;
  const pick = (n, lo, hi) => lo + ((h(n) % 1000) / 1000) * (hi - lo);
  return {
    seedL: h(1) % 2147483647,
    seedR: h(2) % 2147483647,
    seedP: h(3) % 2147483647,
    // The deep end rolls off somewhere between a closed room and an open one.
    lowpass: Math.round(pick(4, 900, 2600)),
    // The air layer sits in a different band on every bed.
    airLow: Math.round(pick(5, 700, 1800)),
    airHigh: Math.round(pick(6, 3200, 7000)),
    airLevel: pick(7, 0.18, 0.42).toFixed(3),
    // Slow drift. 0.1Hz is the floor ffmpeg's tremolo accepts, and anything
    // faster than about a third of a hertz starts to be audible as pulsing.
    driftHz: pick(8, 0.1, 0.31).toFixed(3),
    driftDepth: pick(9, 0.12, 0.3).toFixed(3),
  };
}

function build(i) {
  const p = params(i);
  const out = join(OUT_DIR, `amb-${String(i).padStart(2, '0')}.m4a`);
  const src = (color, amp, seed) =>
    `anoisesrc=color=${color}:sample_rate=48000:amplitude=${amp}:duration=${SECONDS}:seed=${seed}`;

  const args = [
    '-y',
    '-f', 'lavfi', '-i', src('brown', 0.5, p.seedL),
    '-f', 'lavfi', '-i', src('brown', 0.5, p.seedR),
    '-f', 'lavfi', '-i', src('pink', 0.2, p.seedP),
    '-filter_complex',
    [
      // Two independent brown sources joined into a genuine stereo pair. One
      // mono source panned to both channels sounds like a fault, not a room.
      `[0:a]highpass=f=28,lowpass=f=${p.lowpass}[bl]`,
      `[1:a]highpass=f=28,lowpass=f=${p.lowpass}[br]`,
      `[bl][br]join=inputs=2:channel_layout=stereo[bed]`,
      `[2:a]highpass=f=${p.airLow},lowpass=f=${p.airHigh},volume=${p.airLevel},aformat=channel_layouts=stereo[air]`,
      `[bed][air]amix=inputs=2:duration=shortest:normalize=0,` +
        `tremolo=f=${p.driftHz}:d=${p.driftDepth},` +
        // Levelled to a known loudness so the gain applied per variant means the
        // same thing on every bed. Single pass is approximate and that is fine:
        // this is 50dB under the voice either way.
        // TP has a hard range of [-9, 0] in ffmpeg's loudnorm. It is a true-peak
        // ceiling, not the working level; the integrated target I is what sets
        // how loud the bed actually is.
        `loudnorm=I=-30:TP=-9:LRA=9,` +
        `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[out]`,
    ].join(';'),
    '-map', '[out]',
    '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    out,
  ];

  try {
    execFileSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    if (existsSync(out)) rmSync(out);
    throw new Error(`ffmpeg failed on bed ${i}: ${e.stderr?.slice(-1500) ?? e.message}`);
  }
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });

let built = 0;
for (let i = 0; i < COUNT; i++) {
  const out = join(OUT_DIR, `amb-${String(i).padStart(2, '0')}.m4a`);
  if (!force && existsSync(out) && statSync(out).size > 0) continue;
  build(i);
  built += 1;
  process.stdout.write(`${built === 1 ? 'building ambience ' : ''}.`);
}
if (built) process.stdout.write('\n');

const have = readdirSync(OUT_DIR).filter((f) => /^amb-\d\d\.m4a$/.test(f));
if (have.length < COUNT) {
  throw new Error(`expected ${COUNT} beds, found ${have.length}`);
}
console.log(`ambience: ${have.length} beds ready${built ? ` (${built} new)` : ''}`);
