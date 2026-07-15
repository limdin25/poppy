// wk-sms-broadcast — mass SMS. Resolves recipients (explicit ids or a
// tag/stage/all segment), creates a wk_broadcasts row, and enqueues one
// wk_jobs send_sms per recipient with a staggered scheduled_for (throttle) so
// the existing worker sends + logs them and the carrier isn't spam-flagged.
//
// AUTH: any CRM agent or admin (wk_is_agent_or_admin RPC).
//
// Body: {
//   name?, template_body (required), from_e164?, channel? ('sms'),
//   throttle_seconds? (default 3),
//   contact_ids?: string[]           // explicit selection, OR
//   filter?: { all?: boolean, tags?: string[], stage_id?: string }
// }
// Returns: { broadcast_id, total }
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface BroadcastBody {
  name?: string;
  template_body?: string;
  from_e164?: string;
  channel?: string;
  throttle_seconds?: number;
  contact_ids?: string[];
  filter?: { all?: boolean; tags?: string[]; stage_id?: string };
}

const MAX_RECIPIENTS = 5000;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return json(401, { error: 'Missing bearer token' });

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userResp?.user) return json(401, { error: 'Invalid token' });
    const userId = userResp.user.id;

    // Authorize: must be a CRM agent or admin. The RPC reads the caller's JWT,
    // so run it through a client scoped to the caller's token.
    const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
    if (!allowed) return json(403, { error: 'CRM access required' });

    let payload: BroadcastBody;
    try {
      payload = await req.json() as BroadcastBody;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const templateBody = (payload.template_body ?? '').trim();
    if (!templateBody) return json(400, { error: 'template_body required' });
    if (templateBody.length > 1600) return json(400, { error: 'template_body too long (max 1600)' });
    const channel = (payload.channel ?? 'sms').trim();
    if (channel !== 'sms') return json(400, { error: 'only channel=sms supported' });
    const throttle = Math.max(0, Math.min(60, Number(payload.throttle_seconds ?? 3) || 0));
    const fromE164 = (payload.from_e164 ?? '').trim() || null;

    // ── Resolve recipients ──────────────────────────────────────────────────
    let contactIds: string[] = [];
    if (payload.contact_ids && payload.contact_ids.length) {
      contactIds = [...new Set(payload.contact_ids.map((s) => String(s).trim()).filter(Boolean))];
    } else {
      const filter = payload.filter ?? {};
      if (filter.tags && filter.tags.length) {
        const { data } = await supa
          .from('wk_contact_tags')
          .select('contact_id')
          .in('tag', filter.tags);
        contactIds = [...new Set((data ?? []).map((r: { contact_id: string }) => r.contact_id))];
      } else {
        let q = supa.from('wk_contacts').select('id');
        if (filter.stage_id) q = q.eq('pipeline_column_id', filter.stage_id);
        else if (!filter.all) return json(400, { error: 'no recipients: pass contact_ids or filter {all|tags|stage_id}' });
        const { data } = await q.limit(MAX_RECIPIENTS + 1);
        contactIds = (data ?? []).map((r: { id: string }) => r.id);
      }
    }

    if (!contactIds.length) return json(400, { error: 'no recipients matched' });
    if (contactIds.length > MAX_RECIPIENTS) {
      return json(400, { error: `too many recipients (${contactIds.length} > ${MAX_RECIPIENTS})` });
    }

    // ── Create the broadcast row ────────────────────────────────────────────
    const { data: bc, error: bcErr } = await supa
      .from('wk_broadcasts')
      .insert({
        name: (payload.name ?? '').trim() || `Blast ${new Date().toISOString().slice(0, 16)}`,
        channel,
        template_body: templateBody,
        from_e164: fromE164,
        filter: payload.filter ?? (payload.contact_ids ? { contact_ids: contactIds.length } : {}),
        throttle_seconds: throttle,
        total: contactIds.length,
        status: 'sending',
        created_by: userId,
      })
      .select('id')
      .single();
    if (bcErr || !bc) return json(500, { error: bcErr?.message ?? 'failed to create broadcast' });
    const broadcastId = bc.id as string;

    // ── Enqueue staggered send_sms jobs ─────────────────────────────────────
    const now = Date.now();
    const rows = contactIds.map((cid, i) => ({
      kind: 'send_sms',
      status: 'pending',
      scheduled_for: new Date(now + i * throttle * 1000).toISOString(),
      payload: {
        contact_id: cid,
        body: templateBody,
        from_e164: fromE164 ?? undefined,
        broadcast_id: broadcastId,
        agent_id: userId,
      },
    }));

    // Insert in chunks to stay well under statement limits.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: jobErr } = await supa.from('wk_jobs').insert(rows.slice(i, i + CHUNK) as never);
      if (jobErr) return json(500, { error: `enqueue failed: ${jobErr.message}` });
    }

    return json(200, { broadcast_id: broadcastId, total: contactIds.length, throttle_seconds: throttle });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
