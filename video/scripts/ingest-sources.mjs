// ingest-sources.mjs: turn ANY video dropped in a folder into a render source.
//
//   cd /Users/hugo/Whats/Poppy/video
//   node scripts/ingest-sources.mjs
//
// Drop files into video/sources-in/ and run this. Nothing else. No editing, no
// per-file config, no code change. If that folder is empty it falls back to the
// four HeyPubli landing page demos, which is what the factory started on.
//
// Idempotent: anything already built is skipped, so re-running after adding one
// new file only processes that file. --force rebuilds everything.
//
// EACH SOURCE PRODUCES TWO FILES, and the reason is the whole quality argument.
//
//   {id}.mp4       720x1280   plays inside the phone, 1:1 with SCREEN, no resample
//   {id}-full.mp4  1080x1920  plays full bleed before the shrink
//
// The video opens filling the whole canvas and then shrinks into the phone. Full
// bleed on a 1080x1920 canvas needs 1080x1920 pixels, and the demos are 720x1280,
// so that segment is upscaled 1.5x. There is no way around that short of higher
// resolution sources. What we CAN control is where the upscale happens: once,
// here, with lanczos at crf 14, instead of every frame inside a headless browser
// at whatever quality its compositor feels like. The phone segment then switches
// to the 720 file and is untouched, exactly as before.
//
// WHY NORMALISE AT ALL, given these already play fine on the web:
//
//   1. Mixed frame rates. v2 arrives at 24fps and the rest at 30. OffthreadVideo
//      resamples 24 into 30 by nearest timestamp, duplicating on a 1,1,1,1,2
//      pattern that reads as judder on any motion.
//   2. Three different audio sample rates (32k, 44.1k, 48k) and all four mono.
//      One set of audio parameters is what lets the output checks be exact.
//   3. Sparse keyframes make seeking expensive. A one second GOP turns an
//      OffthreadVideo seek from "decode up to 300 frames" into "decode a few".
//   4. crf 16 means the final encode is not compounding on a 700kbps source.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(VIDEO_DIR, '..');
const DROP_DIR = join(VIDEO_DIR, 'sources-in');
const FALLBACK_DIR = join(REPO, 'heypubli', 'public', 'demos');
const OUT_DIR = join(VIDEO_DIR, 'public', 'sources');
const MANIFEST = join(VIDEO_DIR, 'src', 'variants', 'sources.json');

const FPS = 30;
const PHONE_W = 720;
const PHONE_H = 1280;
const FULL_W = 1080;
const FULL_H = 1920;
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

const force = process.argv.includes('--force');

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * ffmpeg writes its analysis filters to STDERR at INFO level. Passing `-v error`
 * suppresses the very lines being parsed, which once produced a beat list that
 * was silently always empty.
 */
