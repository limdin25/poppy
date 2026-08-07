// creator-variants-worker.mjs: the render arm of the creator video pipeline.
//
// Hugo, 07 Aug 2026: "every account they have their own color... every account
// gets two videos per day... this has to be automated." The HeyPubli app
// (heypubli.com) queues one row per master video x creator in
// creator_video_renders; this worker drains that queue on Hugo's Mac, renders
// the account's uniquely-colored copy with the variants factory, uploads it to
// the public creator-videos bucket, and marks the row ready. The scheduling
// cron over in heypubli/app/api/cron/video-pipeline then turns ready renders
// into scheduled_posts.
//
// Modeled line-for-line on the two proven scripts:
//   - render-variants.mjs: the bundle-once + renderMedia harness and the
//     structural verify (frames exact, audio present, end card quieter).
//   - vsl-render-worker.mjs: the poll/claim/heartbeat/stale-requeue shape.
//
// Run it from video/:  node scripts/creator-variants-worker.mjs
// It is installed as a launchd job (com.heypubli.creator-variants) so it
// survives reboots. Logs: /tmp/creator-variants-worker.log
//
// UNIQUENESS MODEL. The composition derives every visual from
// (sourceId, variantIndex, recipeVersion); props.seed is recorded, not read.
// Each creator owns a permanent variant_idx (their enrolment ordinal), so
// creator 3's copy of every master is variant 3: same personal look across the
// sequence, different hooks/fonts/motion from everyone else, and colorFamily
// pins their personal palette family on top.

import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(VIDEO_DIR, 'out', 'creator');
mkdirSync(OUT_DIR, { recursive: true });

// ---- env: the HeyPubli project, read from the app's own .env.local ---------
// (same load-the-env-yourself rule as scripts/lib/line-status.mjs: a worker
// started by launchd has no shell profile, and failing open silently is worse
// than refusing to start.)
const envFile = join(VIDEO_DIR, '..', 'heypubli', '.env.local');
const env = {};
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
  if (m) env[m[1]] = m[2];
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in heypubli/.env.local');
  process.exit(1);
}

const POLL_MS = 30_000;
const STALE_MIN = 20;
const MAX_ATTEMPTS = 3;
const RECIPE_VERSION = 8;
const CONCURRENCY = 8;
const BUCKET = 'creator-videos';

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Same FNV-1a as recipe.ts / render-variants.mjs. */
function seedFor(sourceId, variantIndex, recipeVersion) {
  const key = `${recipeVersion}|${sourceId}|${variantIndex}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---- structural verify, shortened from render-variants.mjs -----------------
function verify(outPath, expectedFrames) {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', outPath],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const p = JSON.parse(raw);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  const errs = [];
  if (!v) errs.push('no video stream');
  else {
    if (v.codec_name !== 'h264') errs.push(`codec ${v.codec_name}`);
    if (Number(v.width) !== 1080 || Number(v.height) !== 1920) errs.push(`${v.width}x${v.height}`);
    const frames = Number(v.nb_read_frames ?? v.nb_frames);
    if (frames !== expectedFrames) errs.push(`frames ${frames}, expected ${expectedFrames}`);
  }
  if (!a) errs.push('no audio stream');
  const mb = statSync(outPath).size / 1e6;
  if (mb < 1 || mb > 80) errs.push(`size ${mb.toFixed(1)}MB`);
  return errs;
}

async function uploadToBucket(localPath, remotePath) {
  const body = readFileSync(localPath);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${remotePath}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'video/mp4',
        'x-upsert': 'true',
      },
      body,
    });
    if (res.ok) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${remotePath}`;
    log(`upload attempt ${attempt} failed: ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  throw new Error('upload failed after 3 attempts');
}

// ---- the render harness ----------------------------------------------------
let serveUrl = null;
let browser = null;
async function ensureHarness(rebundle = false) {
  if (rebundle) serveUrl = null;
  if (!serveUrl) {
    log('bundling ...');
    serveUrl = await bundle({ entryPoint: join(VIDEO_DIR, 'src', 'index.ts') });
    await ensureBrowser();
  }
  if (!browser) browser = await openBrowser('chrome', { chromeMode: 'headless-shell' });
}

async function renderOne(props, outPath) {
  await ensureHarness();
  const composition = await selectComposition({
    serveUrl,
    id: 'VariantVideo',
    inputProps: props,
    puppeteerInstance: browser,
  });
  await renderMedia({
    composition,
    serveUrl,
    outputLocation: outPath,
    inputProps: props,
    puppeteerInstance: browser,
    codec: 'h264',
    crf: 18,
    x264Preset: 'medium',
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    imageFormat: 'jpeg',
    jpegQuality: 95,
    audioCodec: 'aac',
    audioBitrate: '128k',
    enforceAudioTrack: true,
    concurrency: CONCURRENCY,
    offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
    metadata: {
      comment: `seed=${props.seed.toString(16).padStart(8, '0')} src=${props.sourceId} idx=${props.variantIndex} recipe=${props.recipeVersion} fam=${props.colorFamily ?? 'seeded'}`,
    },
  });
  const errs = verify(outPath, composition.durationInFrames);
  if (errs.length) throw new Error(`verify failed: ${errs.join('; ')}`);
}

// ---- master preview: an uploaded clip becomes a renderable source ----------
async function handleNewMasters() {
  const masters = await rest(
    `master_videos?status=eq.preview_rendering&source_url=not.is.null&select=*&order=created_at&limit=1`,
  );
  const m = masters?.[0];
  if (!m) return false;

  log(`ingesting master seq ${m.seq} (${m.source_id})`);
  const clipPath = join(VIDEO_DIR, 'sources-in', `${m.source_id}.mp4`);
  if (!existsSync(clipPath)) {
    const res = await fetch(m.source_url);
    if (!res.ok) throw new Error(`source download ${res.status}`);
    writeFileSync(clipPath, Buffer.from(await res.arrayBuffer()));
  }
  // ingest updates src/variants/sources.json, which SOURCE_IDS and the zod
  // schema derive from, so the bundle must be rebuilt afterwards.
  execFileSync('node', [join(VIDEO_DIR, 'scripts', 'ingest-sources.mjs')], {
    cwd: VIDEO_DIR,
    stdio: 'inherit',
  });
  execFileSync('node', [join(VIDEO_DIR, 'scripts', 'make-ambience.mjs')], {
    cwd: VIDEO_DIR,
    stdio: 'inherit',
  });
  await ensureHarness(true);

  const props = {
    sourceId: m.source_id,
    variantIndex: 0,
    seed: seedFor(m.source_id, 0, RECIPE_VERSION),
    recipeVersion: RECIPE_VERSION,
  };
  const out = join(OUT_DIR, `preview-${m.source_id}.mp4`);
  await renderOne(props, out);
  const url = await uploadToBucket(out, `previews/${m.source_id}.mp4`);
  await rest(`master_videos?id=eq.${m.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ preview_url: url, status: 'pending_approval' }),
    headers: { Prefer: 'return=minimal' },
  });
  log(`master seq ${m.seq} preview ready, waiting for Hugo's approval`);
  return true;
}

