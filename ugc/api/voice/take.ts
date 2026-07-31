// A paid voice take, inline for a fast approve loop: enqueue (the RPC debits
// under the user's own JWT so auth.uid() is real), synthesise with Fish,
// upload the wav, insert the asset, settle the job. If Fish fails after the
// debit, the job fails and the refund RPC compensates immediately.

import type { IncomingMessage, ServerResponse } from 'http';
import { json, readJsonBody, requireUser, serviceRpc } from '../_lib/http';
import { buildTtsRequest, wavDurationSeconds } from '../../src/core/providers/fish';

async function userRpc(req: IncomingMessage, fn: string, args: Record<string, unknown>): Promise<Response> {
  const base = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: req.headers.authorization!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const user = await requireUser(req);
  if (!user) return json(res, 401, { error: 'Sign in first' });

  const fishKey = process.env.FISH_API_KEY;
  const base = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!fishKey) return json(res, 500, { error: 'Voice generation is not configured' });

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Bad JSON' });
  }
  const projectId = String(body.project_id ?? '');
  const script = String(body.script ?? '');
  const voiceId = String(body.voice_id ?? '');
  const idempotencyKey = String(body.idempotency_key ?? '');
  if (!projectId || !script || !voiceId || !idempotencyKey) {
    return json(res, 400, { error: 'project_id, script, voice_id and idempotency_key are required' });
  }

  // The voice row: curated, or one of the caller's clones.
  const voiceRow = await fetch(
    `${base}/rest/v1/ugc_voices?id=eq.${voiceId}&or=(kind.eq.curated,user_id.eq.${user.userId})&select=provider_voice_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  const voiceRows = (await voiceRow.json()) as Array<{ provider_voice_id: string }>;
  if (!voiceRows[0]) return json(res, 404, { error: 'Voice not found' });

  // Gate + debit under the USER's JWT (auth.uid() must be the real caller).
  const enqueue = await userRpc(req, 'ugc_enqueue_job', {
    p_stage: 'voice',
    p_project_id: projectId,
    p_input: { script_chars: script.length, voice_id: voiceId },
    p_idempotency_key: idempotencyKey,
  });
  if (!enqueue.ok) return json(res, 402, { error: await enqueue.text() });
  const [{ job_id: jobId, credits_debited: creditsDebited }] = (await enqueue.json()) as Array<{
    job_id: string;
    credits_debited: number;
  }>;

  let request;
  try {
    request = buildTtsRequest({ apiKey: fishKey, text: script, referenceId: voiceRows[0].provider_voice_id });
  } catch (e) {
    await serviceRpc('ugc_refund_job', { p_job_id: jobId });
    return json(res, 400, { error: (e as Error).message });
  }

  const started = Date.now();
  const upstream = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (!upstream.ok) {
    await serviceRpc('ugc_refund_job', { p_job_id: jobId });
    await fetch(`${base}/rest/v1/ugc_jobs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed', error: `Fish ${upstream.status}`, finished_at: new Date().toISOString() }),
    });
    return json(res, 502, { error: `Voice generation failed (${upstream.status}); your credits were refunded` });
  }

  const wav = Buffer.from(await upstream.arrayBuffer());
  const durationSec = wavDurationSeconds(wav.byteLength, request.body.sample_rate);
  const path = `${user.userId}/${projectId}/voice-${jobId}.wav`;

  const upload = await fetch(`${base}/storage/v1/object/ugc-renders/${path}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'audio/wav' },
    body: new Uint8Array(wav),
  });
  if (!upload.ok) {
    await serviceRpc('ugc_refund_job', { p_job_id: jobId });
    return json(res, 502, { error: 'Could not store the take; your credits were refunded' });
  }

  const assetInsert = await fetch(`${base}/rest/v1/ugc_assets`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      project_id: projectId,
      user_id: user.userId,
      kind: 'voice_audio',
      storage_path: path,
      mime: 'audio/wav',
      bytes: wav.byteLength,
      duration_seconds: durationSec,
      source: 'generated',
      job_id: jobId,
    }),
  });
  const [asset] = (await assetInsert.json()) as Array<{ id: string }>;

  await fetch(`${base}/rest/v1/ugc_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'succeeded',
      provider: 'fish',
      output_asset_id: asset.id,
      finished_at: new Date().toISOString(),
    }),
  });

  const signed = await fetch(`${base}/storage/v1/object/sign/ugc-renders/${path}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 86400 }),
  });
  const signedBody = (await signed.json()) as { signedURL?: string };

  res.setHeader('X-Fish-Ms', String(Date.now() - started));
  return json(res, 200, {
    asset_id: asset.id,
    job_id: jobId,
    credits_debited: creditsDebited,
    duration_seconds: durationSec,
    url: signedBody.signedURL ? `${base}/storage/v1${signedBody.signedURL}` : null,
  });
}
