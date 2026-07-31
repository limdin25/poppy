// The UGC render worker: runs on the VPS as a systemd service, holds ALL
// image/video provider keys (they exist nowhere else), and drives every
// queued job through its state machine. IO-bound, so up to 8 jobs in flight;
// fairness comes from the claim RPC, money safety from the enqueue RPC, and
// crash safety from heartbeat + stale-ADOPT (a provider task is never
// resubmitted: that would double-bill).

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planChunks } from '../src/core/chunks';
import { isTerminalFailure, staleAction, type ErrorClass } from '../src/core/jobStates';
import {
  buildGeminiImageRequest,
  extractGeminiImage,
  GEMINI_FINAL_MODEL,
} from '../src/core/providers/gemini';
import { buildKlingAvatarSubmit } from '../src/core/providers/kling';
import { buildOmniHumanSubmit, OMNIHUMAN_MAX_SECONDS } from '../src/core/providers/omnihuman';
import { buildFalResult, buildFalStatus } from '../src/core/providers/fal';
import { KLING_AVATAR_MODEL_PATH } from '../src/core/providers/kling';
import { OMNIHUMAN_MODEL_PATH } from '../src/core/providers/omnihuman';
import {
  buildAudioSplitArgs,
  buildConcatArgs,
  buildConcatList,
  buildSilenceDetectArgs,
  parseSilences,
} from './stitch';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WORKER_ID = process.env.UGC_WORKER_ID ?? `worker-${process.pid}`;
const TICK_MS = 10_000;
const POLL_MS = 15_000;
const MAX_IN_FLIGHT = 8;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

type Json = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------- supabase

const sbHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers: { ...sbHeaders, ...init?.headers } });
}

async function rpc(fn: string, args: Json): Promise<Response> {
  return rest(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
}

async function patchJob(jobId: string, patch: Json): Promise<void> {
  await rest(`/ugc_jobs?id=eq.${jobId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

async function heartbeatJob(jobId: string): Promise<void> {
  await patchJob(jobId, { heartbeat_at: new Date().toISOString() });
}

async function downloadStorage(path: string): Promise<Buffer> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/ugc-renders/${path}`, { headers: sbHeaders });
  if (!r.ok) {
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/ugc-uploads/${path}`, { headers: sbHeaders });
    if (!up.ok) throw new Error(`download ${path}: ${r.status}/${up.status}`);
    return Buffer.from(await up.arrayBuffer());
  }
  return Buffer.from(await r.arrayBuffer());
}

async function uploadRender(path: string, body: Buffer, contentType: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/ugc-renders/${path}`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: new Uint8Array(body),
  });
  if (!r.ok) throw new Error(`upload ${path}: ${r.status} ${await r.text()}`);
}

async function signUrl(bucket: string, path: string, expiresIn = 3600): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify({ expiresIn }),
  });
  if (!r.ok) throw new Error(`sign ${bucket}/${path}: ${r.status}`);
  const body = (await r.json()) as { signedURL: string };
  return `${SUPABASE_URL}/storage/v1${body.signedURL}`;
}

interface AssetRow {
  id: string;
  storage_path: string;
  mime: string;
  duration_seconds: number | null;
  kind: string;
  approval_status: string;
}

async function getAsset(assetId: string): Promise<AssetRow> {
  const r = await rest(`/ugc_assets?id=eq.${assetId}&select=id,storage_path,mime,duration_seconds,kind,approval_status`);
  const rows = (await r.json()) as AssetRow[];
  if (!rows[0]) throw new Error(`asset ${assetId} not found`);
  return rows[0];
}

async function insertAsset(row: Json): Promise<string> {
  const r = await rest('/ugc_assets', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const rows = (await r.json()) as Array<{ id: string }>;
  if (!rows[0]) throw new Error(`asset insert failed: ${JSON.stringify(rows)}`);
  return rows[0].id;
}

async function getSetting(key: string): Promise<unknown> {
  const r = await rest(`/ugc_settings?key=eq.${key}&select=value`);
  const rows = (await r.json()) as Array<{ value: unknown }>;
  return rows[0]?.value;
}

// ------------------------------------------------------------------ ffmpeg

function runFfmpeg(args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      // silencedetect runs exit 0; the null muxer is not an error.
      if (code === 0) resolve({ stderr });
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
    proc.on('error', reject);
  });
}

