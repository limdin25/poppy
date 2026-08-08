// creator-variants-worker.mjs: the render arm of the creator video pipeline.
//
// Hugo, 07 Aug 2026: "every account they have their own color... every account
// gets two videos per day... this has to be automated." The HeyPubli app
// (heypubli.com) queues one row per master video x creator in
// creator_video_renders; this worker drains that queue, renders the account's
// uniquely-colored copy with the variants factory, uploads it to the public
// creator-videos bucket, and marks the row ready. The scheduling cron over in
// heypubli/app/api/cron/video-pipeline then turns ready renders into
// scheduled_posts.
//
// It runs on margarita-server as systemd `heypubli-render`, because a pipeline
// that only advances while Hugo's laptop is awake is not a pipeline. The Mac
// launchd job (com.heypubli.creator-variants) still works unchanged and is the
// rollback. Set RENDER_WORKER_ID per host so the heartbeat row and the mp4
// metadata both say which box did the work.
//
// Modeled line-for-line on the two proven scripts:
//   - render-variants.mjs: the bundle-once + renderMedia harness and the
//     structural verify (frames exact, audio present, end card quieter).
//   - vsl-render-worker.mjs: the poll/claim/heartbeat/stale-requeue shape.
//
// Run it from video/:  node scripts/creator-variants-worker.mjs
// VPS:  systemctl status heypubli-render   /  journalctl -u heypubli-render -f
// Mac:  launchd com.heypubli.creator-variants, log /tmp/creator-variants-worker.log
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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(VIDEO_DIR, 'out', 'creator');
mkdirSync(OUT_DIR, { recursive: true });

// ---- env: the HeyPubli project ---------------------------------------------
// Two hosts, two ways in. On the Mac this comes from the app's own .env.local,
// because a launchd job has no shell profile. On the VPS it comes from systemd
// EnvironmentFile=/etc/heypubli-render.env, and there is no .env.local there at
// all, so the read MUST be able to fail without taking the process with it.
// Real env wins over the file, so the unit file is always authoritative and a
// stale checkout can never quietly override it.
for (const f of [join(VIDEO_DIR, '..', 'heypubli', '.env.local'), join(VIDEO_DIR, '..', '.env')]) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_0-9]+)="?([^"]*)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* absent is normal: on the VPS the env arrives from systemd */
  }
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ' +
      '(heypubli/.env.local on the Mac, systemd EnvironmentFile on the VPS)',
  );
  process.exit(1);
}

const POLL_MS = 30_000;
const STALE_MIN = 20;
const MAX_ATTEMPTS = 3;
const RECIPE_VERSION = 8;
const BUCKET = 'creator-videos';
// Each render box stamps its own heartbeat row and its own mp4 metadata, so
// "is the VPS actually doing this?" is answerable from the artifact rather than
// inferred. The Mac keeps 'default', so its launchd plist needs no change.
const WORKER_ID = process.env.RENDER_WORKER_ID ?? 'default';
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY ?? 8);

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
let rendersSinceRecycle = 0;
const RECYCLE_EVERY = 25;
async function ensureHarness(rebundle = false) {
  if (rebundle) serveUrl = null;
  if (!serveUrl) {
    log('bundling ...');
    serveUrl = await bundle({ entryPoint: join(VIDEO_DIR, 'src', 'index.ts') });
    await ensureBrowser();
  }
  // A long-lived headless chrome leaks (render-variants.mjs documents it and
  // recycles every 50); this worker runs forever, so it recycles too, and it
  // THROWS AWAY a browser that just failed a render rather than marching the
  // whole queue into the same dead instance.
  if (browser && rendersSinceRecycle >= RECYCLE_EVERY) {
    await browser.close({ silent: true }).catch(() => {});
    browser = null;
    rendersSinceRecycle = 0;
  }
  if (!browser) browser = await openBrowser('chrome', { chromeMode: 'headless-shell' });
}

async function discardBrowser() {
  if (browser) {
    await browser.close({ silent: true }).catch(() => {});
    browser = null;
    rendersSinceRecycle = 0;
  }
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
      comment: `seed=${props.seed.toString(16).padStart(8, '0')} src=${props.sourceId} idx=${props.variantIndex} recipe=${props.recipeVersion} fam=${props.colorFamily ?? 'seeded'} worker=${WORKER_ID}`,
    },
  });
  const errs = verify(outPath, composition.durationInFrames);
  if (errs.length) throw new Error(`verify failed: ${errs.join('; ')}`);
  rendersSinceRecycle++;
}

// ---- master preview: an uploaded clip becomes a renderable source ----------
/** Run ingest for a clip WITHOUT losing the rest of the manifest: review
 *  caught that ingest-sources.mjs rewrites sources.json to contain only the
 *  dropped clips, which would delete v1..v4 (and every earlier master) from
 *  the schema on the first upload. Snapshot, run, merge back. */
