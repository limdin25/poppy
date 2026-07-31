// The bake-off harness. Hand-run, stage at a time, resumable, and paranoid
// about money. Reviewed adversarially before first spend (2026-07-31, 12
// confirmed findings fixed). The rules it now enforces:
//
// - Every paid call runs INSIDE paidCall's submit closure: the intent row is
//   saved with no receipt before money can move, and the receipt (request id
//   or 'inline-done') is stamped only after the provider produced output. A
//   crash in between leaves intent-without-receipt, and the next run REFUSES
//   that key until the operator checks the provider dashboard and passes
//   BENCH_FORCE_RESUBMIT=<exact key>, which re-counts the estimate against
//   the budget (a re-bill is a second real charge).
// - BENCH_BUDGET_USD is required, no default.
// - state.json is written atomically (tmp + rename) with a .bak of the
//   previous version; a corrupt ledger refuses to load rather than reset.
// - Real fal cost per contender = the EARLIEST persisted pre-submit balance
//   minus the post-download balance, so a crash-resume can never report $0.
//
// Usage: node bench/dist/run-bench.mjs <stage>
// Stages: verify | fixtures | voices | composites | upload | talking | report
// Env: see ENV.md (Bench section).

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGeminiImageRequest, extractGeminiImage, GEMINI_DRAFT_MODEL, GEMINI_FINAL_MODEL } from '../src/core/providers/gemini';
import { buildTtsRequest, wavDurationSeconds } from '../src/core/providers/fish';
import { buildKlingAvatarSubmit, KLING_AVATAR_MODEL_PATH } from '../src/core/providers/kling';
import { buildOmniHumanSubmit, OMNIHUMAN_MODEL_PATH } from '../src/core/providers/omnihuman';
import { buildFalStatus, buildFalResult, falBasePath } from '../src/core/providers/fal';
import { assertWithinBudget, EST_USD, type SpendEntry } from './budget';
import { SCRIPTS, MARIA_REFERENCE_ID, INFLUENCER_PROMPT, PRODUCT_PROMPT, COMPOSITE_PROMPT, BEHAVIOR_PROMPT } from './fixtures';

const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
// When running the bundled file from bench/dist/, out/ still lives in bench/.
const OUT_DIR = BENCH_DIR.endsWith('dist') ? join(BENCH_DIR, '..', 'out') : join(BENCH_DIR, 'out');
const STATE_PATH = join(OUT_DIR, 'state.json');

interface BenchState {
  spend: SpendEntry[];
  artifacts: Record<string, string>;
  uploads: Record<string, { path: string; signedUrl: string; expiresAt: string }>;
  balances: Array<{ label: string; usd: number; ts: string }>;
  results: Array<{
    contender: string;
    provider: string;
    estUsd: number;
    realUsd?: number;
    latencyMs?: number;
    outputPath?: string;
    notes?: string;
  }>;
}

function loadState(): BenchState {
  if (!existsSync(STATE_PATH)) {
    return { spend: [], artifacts: {}, uploads: {}, balances: [], results: [] };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as BenchState;
  } catch {
    throw new Error(
      `${STATE_PATH} is corrupt. Restore it from state.json.bak in the same folder. ` +
        'Never delete it: it is the spend ledger that stops double-billing.',
    );
  }
}

function saveState(state: BenchState): void {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(STATE_PATH)) copyFileSync(STATE_PATH, `${STATE_PATH}.bak`);
  writeFileSync(`${STATE_PATH}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${STATE_PATH}.tmp`, STATE_PATH);
}

function env(name: string, required = true): string {
  const value = process.env[name] ?? '';
  if (required && !value) throw new Error(`Missing env var ${name} (see ugc/ENV.md, Bench section)`);
  return value;
}

