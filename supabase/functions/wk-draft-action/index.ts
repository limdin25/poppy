// wk-draft-action — approve/edit/discard an AI draft reply.
//   { draft_id, action: 'send', body? }  → send via Twilio, mark row sent.
//   { draft_id, action: 'discard' }      → mark the draft discarded.
// AUTH: any CRM agent or admin (wk_is_agent_or_admin).
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Missing bearer token' });

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: userResp } = await supa.auth.getUser(jwt);
  if (!userResp?.user) return json(401, { error: 'Invalid token' });
  const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return json(403, { error: 'CRM access required' });

  let payload: { draft_id?: string; action?: string; body?: string };
  try { payload = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const draftId = (payload.draft_id ?? '').trim();
  const action = (payload.action ?? '').trim();
  if (!draftId) return json(400, { error: 'draft_id required' });

  const { data: draft } = await supa
    .from('wk_sms_messages')
    .select('id, contact_id, from_e164, to_e164, body, status')
    .eq('id', draftId).maybeSingle();
  if (!draft) return json(404, { error: 'draft not found' });
  if (draft.status !== 'draft') return json(409, { error: 'not a pending draft' });

  if (action === 'discard') {
    await supa.from('wk_sms_messages').update({ status: 'discarded' }).eq('id', draftId);
    return json(200, { ok: true, status: 'discarded' });
  }

  if (action === 'send') {
    const body = (payload.body ?? draft.body ?? '').trim();
    const from = (draft.from_e164 as string | null) || '';
    const to = (draft.to_e164 as string | null) || '';
    if (!from || !to) return json(400, { error: 'draft missing from/to number' });
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return json(500, { error: 'Twilio creds not set' });
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!resp.ok) return json(500, { error: `Twilio ${resp.status}: ${(await resp.text()).slice(0, 200)}` });
    const tw = await resp.json() as { sid?: string; status?: string };
    await supa.from('wk_sms_messages')
      .update({ status: tw.status ?? 'sent', body, twilio_sid: tw.sid ?? null, external_id: tw.sid ?? null })
      .eq('id', draftId);
    await supa.from('wk_contacts').update({ last_contact_at: new Date().toISOString() }).eq('id', draft.contact_id);
    return json(200, { ok: true, status: tw.status ?? 'sent' });
  }

  return json(400, { error: 'unknown action' });
});