// ---- creator renders -------------------------------------------------------
async function requeueStale() {
  const cutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
  const stale = await rest(
    `creator_video_renders?status=eq.rendering&claimed_at=lt.${cutoff}&select=id,attempts`,
  );
  for (const r of stale ?? []) {
    const next = r.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
    await rest(`creator_video_renders?id=eq.${r.id}&status=eq.rendering`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: next,
        ...(next === 'failed' ? { error: `stale after ${r.attempts} attempts` } : {}),
      }),
      headers: { Prefer: 'return=minimal' },
    });
    log(`stale render ${r.id} -> ${next}`);
  }
}

async function claimOne() {
  const rows = await rest(
    `creator_video_renders?status=eq.queued&select=*,master:master_videos(seq,source_id,status)&order=created_at&limit=1`,
  );
  const r = rows?.[0];
  if (!r) return null;
  // Only approved masters render for creators; a queued row for an unapproved
  // master waits (the cron should not create those, this is the belt).
  if (r.master?.status !== 'approved') return null;
  const claimed = await rest(`creator_video_renders?id=eq.${r.id}&status=eq.queued`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'rendering',
      claimed_at: new Date().toISOString(),
      attempts: (r.attempts ?? 0) + 1,
    }),
    headers: { Prefer: 'return=representation' },
  });
  return claimed?.length ? { ...r, attempts: (r.attempts ?? 0) + 1 } : null;
}

async function renderClaimed(r) {
  const state = await rest(
    `creator_video_state?profile_id=eq.${r.profile_id}&select=variant_idx,color_family`,
  );
  const variantIndex = state?.[0]?.variant_idx ?? 0;
  const props = {
    sourceId: r.master.source_id,
    variantIndex,
    seed: seedFor(r.master.source_id, variantIndex, RECIPE_VERSION),
    recipeVersion: RECIPE_VERSION,
    colorFamily: r.color_family,
  };
  const out = join(OUT_DIR, `${r.id}.mp4`);
  log(`rendering master ${r.master.seq} for ${r.profile_id} (${r.color_family}, idx ${variantIndex})`);
  const t0 = Date.now();
  await renderOne(props, out);
  const url = await uploadToBucket(out, `renders/m${r.master.seq}-${r.profile_id}.mp4`);
  await rest(`creator_video_renders?id=eq.${r.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'ready',
      video_url: url,
      seed: String(props.seed),
      rendered_at: new Date().toISOString(),
      error: null,
    }),
    headers: { Prefer: 'return=minimal' },
  });
  log(`ready in ${Math.round((Date.now() - t0) / 1000)}s -> ${url}`);
}

async function heartbeat() {
  await rest(`video_pipeline_state?id=eq.default`, {
    method: 'PATCH',
    body: JSON.stringify({
      worker_last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    headers: { Prefer: 'return=minimal' },
  });
}

// ---- main loop -------------------------------------------------------------
log('creator variants worker up');
for (;;) {
  try {
    await heartbeat();
    await requeueStale();
    const didMaster = await handleNewMasters();
    if (!didMaster) {
      const r = await claimOne();
      if (r) {
        try {
          await renderClaimed(r);
        } catch (e) {
          log(`render failed: ${e.message}`);
          await rest(`creator_video_renders?id=eq.${r.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: r.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
              error: String(e.message).slice(0, 500),
            }),
            headers: { Prefer: 'return=minimal' },
          });
        }
        continue; // more work may be waiting; skip the sleep
      }
    }
  } catch (e) {
    log(`loop error: ${e.message}`);
  }
  await new Promise((res) => setTimeout(res, POLL_MS));
}
