// wk-schedule-send — queue a follow-up SMS to a contact for later (nurture).
// Enqueues a send_sms wk_job with a future scheduled_for; the worker sends it
// unless the lead replied in the meantime (skip_if_inbound_after). Agreements
// ride the same path — pass the template body/link as `body`.
//
// AUTH: any CRM agent or admin.
// Body: { contact_id, body (required), from_e164?, delay_hours (default 24),
//         auto_cancel_on_reply (default true) }
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Missing bearer token' });
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: userResp } = await supa.auth.getUser(jwt);
  if (!userResp?.user) return json(401, { error: 'Invalid token' });
  const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return json(403, { error: 'CRM access required' });

  let p: { contact_id?: string; body?: string; from_e164?: string; delay_hours?: number; auto_cancel_on_reply?: boolean };
  try { p = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const contactId = (p.contact_id ?? '').trim();
  const body = (p.body ?? '').trim();
  if (!contactId) return json(400, { error: 'contact_id required' });
  if (!body) return json(400, { error: 'body required' });
  const delayHours = Math.max(0, Number(p.delay_hours ?? 24) || 0);
  const scheduledFor = new Date(Date.now() + delayHours * 3600 * 1000).toISOString();
  const autoCancel = p.auto_cancel_on_reply !== false;

  const { error } = await supa.from('wk_jobs').insert({
    kind: 'send_sms',
    status: 'pending',
    scheduled_for: scheduledFor,
    payload: {
      contact_id: contactId,
      body,
      from_e164: (p.from_e164 ?? '').trim() || undefined,
      agent_id: userResp.user.id,
      ...(autoCancel ? { skip_if_inbound_after: new Date().toISOString() } : {}),
    },
  });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, scheduled_for: scheduledFor });
});