function budgetUsd(): number {
  const n = Number(env('BENCH_BUDGET_USD'));
  if (!(n > 0)) {
    throw new Error(`BENCH_BUDGET_USD must be a positive dollar amount, got "${process.env['BENCH_BUDGET_USD']}"`);
  }
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fal money

async function falBalanceUsd(): Promise<number | null> {
  try {
    const res = await fetch('https://rest.alpha.fal.ai/billing/user_balance', {
      headers: { Authorization: `Key ${env('FAL_KEY')}` },
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim().replace(/"/g, '');
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function recordBalance(state: BenchState, label: string): Promise<number | null> {
  const usd = await falBalanceUsd();
  if (usd !== null) {
    state.balances.push({ label, usd, ts: new Date().toISOString() });
    saveState(state);
    console.log(`fal balance [${label}]: $${usd}`);
  }
  return usd;
}

// ------------------------------------------------------------- paid harness

// The one gate every paid submission passes through. `submit` performs the
// ENTIRE billable interaction and returns its receipt (a provider request id,
// or 'inline-done' after a synchronous provider's artifact is safely written).
async function paidCall(state: BenchState, key: string, estUsd: number, submit: () => Promise<string>): Promise<string> {
  const existing = state.spend.find((e) => e.key === key);
  if (existing?.requestId) {
    console.log(`[adopt] ${key} already has receipt ${existing.requestId}, not resubmitting`);
    return existing.requestId;
  }
  if (existing) {
    // Intent without receipt: a previous run died mid-call. Refuse unless the
    // operator names THIS key after checking the provider dashboard.
    if (process.env['BENCH_FORCE_RESUBMIT'] !== key) {
      throw new Error(
        `${key} has an intent record but no receipt (a previous run may have crashed mid-call). ` +
          `Check the provider dashboard for a stray charge, then rerun with BENCH_FORCE_RESUBMIT="${key}" if it is clean.`,
      );
    }
    delete process.env['BENCH_FORCE_RESUBMIT'];
    // A forced retry may be a second real charge: count it again.
    assertWithinBudget(state.spend, estUsd, budgetUsd());
    existing.estUsd += estUsd;
    saveState(state);
    const receipt = await submit();
    existing.requestId = receipt;
    saveState(state);
    console.log(`[paid] ${key} force-resubmitted, est $${estUsd.toFixed(2)} (counted again), receipt ${receipt}`);
    return receipt;
  }
  assertWithinBudget(state.spend, estUsd, budgetUsd());
  const entry: SpendEntry = { key, estUsd, ts: new Date().toISOString() };
  state.spend.push(entry);
  saveState(state);
  const receipt = await submit();
  entry.requestId = receipt;
  saveState(state);
  console.log(`[paid] ${key} done, est $${estUsd.toFixed(2)}, receipt ${receipt}`);
  return receipt;
}

// ------------------------------------------------------------------- gemini

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// The production composite path (direct Gemini key). Unused by the bench
// stages while the Google project has no billing (free tier = zero image
// quota, verified 2026-07-31); kept exported for the post-billing re-check.
export async function geminiImage(args: {
  state: BenchState;
  key: string;
  model: string;
  prompt: string;
  estUsd: number;
  referencePaths?: string[];
  imageSize?: '1K' | '2K';
  outFile: string;
}): Promise<string> {
  const { state } = args;
  const existingArtifact = state.artifacts[args.key];
  if (existingArtifact && existsSync(existingArtifact)) {
    console.log(`[skip] ${args.key} exists: ${existingArtifact}`);
    return existingArtifact;
  }
  const hasRefs = !!args.referencePaths?.length;
  const referenceImages = hasRefs
    ? args.referencePaths!.map((p) => ({ mime: 'image/png', base64: readFileSync(p).toString('base64') }))
    : [{ mime: 'image/png', base64: TINY_PNG_B64 }];
  const request = buildGeminiImageRequest({
    apiKey: env('GEMINI_API_KEY'),
    model: args.model,
    // The builder requires at least one reference; pure text-to-image fixture
    // prompts ride with a 1x1 blank pixel and tell the model to ignore it.
    prompt: hasRefs ? args.prompt : `${args.prompt} Ignore the tiny blank reference image.`,
    referenceImages,
    aspectRatio: '9:16',
    ...(args.imageSize ? { imageSize: args.imageSize } : {}),
  });

  await paidCall(state, args.key, args.estUsd, async () => {
    let lastError = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
      if (res.ok) {
        const image = extractGeminiImage((await res.json()) as Parameters<typeof extractGeminiImage>[0]);
        const outPath = join(OUT_DIR, args.outFile);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, Buffer.from(image.base64, 'base64'));
        state.artifacts[args.key] = outPath;
        saveState(state);
        console.log(`[ok] ${args.key} -> ${outPath}`);
        return 'inline-done';
      }
      lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
      if (res.status === 429 || res.status === 503) {
        console.log(`[retry] ${args.key} got ${res.status}, waiting 25s (attempt ${attempt}/4)`);
        await sleep(25_000);
        continue;
      }
      break;
    }
    throw new Error(`Gemini ${args.key} failed: ${lastError}`);
  });
  return state.artifacts[args.key]!;
}

// --------------------------------------------------------------------- fal

// Bench-only fal slugs for the image stages (schemas read from fal's OpenAPI
// 2026-07-31: text-to-image requires `prompt`, edit adds `image_urls`).
const FAL_NANO_BANANA = 'fal-ai/nano-banana';
const FAL_NANO_BANANA_EDIT = 'fal-ai/nano-banana/edit';
const FAL_NANO_BANANA_PRO_EDIT = 'fal-ai/nano-banana-pro/edit';

// Submit to a fal queue endpoint and return the request id (throws on
// anything that is not an accepted submission).
async function falSubmit(request: { url: string; headers: Record<string, string>; body?: Record<string, unknown> }): Promise<string> {
  const res = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body ?? {}),
  });
  const text = await res.text();
  let json: { request_id?: string } = {};
  try {
    json = JSON.parse(text) as { request_id?: string };
  } catch {
    // handled below
  }
  if (!res.ok || !json.request_id) {
    throw new Error(`fal submit failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return json.request_id;
}

// Poll a fal queue request to completion and return the parsed result body.
async function falAwaitResult(args: {
  contender: string;
  modelPath: string;
  requestId: string;
  startedAt: number;
  timeoutMs: number;
  pollMs: number;
}): Promise<unknown> {
  const apiKey = env('FAL_KEY');
  let consecutiveFailures = 0;
  for (;;) {
    if (Date.now() - args.startedAt > args.timeoutMs) {
      await cancelFalRequest(args.modelPath, args.requestId);
      throw new Error(
        `${args.contender} timed out after ${Math.round(args.timeoutMs / 60000)} minutes (request ${args.requestId}, cancel attempted). ` +
          'Check the fal dashboard before rerunning.',
      );
    }
    let statusValue: string | undefined;
    let queuePosition: number | undefined;
    let detail = '';
    try {
      const statusReq = buildFalStatus({ apiKey, modelPath: args.modelPath, requestId: args.requestId });
      const statusRes = await fetch(statusReq.url, { headers: statusReq.headers });
      const text = await statusRes.text();
      detail = `http ${statusRes.status} ${text.slice(0, 200)}`;
      if (statusRes.ok) {
        const parsed = JSON.parse(text) as { status?: string; queue_position?: number };
        statusValue = parsed.status;
        queuePosition = parsed.queue_position;
      }
    } catch (e) {
      detail = (e as Error).message;
    }
    if (statusValue === 'COMPLETED') break;
    if (statusValue === 'IN_QUEUE' || statusValue === 'IN_PROGRESS') {
      consecutiveFailures = 0;
      console.log(`[poll] ${args.contender}: ${statusValue}${queuePosition != null ? ` (queue ${queuePosition})` : ''}`);
      await sleep(args.pollMs);
      continue;
    }
    consecutiveFailures++;
    console.log(`[poll-warn] ${args.contender}: ${detail} (${consecutiveFailures}/8)`);
    if (consecutiveFailures >= 8) {
      throw new Error(`${args.contender} status polling failed 8 times in a row: ${detail} (request ${args.requestId})`);
    }
    await sleep(args.pollMs);
  }
  const resultReq = buildFalResult({ apiKey, modelPath: args.modelPath, requestId: args.requestId });
  const resultRes = await fetch(resultReq.url, { headers: resultReq.headers });
  const resultText = await resultRes.text();
  if (!resultRes.ok) {
    throw new Error(`${args.contender} result fetch failed (${resultRes.status}): ${resultText.slice(0, 400)}`);
  }
  return JSON.parse(resultText) as unknown;
}

async function cancelFalRequest(modelPath: string, requestId: string): Promise<void> {
  try {
    await fetch(`https://queue.fal.run/${falBasePath(modelPath)}/requests/${requestId}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Key ${env('FAL_KEY')}` },
    });
  } catch {
    // Best effort; the timeout error below is the real signal.
  }
}