function ffAnalyse(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'info', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${r.stderr ?? ''}${r.stdout ?? ''}`;
}

function probe(file) {
  const j = JSON.parse(
    run('ffprobe', [
      '-v', 'error',
      '-count_frames',
      '-show_streams', '-show_format',
      '-of', 'json',
      file,
    ]),
  );
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`${basename(file)} has no video stream`);
  const [num, den] = String(v.r_frame_rate).split('/');
  return {
    frames: Number(v.nb_read_frames ?? v.nb_frames),
    fps: Number(num) / Number(den || 1),
    width: Number(v.width),
    height: Number(v.height),
    duration: Number(j.format.duration),
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

/**
 * A filename becomes a stable id. Stable matters more than pretty: the id is
 * folded into every seed, so renaming a dropped file re-rolls all of its
 * variants. Rename before the first render, never after.
 */
function slugify(name) {
  const s = basename(name, extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'clip';
}

/**
 * Where a cut would feel natural, in frames.
 *
 * The brief was "feel out the rhythm of each clip and drop it naturally", and
 * this is what that means concretely. Two independent signals, unioned:
 *
 *   picture  a scene change, which is a hard visual boundary
 *   sound    the start and the end of a phrase, which is where a human editor
 *            cuts because cutting mid-word sounds broken
 *
 * Neither is trusted on its own and neither has to be complete. recipe.ts picks
 * a seeded target around 9 to 10 seconds and snaps to the nearest of these if
 * one is close, so an empty list simply means the drop lands on the seeded
 * target instead. A clip with no detectable rhythm still works.
 */
function detectBeats(file, frames) {
  const beats = new Set();

  const scenes = ffAnalyse([
    '-i', file,
    // 0.08, not the 0.18 you would pick for hard cut detection. These are
    // candidate cut points, not a shot list: the recipe snaps to the NEAREST one
    // within 1.5s of its seeded target, so a soft candidate costs nothing and a
    // missing one costs a natural landing. Measured on the four demos, 0.18
    // found nothing at all in the target window for two of them, while 0.08
    // found eight and two.
    '-filter:v', "select='gt(scene,0.08)',showinfo",
    '-an', '-f', 'null', '-',
  ]);
  for (const m of scenes.matchAll(/pts_time:([\d.]+)/g)) {
    beats.add(Math.round(Number(m[1]) * FPS));
  }

  const speech = ffAnalyse([
    '-i', file,
    '-af', 'silencedetect=noise=-32dB:d=0.20',
    '-vn', '-f', 'null', '-',
  ]);
  for (const m of speech.matchAll(/silence_(?:start|end):\s*(-?[\d.]+)/g)) {
    const f = Math.round(Number(m[1]) * FPS);
    if (f > 0) beats.add(f);
  }

  return [...beats].filter((f) => f > 0 && f < frames).sort((a, b) => a - b);
}

function encode(src, out, w, h, crf, hasAudio) {
  const args = ['-y', '-i', src];
  // A source with no audio still has to come out with a track, or the phone
  // segment and the full-bleed segment disagree about stream layout.
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest');
  args.push(
    // force_original_aspect_ratio=increase then crop means a 16:9 or square
    // drop-in is centre-cropped to vertical rather than letterboxed. For a
    // source that is already 9:16 the scale is exact and the crop does nothing,
    // so the 720 output stays a true 1:1 map of the original pixels.
    '-vf', `fps=${FPS},scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-g', String(FPS), '-keyint_min', String(FPS), '-sc_threshold', '0',
  );
  if (hasAudio) {
    // pan BEFORE aresample, and no soxr. The obvious order fails: a mono source
    // means aresample cannot configure an output pad for a later stereo stage
    // and dies with a bare "Invalid argument". And resampler=soxr is missing
    // from plenty of ffmpeg builds, including the Mac homebrew one here.
    args.push('-af', 'pan=stereo|c0=c0|c1=c0,aresample=48000');
  }
  args.push(
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    out,
  );
  try {
    run('ffmpeg', args);
  } catch (e) {
    // Never leave a partial file for the next run to mistake for a finished one.
    if (existsSync(out)) rmSync(out);
    throw new Error(`ffmpeg failed on ${basename(out)}: ${e.stderr?.slice(-2000) ?? e.message}`);
  }
}

// --- pick up the inputs -------------------------------------------------------