// --------------------------------------------------------------- providers

class ContentRejection extends Error {}

function classify(e: unknown): ErrorClass {
  return e instanceof ContentRejection ? 'content-rejection' : 'transport';
}

async function falRun(
  jobId: string,
  modelPath: string,
  submit: { url: string; headers: Record<string, string>; body?: Json },
): Promise<string> {
  const submitted = await fetch(submit.url, {
    method: 'POST',
    headers: submit.headers,
    body: JSON.stringify(submit.body ?? {}),
  });
  if (!submitted.ok) {
    const text = await submitted.text();
    if (submitted.status >= 400 && submitted.status < 500 && submitted.status !== 429) {
      throw new ContentRejection(`fal ${submitted.status}: ${text.slice(0, 300)}`);
    }
    throw new Error(`fal submit ${submitted.status}: ${text.slice(0, 300)}`);
  }
  const { request_id: requestId } = (await submitted.json()) as { request_id: string };
  await patchJob(jobId, { status: 'running', provider_task_id: requestId });

  const apiKey = process.env.FAL_KEY!;
  for (;;) {
    await sleep(POLL_MS);
    await heartbeatJob(jobId);
    const statusReq = buildFalStatus({ apiKey, modelPath, requestId });
    const status = await fetch(statusReq.url, { headers: statusReq.headers });
    if (!status.ok) continue;
    const body = (await status.json()) as { status: string };
    if (body.status === 'COMPLETED') break;
    if (body.status === 'FAILED' || body.status === 'CANCELLED') {
      throw new ContentRejection(`fal task ${body.status}`);
    }
  }

  const resultReq = buildFalResult({ apiKey, modelPath, requestId });
  const result = await fetch(resultReq.url, { headers: resultReq.headers });
  if (!result.ok) throw new Error(`fal result ${result.status}`);
  const payload = (await result.json()) as { video?: { url?: string }; url?: string };
  const url = payload.video?.url ?? payload.url;
  if (!url) throw new Error(`fal result had no video url: ${JSON.stringify(payload).slice(0, 200)}`);
  return url;
}

// ------------------------------------------------------------------ stages

interface JobRow {
  id: string;
  user_id: string;
  project_id: string;
  stage: string;
  status: string;
  input: Json;
  attempts: number;
  provider_task_id: string | null;
}

async function runComposite(job: JobRow): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set on the worker');
  await patchJob(job.id, { status: 'running', provider: 'gemini' });

  const influencer = await getAsset(String(job.input['influencer_asset_id']));
  const product = await getAsset(String(job.input['product_asset_id']));
  const refs = await Promise.all(
    [influencer, product].map(async (a) => ({
      mime: a.mime,
      base64: (await downloadStorage(a.storage_path)).toString('base64'),
    })),
  );

  const request = buildGeminiImageRequest({
    apiKey,
    model: GEMINI_FINAL_MODEL,
    prompt: String(job.input['prompt'] ?? 'A casual phone photo of the person holding the product'),
    referenceImages: refs,
    aspectRatio: String(job.input['aspect'] ?? '9:16'),
    imageSize: '2K',
  });
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new ContentRejection(`gemini ${response.status}: ${text.slice(0, 300)}`);
    }
    throw new Error(`gemini ${response.status}: ${text.slice(0, 300)}`);
  }
  const image = extractGeminiImage((await response.json()) as never);
  const path = `${job.user_id}/${job.project_id}/composite-${job.id}.png`;
  await uploadRender(path, Buffer.from(image.base64, 'base64'), image.mime);
  const assetId = await insertAsset({
    project_id: job.project_id,
    user_id: job.user_id,
    kind: 'composite_image',
    storage_path: path,
    mime: image.mime,
    bytes: Buffer.byteLength(image.base64, 'base64'),
    source: 'generated',
    job_id: job.id,
  });
  await patchJob(job.id, { status: 'succeeded', output_asset_id: assetId, finished_at: new Date().toISOString() });
}