async function falRun(args: {
  state: BenchState;
  key: string;
  contender: string;
  modelPath: string;
  submitRequest: { url: string; headers: Record<string, string>; body?: Record<string, unknown> };
  estUsd: number;
  outFile: string;
  timeoutMs?: number;
}): Promise<void> {
  const { state } = args;
  const done = state.results.find((r) => r.contender === args.contender && r.outputPath);
  if (done && existsSync(done.outputPath!)) {
    console.log(`[skip] ${args.contender} already has output: ${done.outputPath}`);
    return;
  }

  // The pre-submit balance must survive a crash-resume: use the EARLIEST
  // persisted reading for this contender; only measure fresh if none exists.
  const beforeLabel = `before-${args.contender}`;
  let before = state.balances.find((b) => b.label === beforeLabel)?.usd ?? null;
  if (before === null) before = await recordBalance(state, beforeLabel);
  const resumed = !!state.spend.find((e) => e.key === args.key)?.requestId;

  const startedAt = Date.now();
  const requestId = await paidCall(state, args.key, args.estUsd, () => falSubmit(args.submitRequest));

  const result = await falAwaitResult({
    contender: args.contender,
    modelPath: args.modelPath,
    requestId,
    startedAt,
    timeoutMs: args.timeoutMs ?? 25 * 60_000,
    pollMs: 15_000,
  });
  const videoUrl = findVideoUrl(result);
  if (!videoUrl) throw new Error(`${args.contender} returned no video url: ${JSON.stringify(result).slice(0, 400)}`);

  const video = await fetch(videoUrl);
  if (!video.ok) throw new Error(`${args.contender} video download failed: ${video.status}`);
  const outPath = join(OUT_DIR, args.outFile);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, new Uint8Array(await video.arrayBuffer()));

  const after = await recordBalance(state, `after-${args.contender}`);
  const latencyMs = Date.now() - startedAt;
  const realUsd = before !== null && after !== null ? Number((before - after).toFixed(4)) : undefined;
  const spendEntry = state.spend.find((e) => e.key === args.key);
  if (spendEntry && realUsd !== undefined) spendEntry.realUsd = realUsd;
  const notes = resumed
    ? 'resumed run: latency spans only the resumed portion; real cost from persisted pre-submit balance'
    : realUsd !== undefined
      ? `real billed (fal balance delta): $${realUsd}`
      : 'balance delta unavailable';
  const row = {
    contender: args.contender,
    provider: 'fal',
    estUsd: args.estUsd,
    ...(realUsd !== undefined ? { realUsd } : {}),
    ...(resumed ? {} : { latencyMs }),
    outputPath: outPath,
    notes,
  };
  const existingIdx = state.results.findIndex((r) => r.contender === args.contender);
  if (existingIdx >= 0) state.results[existingIdx] = row;
  else state.results.push(row);
  saveState(state);
  await insertBenchmarkRow({
    contender: args.contender,
    provider: 'fal',
    params: { modelPath: args.modelPath, requestId },
    est_cost_usd: args.estUsd,
    ...(resumed ? {} : { latency_ms: latencyMs }),
    output_path: outPath,
    notes,
  });
  console.log(
    `[done] ${args.contender} in ${(latencyMs / 1000).toFixed(0)}s, real cost ${realUsd !== undefined ? `$${realUsd}` : 'unknown'} -> ${outPath}`,
  );
}

