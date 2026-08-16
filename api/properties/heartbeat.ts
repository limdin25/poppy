// The overnight machine's pulse. POSTed by pipeline_loop.sh on the VPS after
// each completed stage, so the deadman (api/cron/system-deadman.ts) can tell a
// dead overnight from a quiet one. Before this the only failure signal was the
// morning report NOT arriving, and the report runs at the END of the pipeline,
// so a run killed at stage two alerted nobody (15 Aug: the 8h timeout killed
// the run mid Gemini re-read and nothing repriced, silently).
//
// Same auth as ingest: the shared secret the scraper already keeps in
// data/elsie.json. The stamp lands in platform_settings, Elsie's existing
// key-value table, exactly like the sweep's own heartbeat.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const secret = process.env.PROPERTY_INGEST_SECRET;
  if (!secret || req.headers.get('x-ingest-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  let stage = '';
  try {
    const body = await req.json() as { stage?: string };
    stage = String(body.stage ?? '').slice(0, 120);
  } catch { /* a bare POST still counts as a pulse */ }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await supabase.from('platform_settings').upsert({
    key: 'vps_overnight_last_ok_at',
    value: JSON.stringify({ at: new Date().toISOString(), stage }),
  }, { onConflict: 'key' });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
