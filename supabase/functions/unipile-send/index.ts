// unipile-send — outbound WhatsApp (and email later) via Unipile.
// PR 69 (multi-channel pivot), Hugo 2026-04-27.
//
// Mirrors wk-sms-send / wk-email-send shape so the channel-picker
// can route to it by changing one string. Uses Unipile's /chats endpoint
// to start a chat (sends first message to a new attendee — no tariff gate).
//
// Body:
//   { contact_id: string, body: string, channel_id?: string }
//
// channel_id resolves to a wk_numbers row where provider='unipile' and
// channel='whatsapp' (or 'email'); we use the row's external_id as the
// Unipile account_id.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const UNIPILE_TOKEN = Deno.env.get('UNIPILE_TOKEN') ?? '';
const UNIPILE_DSN = Deno.env.get('UNIPILE_DSN') ?? 'api38.unipile.com:16812';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SendBody {
  contact_id: string;
  body: string;
  /** Pin a specific wk_numbers row as the from-line. Highest priority. */
  channel_id?: string;
  /** PR 86: when set, resolve from wk_campaign_numbers (channel='whatsapp')
   *  for this campaign — same precedence rule wk-dialer-start uses for
   *  voice. Falls through to channel_id, then workspace default. */
  campaign_id?: string;
  /** Public URL to a file in crm-attachments bucket. Fetched server-side and sent as Unipile file attachment. */
  attachment_url?: string;
}

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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
    const agentId = userResp.user.id;

    if (!UNIPILE_TOKEN) {
      return json(200, { error: 'UNIPILE_TOKEN not configured on edge function' });
    }

    let payload: SendBody;
    try {
      payload = (await req.json()) as SendBody;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const contactId = (payload.contact_id ?? '').trim();
    const body = (payload.body ?? '').trim();
    if (!contactId) return json(400, { error: 'contact_id required' });
    if (!body) return json(400, { error: 'body required' });

    // Resolve contact phone.
    const { data: contact } = await supa
      .from('wk_contacts')
      .select('id, phone, name')
      .eq('id', contactId)
      .maybeSingle();
    if (!contact) return json(404, { error: 'Contact not found' });
    const toPhone = (contact.phone as string | null)?.trim();
    if (!toPhone) return json(400, { error: 'Contact has no phone' });

    // Resolve a Unipile WhatsApp account. Precedence (mirrors wk-dialer-start):
    //   1. explicit channel_id (caller pinned a specific number)
    //   2. campaign_id → first wk_campaign_numbers row (lowest priority)
    //      whose wk_numbers row is whatsapp + active
    //   3. workspace default — first active whatsapp wk_numbers row
    let accountRow: { id: string; e164: string; external_id: string } | null = null;

    if (payload.channel_id) {
      const { data } = await supa
        .from('wk_numbers')
        .select('id, e164, external_id, provider, channel, is_active')
        .eq('id', payload.channel_id)
        .maybeSingle();
      if (data && data.provider === 'unipile' && data.channel === 'whatsapp' && data.is_active) {
        accountRow = { id: data.id, e164: data.e164, external_id: data.external_id };
      }
    }

    if (!accountRow && payload.campaign_id) {
      // Pull all campaign-pinned numbers + their wk_numbers details.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pinned } = await (supa.from('wk_campaign_numbers' as any) as any)
        .select('priority, number_id, wk_numbers(id, e164, external_id, provider, channel, is_active)')
        .eq('campaign_id', payload.campaign_id)
        .order('priority', { ascending: true });
      const rows = (pinned ?? []) as Array<{
        priority: number;
        number_id: string;
        wk_numbers: {
          id: string; e164: string; external_id: string;
          provider: string; channel: string; is_active: boolean;
        } | null;
      }>;
      for (const r of rows) {
        const n = r.wk_numbers;
        if (n && n.provider === 'unipile' && n.channel === 'whatsapp' && n.is_active) {
          accountRow = { id: n.id, e164: n.e164, external_id: n.external_id };
          break;
        }
      }
    }

    if (!accountRow) {
      const { data } = await supa
        .from('wk_numbers')
        .select('id, e164, external_id')
        .eq('channel', 'whatsapp')
        .eq('provider', 'unipile')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      accountRow = (data as typeof accountRow) ?? null;
    }
    if (!accountRow?.external_id) {
      return json(200, {
        error:
          'No active Unipile WhatsApp account configured. Connect one via /crm/settings → Channels → Connect WhatsApp.',
      });
    }

    // POST to Unipile: start a chat with attendee + first message text.
    // When an attachment_url is present, fetch the file and send as multipart form data.
    let u: Response;
    if (payload.attachment_url) {
      const fileResp = await fetch(payload.attachment_url);
      if (!fileResp.ok) {
        return json(400, { error: `Failed to fetch attachment: ${fileResp.status}` });
      }
      const fileBlob = await fileResp.blob();
      const filename = payload.attachment_url.split('/').pop() || 'attachment';
      const fd = new FormData();
      fd.append('account_id', accountRow.external_id);
      fd.append('attendees_ids', JSON.stringify([toPhone]));
      fd.append('text', body);
      fd.append('attachments', fileBlob, filename);
      u = await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
        method: 'POST',
        headers: {
          'X-API-KEY': UNIPILE_TOKEN,
          accept: 'application/json',
        },
        body: fd,
      });
    } else {
      u = await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
        method: 'POST',
        headers: {
          'X-API-KEY': UNIPILE_TOKEN,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          account_id: accountRow.external_id,
          attendees_ids: [toPhone],
          text: body,
        }),
      });
    }
    const uText = await u.text();
    if (!u.ok) {
      console.error('[unipile-send] upstream error', u.status, uText);
      return json(200, { error: `Unipile ${u.status}: ${uText.slice(0, 500)}` });
    }
    let uJson: { object?: string; chat_id?: string; message_id?: string; id?: string };
    try { uJson = JSON.parse(uText); } catch { uJson = {}; }

    const externalId = uJson.message_id ?? uJson.chat_id ?? uJson.id ?? null;

    const { data: inserted, error: insErr } = await supa
      .from('wk_sms_messages')
      .insert({
        contact_id: contactId,
        direction: 'outbound',
        channel: 'whatsapp',
        body,
        external_id: externalId,
        from_e164: accountRow.e164,
        to_e164: toPhone,
        status: 'queued',
        created_by: agentId,
        attachment_url: payload.attachment_url ?? null,
      })
      .select('id')
      .single();
    if (insErr) {
      console.error('[unipile-send] db insert failed', insErr);
      return json(200, { external_id: externalId, warning: 'sent via Unipile but local insert failed' });
    }

    await supa
      .from('wk_contacts')
      .update({ last_contact_at: new Date().toISOString() })
      .eq('id', contactId);

    return json(200, {
      message_id: inserted?.id,
      external_id: externalId,
      status: 'queued',
    });
  } catch (e) {
    console.error('[unipile-send] threw', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
