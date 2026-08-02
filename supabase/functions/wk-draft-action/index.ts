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
    .select('id, contact_id, from_e164, to_e164, body, status, channel')
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

    // 2026-08-02: approving a draft is a SEND and gets the same gates as
    // wk-sms-send. This path used to be a side door around all three.
    // (1) recorded opt-out, they texted STOP after the AI drafted this.
    const { data: dnt } = await supa
      .from('wk_contact_tags')
      .select('tag')
      .eq('contact_id', draft.contact_id)
      .eq('tag', 'do-not-text')
      .maybeSingle();
    if (dnt) return json(409, { error: 'This lead opted out (texted STOP). Sending is blocked.' });
    // (2) global kill switch + daily cap.
    const { data: gate } = await supa.rpc('wk_outbound_sms_allowed');
    if (gate && (gate as { allowed?: boolean }).allowed === false) {
      return json(429, { error: 'Outbound sending is blocked', detail: gate });
    }
    // (3) one-agent-per-lead lock, admin bypass, mirror of wk-sms-send.
    const { data: adminRow } = await supa
      .from('admin_users').select('email').eq('email', userResp.user.email ?? '').maybeSingle();
    const { data: senderProfile } = await supa
      .from('profiles').select('workspace_role').eq('id', userResp.user.id).maybeSingle();
    const isAdminSender = !!adminRow || senderProfile?.workspace_role === 'admin';
    if (!isAdminSender && senderProfile?.workspace_role === 'agent') {
      const { data: lockedAgent } = await supa.rpc('wk_contact_locked_agent', { p_contact: draft.contact_id });
      if (lockedAgent && lockedAgent !== userResp.user.id) {
        return json(409, { error: 'This lead has already been contacted by another agent, send blocked.' });
      }
    }

    // A draft answers on the channel the lead used. WhatsApp is the same
    // Messages API with whatsapp: prefixed numbers; rows store bare e164.
    const isWhatsApp = (draft.channel as string | null) === 'whatsapp';
    // WhatsApp 24h-window pre-check: Twilio accepts out-of-window free-form
    // (201 queued) then kills it with 63016 asynchronously. Drafts sit for
    // hours, so approval is exactly where the window is most likely closed.
    if (isWhatsApp) {
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: lastIn } = await supa
        .from('wk_sms_messages')
        .select('id')
        .eq('contact_id', draft.contact_id)
        .eq('direction', 'inbound')
        .eq('channel', 'whatsapp')
        .gte('created_at', dayAgo)
        .limit(1)
        .maybeSingle();
      if (!lastIn) {
        return json(400, {
          error:
            'More than 24 hours since this lead\'s last WhatsApp message, so WhatsApp will not deliver a free reply. Wait for them to message again, or reply by SMS instead.',
        });
      }
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: isWhatsApp ? `whatsapp:${to}` : to,
        From: isWhatsApp ? `whatsapp:${from}` : from,
        Body: body,
        // Real delivery fate flows back via wk-sms-status.
        StatusCallback: `${SUPABASE_URL}/functions/v1/wk-sms-status`,
      }).toString(),
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