async function runLipsync(job: JobRow): Promise<void> {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error('FAL_KEY not set on the worker');

  const audio = await getAsset(String(job.input['audio_asset_id']));
  if (audio.approval_status !== 'approved') {
    // The RPC already refused unapproved audio at enqueue; this re-check
    // catches a take superseded BETWEEN enqueue and execution.
    throw new ContentRejection('voice take is no longer the approved one');
  }
  const composite = await getAsset(String(job.input['composite_asset_id']));
  const prompt = String(job.input['direction'] ?? '');
  const durationSec = Number(audio.duration_seconds ?? 0);

  const pins = ((await getSetting('model_pins')) ?? {}) as Record<string, string>;
  const engine = pins['lipsync'] ?? 'kling-avatar-2-standard';

  await patchJob(job.id, { status: 'submitted', provider: engine });
  const imageUrl = await signUrl('ugc-renders', composite.storage_path, 7200);
  const audioUrl = await signUrl('ugc-renders', audio.storage_path, 7200);

  let videoBuffer: Buffer;

  if (engine.startsWith('omnihuman') && durationSec > OMNIHUMAN_MAX_SECONDS) {
    // Chunked path: split the approved audio at silences, render each chunk,
    // stitch with a re-encode.
    const dir = mkdtempSync(join(tmpdir(), `ugc-${job.id.slice(0, 8)}-`));
    try {
      const wavPath = join(dir, 'voice.wav');
      writeFileSync(wavPath, await downloadStorage(audio.storage_path));
      const { stderr } = await runFfmpeg(buildSilenceDetectArgs(wavPath));
      const silences = parseSilences(stderr);
      const chunks = planChunks(durationSec, { maxChunkSec: OMNIHUMAN_MAX_SECONDS, silences });

      const chunkVideos: string[] = [];
      for (const chunk of chunks) {
        const chunkWav = join(dir, `chunk-${chunk.seq}.wav`);
        await runFfmpeg(buildAudioSplitArgs(wavPath, chunk, chunkWav));
        const chunkPath = `${job.user_id}/${job.project_id}/chunks/${job.id}-${chunk.seq}.wav`;
        await uploadRender(chunkPath, readFileSync(chunkWav), 'audio/wav');
        await rest('/ugc_job_chunks', {
          method: 'POST',
          body: JSON.stringify({
            job_id: job.id,
            seq: chunk.seq,
            audio_path: chunkPath,
            duration_seconds: chunk.endSec - chunk.startSec,
            status: 'submitted',
          }),
        });
        const chunkAudioUrl = await signUrl('ugc-renders', chunkPath, 7200);
        const url = await falRun(
          job.id,
          OMNIHUMAN_MODEL_PATH,
          buildOmniHumanSubmit({ apiKey: falKey, imageUrl, audioUrl: chunkAudioUrl, prompt }),
        );
        const chunkMp4 = join(dir, `chunk-${chunk.seq}.mp4`);
        writeFileSync(chunkMp4, Buffer.from(await (await fetch(url)).arrayBuffer()));
        chunkVideos.push(chunkMp4);
        await rest(`/ugc_job_chunks?job_id=eq.${job.id}&seq=eq.${chunk.seq}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'succeeded' }),
        });
      }

      await patchJob(job.id, { status: 'stitching' });
      const listPath = join(dir, 'list.txt');
      writeFileSync(listPath, buildConcatList(chunkVideos));
      const outPath = join(dir, 'final.mp4');
      await runFfmpeg(buildConcatArgs(listPath, outPath));
      videoBuffer = readFileSync(outPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    const modelPath = engine.startsWith('omnihuman') ? OMNIHUMAN_MODEL_PATH : KLING_AVATAR_MODEL_PATH;
    const submit = engine.startsWith('omnihuman')
      ? buildOmniHumanSubmit({ apiKey: falKey, imageUrl, audioUrl, prompt })
      : buildKlingAvatarSubmit({ apiKey: falKey, imageUrl, audioUrl, prompt });
    const url = await falRun(job.id, modelPath, submit);
    videoBuffer = Buffer.from(await (await fetch(url)).arrayBuffer());
  }

  const path = `${job.user_id}/${job.project_id}/ad-${job.id}.mp4`;
  await uploadRender(path, videoBuffer, 'video/mp4');
  const assetId = await insertAsset({
    project_id: job.project_id,
    user_id: job.user_id,
    kind: 'lipsync_video',
    storage_path: path,
    mime: 'video/mp4',
    bytes: videoBuffer.byteLength,
    duration_seconds: durationSec,
    source: 'generated',
    job_id: job.id,
  });
  await patchJob(job.id, { status: 'succeeded', output_asset_id: assetId, finished_at: new Date().toISOString() });
}

// -------------------------------------------------------------------- loop

async function driveJob(job: JobRow): Promise<void> {
  try {
    if (job.stage === 'composite') await runComposite(job);
    else if (job.stage === 'lipsync') await runLipsync(job);
    else if (job.stage === 'voice') {
      // Serverless normally settles voice inline; a queued voice job here
      // means that path timed out. Fail + refund; the user simply retries.
      throw new ContentRejection('voice takes run inline; this one timed out');
    } else {
      throw new ContentRejection(`stage ${job.stage} is not enabled`);
    }
  } catch (e) {
    const errorClass = classify(e);
    const attempts = job.attempts + 1;
    const terminal = isTerminalFailure(errorClass, attempts);
    console.error(`[${job.id}] ${job.stage} attempt ${attempts} ${errorClass}: ${(e as Error).message}`);
    if (terminal) {
      await patchJob(job.id, {
        status: 'failed',
        error: (e as Error).message.slice(0, 500),
        error_class: errorClass,
        attempts,
        finished_at: new Date().toISOString(),
      });
      const refund = await rpc('ugc_refund_job', { p_job_id: job.id });
      if (!refund.ok) console.error(`[${job.id}] REFUND FAILED: ${await refund.text()}`);
    } else {
      await patchJob(job.id, { status: 'queued', worker_id: null, attempts, provider_task_id: null });
    }
  }
}

async function staleScan(): Promise<void> {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const r = await rest(
    `/ugc_jobs?status=in.(submitted,running)&heartbeat_at=lt.${cutoff}&select=id,status,provider_task_id,heartbeat_at`,
  );
  const rows = (await r.json()) as Array<{ id: string; status: string; provider_task_id: string | null; heartbeat_at: string }>;
  for (const row of rows) {
    const action = staleAction(
      {
        status: row.status as never,
        providerTaskId: row.provider_task_id,
        heartbeatAtMs: Date.parse(row.heartbeat_at),
      },
      Date.now(),
    );
    if (action === 'requeue') {
      await patchJob(row.id, { status: 'queued', worker_id: null });
      console.log(`[${row.id}] stale with no provider task: requeued`);
    } else if (action === 'adopt') {
      await patchJob(row.id, { worker_id: WORKER_ID, heartbeat_at: new Date().toISOString() });
      console.log(`[${row.id}] stale WITH provider task: adopted (never resubmitted)`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`ugc-worker ${WORKER_ID} starting against ${SUPABASE_URL}`);
  const inFlight = new Set<Promise<void>>();

  for (;;) {
    try {
      await rest(`/ugc_settings?key=eq.ugc_worker`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          key: 'ugc_worker',
          value: { worker_id: WORKER_ID, at: new Date().toISOString(), in_flight: inFlight.size },
          updated_at: new Date().toISOString(),
        }),
      });
      await staleScan();

      while (inFlight.size < MAX_IN_FLIGHT) {
        const claimed = await rpc('ugc_claim_next_job', { p_worker_id: WORKER_ID });
        if (!claimed.ok) break;
        const rows = (await claimed.json()) as JobRow[];
        if (!rows.length) break;
        const job = rows[0]!;
        console.log(`[${job.id}] claimed (${job.stage})`);
        const p = driveJob(job).finally(() => inFlight.delete(p));
        inFlight.add(p);
      }
    } catch (e) {
      console.error(`tick error: ${(e as Error).message}`);
    }
    await sleep(TICK_MS);
  }
}

void main();
