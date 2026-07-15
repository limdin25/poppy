export const config = { runtime: 'edge' };

/**
 * CRM jobs pump. Runs every minute (vercel.json). The cloned CRM's
 * wk-jobs-worker (queued SMS, recording ingest, post-call AI, cost compute)
 * and wk-dialer-tick (re-queue orphaned dials, retry webhook outbox) have no
 * scheduler of their own — this cron drives both. Each Supabase edge function
 * self-authenticates against the service-role key.
 */
export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET || '';
  const authHeader = req.headers.get('authorization') || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  // Dedicated shared key: Vercel's SUPABASE_SERVICE_ROLE_KEY (legacy JWT) no
  // longer matches the key the edge runtime injects (new sb_secret format),
  // so the worker/tick authenticate on CRM_JOBS_KEY instead.
  const serviceKey = process.env.CRM_JOBS_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const fnBase = `${supabaseUrl}/functions/v1`;

  async function call(fn: string, body: unknown) {
    try {
      const res = await fetch(`${fnBase}/${fn}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
    } catch (e) {
      return { ok: false, status: 0, body: String(e) };
    }
  }

  // Independent — one failing must not block the other; next tick retries.
  const [jobs, tick] = await Promise.all([
    call('wk-jobs-worker', { batch: 10 }),
    call('wk-dialer-tick', {}),
  ]);

  return new Response(JSON.stringify({ jobs, tick }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