function findMediaUrl(value: unknown, ext: RegExp): string | null {
  if (typeof value === 'string') {
    return value.startsWith('http') && ext.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMediaUrl(item, ext);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const found = findMediaUrl(v, ext);
      if (found) return found;
    }
  }
  return null;
}

const findVideoUrl = (value: unknown) => findMediaUrl(value, /\.mp4(\?|$)/);
const findImageUrl = (value: unknown) => findMediaUrl(value, /\.(png|jpe?g|webp)(\?|$)/);

// A fal-hosted image generation: same paidCall + balance discipline as the
// video path, faster poll, and the artifact registers under artifactKey so
// downstream stages pick it up exactly like a Gemini-produced one.
async function falImage(args: {
  state: BenchState;
  key: string;
  contender: string;
  modelPath: string;
  input: Record<string, unknown>;
  estUsd: number;
  outFile: string;
  artifactKey: string;
}): Promise<string> {
  const { state } = args;
  const existing = state.artifacts[args.artifactKey];
  if (existing && existsSync(existing)) {
    console.log(`[skip] ${args.artifactKey} exists: ${existing}`);
    return existing;
  }
  const beforeLabel = `before-${args.contender}`;
  let before = state.balances.find((b) => b.label === beforeLabel)?.usd ?? null;
  if (before === null) before = await recordBalance(state, beforeLabel);

  const startedAt = Date.now();
  const requestId = await paidCall(state, args.key, args.estUsd, () =>
    falSubmit({
      url: `https://queue.fal.run/${args.modelPath}`,
      headers: { Authorization: `Key ${env('FAL_KEY')}`, 'Content-Type': 'application/json' },
      body: args.input,
    }),
  );
  const result = await falAwaitResult({
    contender: args.contender,
    modelPath: args.modelPath,
    requestId,
    startedAt,
    timeoutMs: 5 * 60_000,
    pollMs: 5_000,
  });
  const imageUrl = findImageUrl(result);
  if (!imageUrl) throw new Error(`${args.contender} returned no image url: ${JSON.stringify(result).slice(0, 400)}`);
  const image = await fetch(imageUrl);
  if (!image.ok) throw new Error(`${args.contender} image download failed: ${image.status}`);
  const outPath = join(OUT_DIR, args.outFile);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, new Uint8Array(await image.arrayBuffer()));
  state.artifacts[args.artifactKey] = outPath;

  const after = await recordBalance(state, `after-${args.contender}`);
  const realUsd = before !== null && after !== null ? Number((before - after).toFixed(4)) : undefined;
  const spendEntry = state.spend.find((e) => e.key === args.key);
  if (spendEntry && realUsd !== undefined) spendEntry.realUsd = realUsd;
  const row = {
    contender: args.contender,
    provider: 'fal',
    estUsd: args.estUsd,
    ...(realUsd !== undefined ? { realUsd } : {}),
    latencyMs: Date.now() - startedAt,
    outputPath: outPath,
    notes: realUsd !== undefined ? `real billed (fal balance delta): $${realUsd}` : 'balance delta unavailable',
  };
  const idx = state.results.findIndex((r) => r.contender === args.contender);
  if (idx >= 0) state.results[idx] = row;
  else state.results.push(row);
  saveState(state);
  await insertBenchmarkRow({
    contender: args.contender,
    provider: 'fal',
    params: { modelPath: args.modelPath, requestId },
    est_cost_usd: args.estUsd,
    latency_ms: row.latencyMs,
    output_path: outPath,
    notes: row.notes,
  });
  console.log(`[done] ${args.contender}, real cost ${realUsd !== undefined ? `$${realUsd}` : 'unknown'} -> ${outPath}`);
  return outPath;
}

