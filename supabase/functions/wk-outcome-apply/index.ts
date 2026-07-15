// wk-outcome-apply — the post-call outcome click handler.
//
// Called when an agent clicks an outcome button (or keyboard 1-9, or timeout
// fires the default). All side-effects run inside a single Postgres transaction
// via the wk_apply_outcome RPC. Returns the list of automations that fired so
// the UI can show "✅ Moved to Interested · SMS sent · Task created".
//
// AUTH: Supabase JWT — agent must own the call (RPC enforces this).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ApplyBody {
  call_id: string;
  contact_id: string | null;
  column_id: string;
  agent_note?: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Missing bearer token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: ApplyBody;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!body.call_id || !body.column_id) {
      return new Response(JSON.stringify({ error: 'call_id and column_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Per-request client carrying the user JWT so the RPC sees auth.uid()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data, error } = await supabase.rpc('wk_apply_outcome', {
      p_call_id: body.call_id,
      p_contact_id: body.contact_id ?? null,
      p_column_id: body.column_id,
      p_agent_note: body.agent_note ?? null,
    });

    if (error) {
      const status = error.message?.includes('forbidden') ? 403 : 500;
      return new Response(JSON.stringify({ error: error.message }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PR 30 (Hugo 2026-04-27): wk_apply_outcome inserts a send_sms
    // job into wk_jobs when the picked column has SMS automation.
    // No scheduler drains the queue, so the SMS sat there forever.
    // Fire-and-forget kick to wk-jobs-worker right now.
    kickJobsWorker();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('wk-outcome-apply error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// PR 37 (Hugo 2026-04-27): wrapped in EdgeRuntime.waitUntil so the
// kick survives the webhook's 200 response. The original void-fetch
// version was being cancelled the moment serve() returned.
function kickJobsWorker(): void {
  const url = `${SUPABASE_URL}/functions/v1/wk-jobs-worker`;
  const promise = fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
    .then((r) => {
      if (!r.ok) {
        console.warn('[wk-outcome-apply] kick wk-jobs-worker non-2xx', r.status);
      }
    })
    .catch((e) => {
      console.warn('[wk-outcome-apply] kick wk-jobs-worker failed', e);
    });
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === 'function') {
    er.waitUntil(promise);
  } else {
    void promise;
  }
}