function ingestMerging() {
  const manifestPath = join(VIDEO_DIR, 'src', 'variants', 'sources.json');
  const before = JSON.parse(readFileSync(manifestPath, 'utf8'));
  execFileSync('node', [join(VIDEO_DIR, 'scripts', 'ingest-sources.mjs')], {
    cwd: VIDEO_DIR,
    stdio: 'inherit',
  });
  const after = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const byId = new Map(before.map((x) => [x.id, x]));
  for (const x of after) byId.set(x.id, x);
  const merged = [...byId.values()];
  writeFileSync(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);
  execFileSync('node', [join(VIDEO_DIR, 'scripts', 'make-ambience.mjs')], {
    cwd: VIDEO_DIR,
    stdio: 'inherit',
  });
}

/** Make sure a source is renderable on THIS machine: the raw clip and its
 *  encoded twins are gitignored, so a fresh clone (or a tidy-up) loses them.
 *  Anything with a source_url in storage is re-downloadable; re-ingest it. */
async function ensureSource(sourceId, sourceUrl) {
  const manifestPath = join(VIDEO_DIR, 'src', 'variants', 'sources.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const known = manifest.some((x) => x.id === sourceId);
  const encoded = existsSync(join(VIDEO_DIR, 'public', 'sources', `${sourceId}.mp4`));
  if (known && encoded) return;
  if (!sourceUrl) throw new Error(`source ${sourceId} missing locally and has no source_url`);
  log(`source ${sourceId} missing locally, re-ingesting from storage`);
  const clipPath = join(VIDEO_DIR, 'sources-in', `${sourceId}.mp4`);
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`source download ${res.status}`);
  writeFileSync(clipPath, Buffer.from(await res.arrayBuffer()));
  ingestMerging();
  await ensureHarness(true);
}

async function handleNewMasters() {
  const masters = await rest(
    `master_videos?status=eq.preview_rendering&source_url=not.is.null&select=*&order=created_at&limit=1`,
  );
  const m = masters?.[0];
  if (!m) return false;

  const tried = masterAttempts.get(m.id) ?? 0;
  if (tried >= 3) {
    await rest(`master_videos?id=eq.${m.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed' }),
      headers: { Prefer: 'return=minimal' },
    });
    log(`master seq ${m.seq} failed ${tried} ingests, marked failed and skipped`);
    masterAttempts.delete(m.id);
    return false;
  }
  masterAttempts.set(m.id, tried + 1);

  log(`ingesting master seq ${m.seq} (${m.source_id})`);
  const clipPath = join(VIDEO_DIR, 'sources-in', `${m.source_id}.mp4`);
  if (!existsSync(clipPath)) {
    const res = await fetch(m.source_url);
    if (!res.ok) throw new Error(`source download ${res.status}`);
    writeFileSync(clipPath, Buffer.from(await res.arrayBuffer()));
  }
  // ingest updates src/variants/sources.json, which SOURCE_IDS and the zod
  // schema derive from, so the bundle must be rebuilt afterwards.
  ingestMerging();
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
    `creator_video_renders?status=eq.queued&select=*,master:master_videos(seq,source_id,status,source_url)&order=created_at&limit=1`,
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
  await ensureSource(r.master.source_id, r.master.source_url);
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
  // Drop the local copy once the bucket has it. On a box that renders around
  // the clock this is ~17MB a time with nothing ever clearing it, which fills
  // even a 360GB disk inside a few months. Only after the row says ready, so a
  // crash between upload and PATCH still leaves the file to inspect.
  try {
    rmSync(out, { force: true });
  } catch {
    /* a leftover file is untidy, not a failure worth stopping the queue for */
  }
  log(`ready in ${Math.round((Date.now() - t0) / 1000)}s -> ${url}`);
}

// UPSERT, never PATCH. A PATCH against a row that does not exist yet returns
// 200 with zero rows changed, so a new worker id would look permanently dead
// and nobody would know why. id is the primary key, so merge-duplicates makes
// the first heartbeat create the row and every later one update it.
async function heartbeat() {
  const now = new Date().toISOString();
  await rest('video_pipeline_state', {
    method: 'POST',
    body: JSON.stringify({ id: WORKER_ID, worker_last_seen: now, updated_at: now }),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
}

// ---- main loop -------------------------------------------------------------
log('creator variants worker up');
// The heartbeat lives on its own timer: a single loop iteration legitimately
// holds a multi-minute render or a 20-minute master ingest, and the admin
// page declares the worker dead at 120s. renderMedia and execFileSync-free
// awaits keep the event loop breathing, so the interval fires mid-render.
setInterval(() => { heartbeat().catch(() => {}); }, 30_000);
// A master that fails ingest three times is marked failed and skipped, or one
// bad upload would wedge this loop forever and starve every creator render.
const masterAttempts = new Map();
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
          await discardBrowser();
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