// ----------------------------------------------------------------- supabase

async function insertBenchmarkRow(row: Record<string, unknown>): Promise<void> {
  const base = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!base || !key) {
    console.log('[warn] SUPABASE_URL/SERVICE_ROLE_KEY not set, benchmark row not recorded');
    return;
  }
  const res = await fetch(`${base}/rest/v1/ugc_benchmark_runs`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!res.ok) console.log(`[warn] benchmark row insert failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function signRemotePath(remotePath: string): Promise<{ signedUrl: string; expiresAt: string }> {
  const base = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const sign = await fetch(`${base}/storage/v1/object/sign/ugc-renders/${remotePath}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 259200 }),
  });
  const signed = (await sign.json()) as { signedURL?: string };
  if (!sign.ok || !signed.signedURL) throw new Error(`Signing ${remotePath} failed: ${sign.status}`);
  return {
    signedUrl: `${base}/storage/v1${signed.signedURL}`,
    expiresAt: new Date(Date.now() + 259200 * 1000).toISOString(),
  };
}

async function uploadToBucket(localPath: string, remoteName: string, mime: string): Promise<{ path: string; signedUrl: string; expiresAt: string }> {
  const base = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const remotePath = `bench/${remoteName}`;
  const upload = await fetch(`${base}/storage/v1/object/ugc-renders/${remotePath}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': mime, 'x-upsert': 'true' },
    body: new Uint8Array(readFileSync(localPath)),
  });
  if (!upload.ok) throw new Error(`Upload of ${remoteName} failed: ${upload.status} ${(await upload.text()).slice(0, 200)}`);
  return { path: remotePath, ...(await signRemotePath(remotePath)) };
}

// A signed URL must outlive the whole poll window; re-sign when the stored
// one has less than 30 minutes left (signing is free, the upload persists).
async function freshUpload(state: BenchState, key: string): Promise<{ path: string; signedUrl: string; expiresAt: string }> {
  const stored = state.uploads[key];
  if (!stored) throw new Error('Run the upload stage first');
  const marginMs = 30 * 60_000;
  if (Date.parse(stored.expiresAt) - Date.now() > marginMs) return stored;
  const renewed = { path: stored.path, ...(await signRemotePath(stored.path)) };
  state.uploads[key] = renewed;
  saveState(state);
  console.log(`[resign] ${key} signed URL renewed`);
  return renewed;
}

// ------------------------------------------------------------------- stages

async function stageVerify(state: BenchState): Promise<void> {
  env('GEMINI_API_KEY');
  env('FAL_KEY');
  env('FISH_API_KEY');
  console.log(`Budget: $${budgetUsd()}`);
  console.log(`Spent so far (estimated): $${state.spend.reduce((s, e) => s + e.estUsd, 0).toFixed(2)}`);
  await recordBalance(state, 'verify');
  const models = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': env('GEMINI_API_KEY') },
  });
  const list = (await models.json()) as { models?: Array<{ name: string }> };
  for (const id of [GEMINI_DRAFT_MODEL, GEMINI_FINAL_MODEL]) {
    const present = list.models?.some((m) => m.name === `models/${id}`);
    console.log(`Gemini model ${id}: ${present ? 'AVAILABLE' : 'MISSING'}`);
    if (!present) throw new Error(`Gemini model ${id} is not available to this key`);
  }
  console.log('verify: all keys present, models available.');
}

async function stageFixtures(state: BenchState): Promise<void> {
  await falImage({
    state,
    key: 'fixture:influencer:fal',
    contender: 'fixture-influencer',
    modelPath: FAL_NANO_BANANA,
    input: { prompt: INFLUENCER_PROMPT, aspect_ratio: '9:16' },
    estUsd: EST_USD.fal_image,
    outFile: 'fixtures/influencer.png',
    artifactKey: 'fixture:influencer',
  });
  await falImage({
    state,
    key: 'fixture:product:fal',
    contender: 'fixture-product',
    modelPath: FAL_NANO_BANANA,
    input: { prompt: PRODUCT_PROMPT, aspect_ratio: '9:16' },
    estUsd: EST_USD.fal_image,
    outFile: 'fixtures/product.png',
    artifactKey: 'fixture:product',
  });
}

async function stageVoices(state: BenchState): Promise<void> {
  const scriptKey = 's15';
  const stateKey = `voice:${scriptKey}`;
  const existing = state.artifacts[stateKey];
  if (existing && existsSync(existing)) {
    console.log(`[skip] ${stateKey} exists`);
    return;
  }
  const request = buildTtsRequest({
    apiKey: env('FISH_API_KEY'),
    text: SCRIPTS[scriptKey],
    referenceId: MARIA_REFERENCE_ID,
  });
  await paidCall(state, stateKey, EST_USD.voice_take, async () => {
    const res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    if (!res.ok) throw new Error(`Fish TTS failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const wav = Buffer.from(await res.arrayBuffer());
    const outPath = join(OUT_DIR, `voices/${scriptKey}.wav`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, wav);
    state.artifacts[stateKey] = outPath;
    saveState(state);
    console.log(`[ok] ${stateKey} -> ${outPath} (${wavDurationSeconds(wav.byteLength, request.body.sample_rate).toFixed(1)}s)`);
    return 'inline-done';
  });
}

