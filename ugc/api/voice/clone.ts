// Custom voice clone: audio sample in (base64 JSON, small and dependency
// free), Fish fast-trains a private model, the reference lands in ugc_voices
// as the caller's own voice. The 100-credit abuse buffer debits through the
// same enqueue RPC as everything else.

import type { IncomingMessage, ServerResponse } from 'http';
import { json, readJsonBody, requireUser, serviceRpc } from '../_lib/http.js';
import { buildCloneRequest } from '../../src/core/providers/fish.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const user = await requireUser(req);
  if (!user) return json(res, 401, { error: 'Sign in first' });

  const fishKey = process.env.FISH_API_KEY;
  const base = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!fishKey) return json(res, 500, { error: 'Voice cloning is not configured' });

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: 'Bad JSON' });
  }
  const name = String(body.name ?? '').trim();
  const sampleBase64 = String(body.sample_base64 ?? '');
  const mime = String(body.mime ?? 'audio/wav');
  const projectId = String(body.project_id ?? '');
  const idempotencyKey = String(body.idempotency_key ?? '');
  if (!name || !sampleBase64 || !projectId || !idempotencyKey) {
    return json(res, 400, { error: 'name, sample_base64, project_id and idempotency_key are required' });
  }
  const sample = Buffer.from(sampleBase64, 'base64');
  if (sample.byteLength < 50_000) {
    return json(res, 400, { error: 'That sample is too short; record at least 30 seconds' });
  }

  // Debit the clone through the same gate as everything else. voice_clone is
  // billed via the price book by a dedicated stage in the worker later; for
  // the serverless path we reuse the voice stage input marker.
  const enqueue = await fetch(`${base}/rest/v1/rpc/ugc_enqueue_job`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: req.headers.authorization!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_stage: 'voice',
      p_project_id: projectId,
      p_input: { clone: true, name },
      p_idempotency_key: idempotencyKey,
    }),
  });
  if (!enqueue.ok) return json(res, 402, { error: await enqueue.text() });
  const [{ job_id: jobId }] = (await enqueue.json()) as Array<{ job_id: string }>;

  const request = buildCloneRequest({ apiKey: fishKey, title: `ugc-${user.userId.slice(0, 8)}-${name}` });
  const form = new FormData();
  for (const [k, v] of Object.entries(request.fields)) form.append(k, v);
  form.append('voices', new Blob([sample], { type: mime }), 'sample.wav');

  const upstream = await fetch(request.url, { method: 'POST', headers: request.headers, body: form });
  if (!upstream.ok) {
    await serviceRpc('ugc_refund_job', { p_job_id: jobId });
    return json(res, 502, { error: `Cloning failed (${upstream.status}); your credits were refunded` });
  }
  const model = (await upstream.json()) as { _id?: string };
  if (!model._id) {
    await serviceRpc('ugc_refund_job', { p_job_id: jobId });
    return json(res, 502, { error: 'Fish returned no model id; your credits were refunded' });
  }

  const insert = await fetch(`${base}/rest/v1/ugc_voices`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      user_id: user.userId,
      provider_voice_id: model._id,
      name,
      kind: 'cloned',
    }),
  });
  const [voice] = (await insert.json()) as Array<{ id: string; name: string }>;

  await fetch(`${base}/rest/v1/ugc_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'succeeded', provider: 'fish', finished_at: new Date().toISOString() }),
  });

  return json(res, 200, { voice_id: voice.id, name: voice.name });
}