mkdirSync(DROP_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// Per-clip decisions a human made last time, carried forward. Regenerating the
// manifest must not silently undo "this clip has words on screen, never mirror
// it", or the next batch of a thousand ships back-to-front text.
const previous = new Map();
if (existsSync(MANIFEST)) {
  try {
    for (const s of JSON.parse(readFileSync(MANIFEST, 'utf8'))) {
      if (typeof s?.id === 'string') previous.set(s.id, s);
    }
  } catch {
    // A corrupt manifest is not a reason to refuse to rebuild it.
  }
}

const dropped = readdirSync(DROP_DIR)
  .filter((f) => VIDEO_EXT.has(extname(f).toLowerCase()))
  .sort()
  .map((f) => ({ id: slugify(f), src: join(DROP_DIR, f) }));

const inputs = dropped.length
  ? dropped
  : ['v1', 'v2', 'v3', 'v4'].map((id) => ({ id, src: join(FALLBACK_DIR, `${id}.mp4`) }));

if (!dropped.length) {
  console.log(`sources-in/ is empty, using the four landing page demos.`);
  console.log(`Drop any .mp4 into ${DROP_DIR} to add your own.\n`);
}

const seen = new Set();
for (const i of inputs) {
  if (seen.has(i.id)) throw new Error(`two dropped files slug to the same id "${i.id}"`);
  seen.add(i.id);
  if (!existsSync(i.src)) throw new Error(`missing source: ${i.src}`);
}

// --- build --------------------------------------------------------------------

const manifest = [];
for (const { id, src } of inputs) {
  const phone = join(OUT_DIR, `${id}.mp4`);
  const full = join(OUT_DIR, `${id}-full.mp4`);

  // A zero byte file is a crashed previous run, not a finished one. Without this
  // the skip below accepts it and every later step fails somewhere less obvious.
  const built = (f) => existsSync(f) && statSync(f).size > 0;

  if (force || !built(phone) || !built(full)) {
    const meta = probe(src);
    process.stdout.write(`${id}: ${meta.width}x${meta.height} @${meta.fps.toFixed(2)}fps`);
    if (!meta.hasAudio) process.stdout.write(' (silent)');
    process.stdout.write(' ... ');
    encode(src, phone, PHONE_W, PHONE_H, 16, meta.hasAudio);
    encode(src, full, FULL_W, FULL_H, 14, meta.hasAudio);
    process.stdout.write('encoded ... ');
  } else {
    process.stdout.write(`${id}: already built ... `);
  }

  const p = probe(phone);
  const f = probe(full);
  if (p.width !== PHONE_W || p.height !== PHONE_H) {
    throw new Error(`${id}: expected ${PHONE_W}x${PHONE_H}, got ${p.width}x${p.height}`);
  }
  if (f.width !== FULL_W || f.height !== FULL_H) {
    throw new Error(`${id}: expected ${FULL_W}x${FULL_H}, got ${f.width}x${f.height}`);
  }
  if (p.fps !== FPS) throw new Error(`${id}: expected ${FPS}fps, got ${p.fps}`);
  // The two twins must agree frame for frame, because the composition swaps from
  // one to the other mid-shot and a one frame difference is a visible jump.
  if (p.frames !== f.frames) {
    throw new Error(`${id}: twins disagree, ${p.frames} phone frames vs ${f.frames} full frames`);
  }

  const beats = detectBeats(phone, p.frames);
  // Mirroring is the cheapest anti-cluster lever there is and it is free, but
  // only a human can say whether THIS clip survives it, so it DEFAULTS TO OFF.
  //
  // That default used to be on, and checking the four demos is what changed it:
  // three of the four cannot be mirrored. v1 holds a bottle whose label reads
  // "Lymphatic drainage", v2 holds a branded sachet, v3 carries burned-in
  // captions. A backwards product label on a video whose whole pitch is that AI
  // video looks real is worse than any amount of clustering, and real product
  // footage nearly always has a label, a logo or a caption in it somewhere.
  //
  // So: fail safe, and switch it on per clip once somebody has actually watched
  // the clip through. The value then sticks through every later run.
  const allowFlip = previous.get(id)?.allowFlip ?? false;
  manifest.push({
    id,
    file: `sources/${id}.mp4`,
    fullFile: `sources/${id}-full.mp4`,
    frames: p.frames,
    fps: p.fps,
    allowFlip,
    beats,
  });
  console.log(
    `${p.frames} frames, ${p.duration.toFixed(2)}s, ${beats.length} beats${allowFlip ? '' : ', no mirror'}`,
  );
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nwrote ${MANIFEST}`);
console.log('frame counts are read back from the ENCODED files, never assumed.');