async function stageComposites(state: BenchState): Promise<void> {
  const influencer = state.artifacts['fixture:influencer'];
  const product = state.artifacts['fixture:product'];
  if (!influencer || !product) throw new Error('Run the fixtures stage first');
  if (!state.uploads['influencer']) {
    state.uploads['influencer'] = await uploadToBucket(influencer, 'fixture-influencer.png', 'image/png');
  }
  if (!state.uploads['product']) {
    state.uploads['product'] = await uploadToBucket(product, 'fixture-product.png', 'image/png');
  }
  saveState(state);
  const influencerUrl = (await freshUpload(state, 'influencer')).signedUrl;
  const productUrl = (await freshUpload(state, 'product')).signedUrl;
  await falImage({
    state,
    key: 'composite:draft:fal',
    contender: 'composite-nano-banana-draft',
    modelPath: FAL_NANO_BANANA_EDIT,
    input: { prompt: COMPOSITE_PROMPT, image_urls: [influencerUrl, productUrl], aspect_ratio: '9:16' },
    estUsd: EST_USD.fal_image,
    outFile: 'composites/draft-nb2.png',
    artifactKey: 'composite:draft',
  });
  await falImage({
    state,
    key: 'composite:final:fal',
    contender: 'composite-nano-banana-pro-2k',
    modelPath: FAL_NANO_BANANA_PRO_EDIT,
    input: { prompt: COMPOSITE_PROMPT, image_urls: [influencerUrl, productUrl], aspect_ratio: '9:16', resolution: '2K' },
    estUsd: EST_USD.fal_image_pro,
    outFile: 'composites/final-nbpro.png',
    artifactKey: 'composite:final',
  });
}

