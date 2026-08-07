// render-variants.mjs: the batch renderer.
//
//   cd /Users/hugo/Whats/Poppy/video && node scripts/render-variants.mjs --count=4
//   node scripts/render-variants.mjs --only=v2-0000 --batch=smoke
//   node scripts/render-variants.mjs --count=250 --batch=b002
//
// --count is PER SOURCE, so --count=4 renders 16 files.
//
// Ctrl-C safe and re-runnable: a job whose output already exists is skipped, so
// restarting resumes where it stopped. That one line is the whole of the crash
// recovery a single-box content pipeline needs, and it is why there is no
// Supabase queue here yet. The job record is shaped like a database row on
// purpose, so adding the queue later is a copy rather than a redesign, but that
// only earns its keep when there is a second render box to fan out to.
//
// Uses @remotion/renderer directly with ONE bundle and ONE browser for the whole
// batch, recycled periodically. That is about 14 percent faster than spawning
// `npx remotion render` per file, but the real reasons are a live progress line,
// no shell quoting, and sharing the harness with contact-sheet.mjs.

import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = JSON.parse(readFileSync(join(VIDEO_DIR, 'src', 'variants', 'sources.json'), 'utf8'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const COUNT = Number(arg('count', 4));
const BATCH = arg('batch', 'b001');
const ONLY = arg('only', null);
const CONCURRENCY = Number(arg('concurrency', 8));
// Must match RECIPE_VERSION in src/variants/recipe.ts. They are two files that
// have to agree, so plan.test.ts reads this line and fails if they drift: a
// mismatch would render every file against a different seed than the one the
// plan and the test suite believe in, silently.
const RECIPE_VERSION = Number(arg('recipeVersion', 8));
const CTA_FRAMES = 300;
const RECYCLE_EVERY = 50;

const JOB_DIR = join(VIDEO_DIR, 'jobs', BATCH);
const OUT_DIR = join(VIDEO_DIR, 'out', 'variants', BATCH);
mkdirSync(JOB_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

/** Same FNV-1a as recipe.ts. Duplicated because this file is plain node. */
function seedFor(sourceId, variantIndex, recipeVersion) {
  const key = `${recipeVersion}|${sourceId}|${variantIndex}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const jobs = [];
for (const src of SOURCES) {
  for (let i = 0; i < COUNT; i++) {
    const seed = seedFor(src.id, i, RECIPE_VERSION);
    const hex = seed.toString(16).padStart(8, '0');
    const name = `${src.id}-${String(i).padStart(4, '0')}-${hex}`;
    if (ONLY && !name.startsWith(ONLY)) continue;
    jobs.push({
      name,
      sourceId: src.id,
      variantIndex: i,
      seed,
      seedHex: hex,
      props: { sourceId: src.id, variantIndex: i, seed, recipeVersion: RECIPE_VERSION },
      propsPath: join(JOB_DIR, `${name}.json`),
      out: join(OUT_DIR, `${name}.mp4`),
      sidecar: join(OUT_DIR, `${name}.json`),
    });
  }
}

if (jobs.length === 0) {
  console.error(ONLY ? `no job matches --only=${ONLY}` : 'no jobs');
  process.exit(1);
}

console.log(`${jobs.length} jobs -> ${OUT_DIR}`);
console.log('bundling ...');
const serveUrl = await bundle({ entryPoint: join(VIDEO_DIR, 'src', 'index.ts') });
await ensureBrowser();

function probe(file) {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(raw);
}

/**
 * Structural checks on every finished file.
 *
 * nb_frames EXACT, with no tolerance, is the important one. It proves
 * calculateMetadata ran, that inputProps actually arrived, and that the seeded
 * head trim was applied. This project had no inputProps plumbing before, so
 * "props silently never reach the composition" is the single most likely serious
 * failure, and every file would then come back at the defaultProps length.
 */
function verify(job, expectedFrames) {
  const p = probe(job.out);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  const errs = [];

  if (!v) errs.push('no video stream');
  else {
    if (v.codec_name !== 'h264') errs.push(`codec ${v.codec_name}`);
    if (Number(v.width) !== 1080 || Number(v.height) !== 1920) {
      errs.push(`${v.width}x${v.height}`);
    }
    if (v.pix_fmt !== 'yuv420p') errs.push(`pix_fmt ${v.pix_fmt}`);
    if (v.r_frame_rate !== '30/1') errs.push(`fps ${v.r_frame_rate}`);
    const frames = Number(v.nb_read_frames ?? v.nb_frames);
    if (frames !== expectedFrames) errs.push(`frames ${frames}, expected ${expectedFrames}`);
  }

  if (!a) errs.push('no audio stream');
  else {
    if (a.codec_name !== 'aac') errs.push(`audio codec ${a.codec_name}`);
    if (Number(a.sample_rate) !== 48000) errs.push(`sample rate ${a.sample_rate}`);
    if (Number(a.channels) !== 2) errs.push(`channels ${a.channels}`);
  }

  if (Number(p.format.nb_streams) !== 2) errs.push(`nb_streams ${p.format.nb_streams}`);
  const comment = p.format.tags?.comment ?? '';
  if (!comment.includes(`seed=${job.seedHex}`)) errs.push('metadata comment missing the seed');

  const mb = statSync(job.out).size / 1e6;
  if (mb < 1 || mb > 80) errs.push(`size ${mb.toFixed(1)}MB`);

  return { errs, probe: p, sizeMb: Number(mb.toFixed(2)) };
}

/**
 * Two content checks ffprobe cannot make.
 *
 * Together they catch a fully muted render, which passes every structural check
 * above and is otherwise invisible until somebody watches the file.
 */
function verifyAudio(job, bodySeconds) {
  const errs = [];

  // Both of these measurements are written to STDERR at INFO level. The first
  // version of this check passed `-v error`, which suppressed the very lines it
  // was looking for, and then read stdout, which is empty. It reported "could
  // not measure" on a perfectly good file.
  const ff = (args) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'info', ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return `${r.stderr ?? ''}${r.stdout ?? ''}`;
  };

  // The body must not be silent. Catches a fully muted render, which passes
  // every structural check and is invisible until somebody plays the file.
  const head = ff(['-i', job.out, '-t', '5', '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = head.match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (!mean) errs.push('could not measure body loudness');
  else if (Number(mean[1]) < -50) errs.push(`body audio is silent (${mean[1]} dB)`);

  // The end card must be far quieter than the body, which proves it is there and
  // that the body did not overrun into it.
  //
  // This used to assert DIGITAL silence, and that stopped being true when every
  // video gained an ambient bed running under the end card. A relative check is
  // the better test anyway: what actually matters is that the voice stopped, not
  // that the file contains literal zeroes. It would still catch a body that ran
  // long, which is the failure the check exists for.
  const tail = ff([
    '-ss', String(bodySeconds + 1), '-i', job.out,
    '-t', '6', '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const tailMean = tail.match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (!tailMean) errs.push('could not measure end card loudness');
  else if (mean && Number(tailMean[1]) > Number(mean[1]) - 20) {
    errs.push(`end card is only ${(Number(mean[1]) - Number(tailMean[1])).toFixed(1)}dB below the body`);
  }

  return errs;
}

const browser = { instance: await openBrowser('chrome', { chromeMode: 'headless-shell' }) };
let sinceRecycle = 0;
const done = [];
const failed = [];

try {
  for (let n = 0; n < jobs.length; n++) {
    const job = jobs[n];
    const tag = `[${n + 1}/${jobs.length}] ${job.name}`;

    if (existsSync(job.out) && statSync(job.out).size > 0) {
      console.log(`${tag} already rendered, skipping`);
      done.push(job);
      continue;
    }

    // A long-lived browser leaks over hundreds of renders. Recycling costs about
    // four seconds per fifty jobs and converts a class of hour-three
    // out-of-memory crashes into nothing.
    if (sinceRecycle >= RECYCLE_EVERY) {
      await browser.instance.close({ silent: true });
      browser.instance = await openBrowser('chrome', { chromeMode: 'headless-shell' });
      sinceRecycle = 0;
    }

    // The props file sitting next to the output IS the bug report. "Variant 47
    // looks wrong" becomes one command with nothing to reconstruct.
    writeFileSync(job.propsPath, `${JSON.stringify(job.props, null, 2)}\n`);

    job.stage = 'select';
    try {
      const composition = await selectComposition({
        serveUrl,
        id: 'VariantVideo',
        inputProps: job.props,
        puppeteerInstance: browser.instance,
      });

      job.stage = 'render';
      let last = -1;
      await renderMedia({
        composition,
        serveUrl,
        outputLocation: job.out,
        inputProps: job.props,
        puppeteerInstance: browser.instance,
        codec: 'h264',
        // Explicit, so a future edit to remotion.config.ts for the VSL pipeline
        // cannot silently change what this batch produces.
        crf: 18,
        x264Preset: 'medium',
        pixelFormat: 'yuv420p',
        colorSpace: 'bt709',
        imageFormat: 'jpeg',
        // Remotion defaults to 80. The source is already lossy and gets
        // screenshotted before x264, and at 80 that second round of 4:2:0
        // subsampling puts visible ringing on any text inside the video.
        jpegQuality: 95,
        audioCodec: 'aac',
        audioBitrate: '128k',
        enforceAudioTrack: true,
        concurrency: CONCURRENCY,
        // The default is half of system RAM, which is the likeliest cause of an
        // out-of-memory kill three hours into a long batch.
        offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
        metadata: {
          comment: `seed=${job.seedHex} src=${job.sourceId} idx=${job.variantIndex} recipe=${RECIPE_VERSION}`,
        },
        onProgress: ({ progress }) => {
          const pct = Math.round(progress * 100);
          if (pct !== last && pct % 10 === 0) {
            process.stdout.write(`\r${tag} ${pct}%   `);
            last = pct;
          }
        },
      });
      process.stdout.write(`\r${tag} rendered   `);

      job.stage = 'probe';
      const expected = composition.durationInFrames;
      const { errs, sizeMb } = verify(job, expected);
      const audioErrs = verifyAudio(job, (expected - CTA_FRAMES) / 30);
      const all = [...errs, ...audioErrs];

      if (all.length > 0) {
        // A bad file must never reach an upload. Deleting it also means a re-run
        // retries this job instead of skipping it as already done.
        rmSync(job.out, { force: true });
        throw new Error(all.join('; '));
      }

      writeFileSync(
        job.sidecar,
        `${JSON.stringify(
          { ...job.props, name: job.name, frames: expected, sizeMb, batch: BATCH },
          null,
          2,
        )}\n`,
      );
      console.log(`\r${tag} ok  ${expected}f  ${sizeMb}MB`);
      done.push(job);
      sinceRecycle += 1;
    } catch (e) {
      console.log(`\r${tag} FAILED at ${job.stage}: ${e.message}`);
      failed.push({ name: job.name, stage: job.stage, error: e.message });
    }
  }
} finally {
  await browser.instance.close({ silent: true });
}

// --- the batch-wide distinctness check ---------------------------------------
//
// This is the essential one. Before this batch, nothing in the project passed
// inputProps to a composition at all, so "props never arrive and all N variants
// render identically" is by far the likeliest serious failure. A thousand
// identical files pass every per-file check above. Hashing one frame from each
// is what catches it.
if (done.length > 1) {
  console.log('\nchecking that every output is genuinely different ...');
  const seen = new Map();
  const dupes = [];
  for (const job of done) {
    const png = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', job.out, '-vf', 'select=eq(n\\,150)', '-vframes', '1',
        '-f', 'image2pipe', '-vcodec', 'png', '-'],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const h = createHash('sha256').update(png).digest('hex').slice(0, 16);
    if (seen.has(h)) dupes.push(`${job.name} is identical to ${seen.get(h)}`);
    else seen.set(h, job.name);
  }
  if (dupes.length > 0) {
    console.error('\nBATCH VOID, identical frames found:');
    for (const d of dupes) console.error(`  ${d}`);
    process.exit(1);
  }
  console.log(`all ${done.length} outputs have distinct frames`);
}

console.log(`\n${done.length} rendered, ${failed.length} failed`);
for (const f of failed) console.log(`  ${f.name}  [${f.stage}]  ${f.error}`);
process.exit(failed.length > 0 ? 1 : 0);