async function stageUpload(state: BenchState): Promise<void> {
  const composite = state.artifacts['composite:final'];
  const voice = state.artifacts['voice:s15'];
  if (!composite || !voice) throw new Error('Run composites and voices first');
  state.uploads['composite'] = await uploadToBucket(composite, 'composite-final.png', 'image/png');
  state.uploads['voice'] = await uploadToBucket(voice, 'voice-s15.wav', 'audio/wav');
  saveState(state);
  console.log('[ok] composite + voice uploaded and signed for 72h');
}

async function stageTalking(state: BenchState): Promise<void> {
  const composite = await freshUpload(state, 'composite');
  const voice = await freshUpload(state, 'voice');
  const voiceWav = readFileSync(state.artifacts['voice:s15']!);
  const seconds = Math.ceil(wavDurationSeconds(voiceWav.byteLength, 44100));
  const apiKey = env('FAL_KEY');

  await falRun({
    state,
    key: 'talking:kling-std',
    contender: 'kling-avatar-2-standard',
    modelPath: KLING_AVATAR_MODEL_PATH,
    submitRequest: buildKlingAvatarSubmit({
      apiKey,
      imageUrl: composite.signedUrl,
      audioUrl: voice.signedUrl,
      prompt: BEHAVIOR_PROMPT,
    }),
    estUsd: seconds * EST_USD.kling_std_second,
    outFile: 'talking/kling-std-s15.mp4',
  });

  await falRun({
    state,
    key: 'talking:omnihuman',
    contender: 'omnihuman-1.5',
    modelPath: OMNIHUMAN_MODEL_PATH,
    submitRequest: buildOmniHumanSubmit({
      apiKey,
      imageUrl: composite.signedUrl,
      audioUrl: voice.signedUrl,
      prompt: BEHAVIOR_PROMPT,
    }),
    estUsd: seconds * EST_USD.omnihuman_second,
    outFile: 'talking/omnihuman-s15.mp4',
  });

  // The same take through Avatar 2.0 Pro (same inputs, higher tier; slug
  // probe-verified 2026-07-31). Same builder, different model path.
  await falRun({
    state,
    key: 'talking:kling-pro',
    contender: 'kling-avatar-2-pro',
    modelPath: 'fal-ai/kling-video/ai-avatar/v2/pro',
    submitRequest: {
      ...buildKlingAvatarSubmit({
        apiKey,
        imageUrl: composite.signedUrl,
        audioUrl: voice.signedUrl,
        prompt: BEHAVIOR_PROMPT,
      }),
      url: 'https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/pro',
    },
    estUsd: seconds * EST_USD.kling_pro_second,
    outFile: 'talking/kling-pro-s15.mp4',
  });
}

// Seedance 2.0 cannot mouth an uploaded voiceover (schema verified: no audio
// input, generate_audio invents its own). This run is a MOTION-REALISM demo:
// same scene photo, the script quoted in the prompt, Seedance's own voice.
async function stageSeedance(state: BenchState): Promise<void> {
  const composite = await freshUpload(state, 'composite');
  await falRun({
    state,
    key: 'talking:seedance-2',
    contender: 'seedance-2.0-i2v-1080p',
    modelPath: 'bytedance/seedance-2.0/image-to-video',
    submitRequest: {
      url: 'https://queue.fal.run/bytedance/seedance-2.0/image-to-video',
      headers: { Authorization: `Key ${env('FAL_KEY')}`, 'Content-Type': 'application/json' },
      body: {
        image_url: composite.signedUrl,
        prompt:
          'The woman speaks casually to the camera like talking to a friend, natural head movement, she glances at the serum bottle and tilts it so the label stays visible, relaxed energy. She says: "Okay so I have to tell you about this. My skin was so dull last month, and this little serum honestly turned it around in two weeks."',
        resolution: '1080p',
        duration: '8',
        aspect_ratio: '9:16',
        generate_audio: true,
      },
    },
    estUsd: EST_USD.seedance_video_480p * 2.5,
    outFile: 'talking/seedance-s8.mp4',
  });
}

// The tuned rebuttal to "the mouth opens too big": the same take with the
// voice at natural speed (1.2 is the phone-call setting; video mouths track
// audio pace) and a direction that explicitly forbids over-articulation.
async function stagePolish(state: BenchState): Promise<void> {
  const naturalKey = 'voice:s15-natural';
  const existing = state.artifacts[naturalKey];
  if (!existing || !existsSync(existing)) {
    await paidCall(state, naturalKey, EST_USD.voice_take, async () => {
      const res = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env('FISH_API_KEY')}`,
          'Content-Type': 'application/json',
          model: 's2.1-pro',
        },
        // Bench-only natural-pace take; the product's 1.2 stays canon for
        // calls and is asserted by the provider tests.
        body: JSON.stringify({
          text: SCRIPTS.s15,
          reference_id: MARIA_REFERENCE_ID,
          format: 'wav',
          sample_rate: 44100,
          normalize: true,
          latency: 'low',
          prosody: { speed: 1.0, normalize_loudness: true },
        }),
      });
      if (!res.ok) throw new Error(`Fish natural take failed: ${res.status}`);
      const wav = Buffer.from(await res.arrayBuffer());
      const outPath = join(OUT_DIR, 'voices/s15-natural.wav');
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, wav);
      state.artifacts[naturalKey] = outPath;
      saveState(state);
      console.log(`[ok] ${naturalKey} (${wavDurationSeconds(wav.byteLength, 44100).toFixed(1)}s)`);
      return 'inline-done';
    });
  }
  if (!state.uploads['voice-natural']) {
    state.uploads['voice-natural'] = await uploadToBucket(state.artifacts[naturalKey]!, 'voice-s15-natural.wav', 'audio/wav');
    saveState(state);
  }
  const voice = await freshUpload(state, 'voice-natural');
  const composite = await freshUpload(state, 'composite');
  const wav = readFileSync(state.artifacts[naturalKey]!);
  const seconds = Math.ceil(wavDurationSeconds(wav.byteLength, 44100));
  await falRun({
    state,
    key: 'talking:kling-pro-tuned',
    contender: 'kling-avatar-2-pro-tuned',
    modelPath: 'fal-ai/kling-video/ai-avatar/v2/pro',
    submitRequest: {
      ...buildKlingAvatarSubmit({
        apiKey: env('FAL_KEY'),
        imageUrl: composite.signedUrl,
        audioUrl: voice.signedUrl,
        prompt:
          'She speaks softly and naturally to the camera, subtle small mouth movements, lips barely part between words, no exaggerated articulation, gentle slow head movement, she keeps the serum bottle steady near her shoulder with the label facing the camera, calm relaxed energy like a casual selfie video.',
      }),
      url: 'https://queue.fal.run/fal-ai/kling-video/ai-avatar/v2/pro',
    },
    estUsd: seconds * EST_USD.kling_pro_second,
    outFile: 'talking/kling-pro-tuned.mp4',
  });
}

function stageReport(state: BenchState): void {
  console.log('\n=== BENCH REPORT ===');
  console.log(`Estimated spend: $${state.spend.reduce((s, e) => s + e.estUsd, 0).toFixed(2)} of $${budgetUsd()}`);
  for (const b of state.balances) console.log(`  balance ${b.label}: $${b.usd}`);
  for (const r of state.results) {
    console.log(
      `  ${r.contender}: est $${r.estUsd.toFixed(2)}${r.realUsd !== undefined ? `, REAL $${r.realUsd}` : ''}, ` +
        `${r.latencyMs ? `${Math.round(r.latencyMs / 1000)}s, ` : ''}${r.outputPath ?? ''}${r.notes ? ` [${r.notes}]` : ''}`,
    );
  }
  for (const [k, v] of Object.entries(state.artifacts)) console.log(`  artifact ${k}: ${v}`);
}

// --------------------------------------------------------------------- main

const stage = process.argv[2];
const state = loadState();
try {
  if (stage === 'verify') await stageVerify(state);
  else if (stage === 'fixtures') await stageFixtures(state);
  else if (stage === 'voices') await stageVoices(state);
  else if (stage === 'composites') await stageComposites(state);
  else if (stage === 'upload') await stageUpload(state);
  else if (stage === 'talking') await stageTalking(state);
  else if (stage === 'seedance') await stageSeedance(state);
  else if (stage === 'polish') await stagePolish(state);
  else if (stage === 'report') stageReport(state);
  else {
    console.log('Usage: node bench/dist/run-bench.mjs <verify|fixtures|voices|composites|upload|talking|seedance|report>');
    process.exit(2);
  }
} catch (e) {
  console.error(`[bench:${stage}] ${(e as Error).message}`);
  process.exit(1);
}
