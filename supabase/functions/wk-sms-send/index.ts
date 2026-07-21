// wk-sms-send — outbound SMS for /crm. PR 50, Hugo 2026-04-27.
//
// Body:
//   { contact_id: string, body: string, from_e164?: string }
//
// 1. Verify JWT, look up the agent.
// 2. Resolve the wk_contact to get phone.
// 3. POST to Twilio Messages.create.
// 4. INSERT a wk_sms_messages row with direction='outbound' +
//    twilio_sid + status mapped from Twilio's response.
// 5. Return { message_id, twilio_sid }.
//
// Companion to wk-sms-incoming. Both write into the same table.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SendBody {
  contact_id: string;
  body: string;
  // Optional — defaults to the workspace's first voice/SMS-enabled
  // wk_numbers row. Pass when an agent has multiple lines.
  from_e164?: string;
  /** PR 96 (Hugo 2026-04-28): when set, resolve from-line via
   *  wk_campaign_numbers (channel='sms') for this campaign, mirroring
   *  the other channel send paths. Falls through to from_e164 then
   *  workspace default. */
  campaign_id?: string;
  /** Public URL to a file in crm-attachments bucket. Sent as Twilio MMS MediaUrl. */
  attachment_url?: string;
}

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Normalise a loosely-typed phone into E.164. UK contacts are often stored in
// national format (07…) which Twilio rejects (error 21211); default unknown
// leading-zero numbers to +44.
function normalizeE164(raw: string): string {
  let s = (raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (s.startsWith('0')) return '+44' + s.slice(1); // UK national
  return '+' + s;
}

// Rough country class for from/to matching: GB (+44) vs North America (+1).
const countryClass = (e164: string): string =>
  e164.startsWith('+44') ? 'gb' : e164.startsWith('+1') ? 'na' : 'other';

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

    let payload: SendBody;
    try {
      payload = await req.json() as SendBody;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const contactId = (payload.contact_id ?? '').trim();
    const body = (payload.body ?? '').trim();
    if (!contactId) return json(400, { error: 'contact_id required' });
    if (!body) return json(400, { error: 'body required' });
    if (body.length > 1600) return json(400, { error: 'body too long (max 1600 chars)' });

    // Resolve contact's phone.
    const { data: contact, error: contactErr } = await supa
      .from('wk_contacts')
      .select('id, phone, name')
      .eq('id', contactId)
      .maybeSingle();
    if (contactErr) return json(500, { error: contactErr.message });
    if (!contact) return json(404, { error: 'Contact not found' });

    const toE164 = normalizeE164((contact.phone as string | null) ?? '');
    if (!toE164) return json(400, { error: 'Contact has no phone number' });

    // Resolve sender number. Precedence (same order as the send_sms job
    // handler in wk-jobs-worker — the two paths must route alike):
    //   1. explicit from_e164 (caller pinned)
    //   2. campaign_id → first wk_campaign_numbers row whose wk_numbers
    //      row is sms_enabled
    //   3. workspace default — first sms_enabled wk_numbers row
    let fromE164 = (payload.from_e164 ?? '').trim();

    // Security: an explicit from_e164 must be a CRM-owned, SMS-enabled
    // number. Without this, a logged-in agent could pin a client's
    // receptionist caller-ID (e.g. a UK Retell line, sms_enabled=false)
    // and send SMS spoofing it. The campaign/default paths below only ever
    // pick sms_enabled wk_numbers rows, so they are already safe.
    if (fromE164) {
      const { data: ownedNumber } = await supa
        .from('wk_numbers')
        .select('e164')
        .eq('e164', fromE164)
        .eq('channel', 'sms')
        .eq('sms_enabled', true)
        .maybeSingle();
      if (!ownedNumber) {
        return json(403, { error: 'from_e164 is not a CRM-owned SMS-enabled number' });
      }
    }

    if (!fromE164 && payload.campaign_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pinned } = await (supa.from('wk_campaign_numbers' as any) as any)
        .select('priority, number_id, wk_numbers(id, e164, channel, sms_enabled, is_active)')
        .eq('campaign_id', payload.campaign_id)
        .order('priority', { ascending: true });
      const pinnedRows = (pinned ?? []) as Array<{
        priority: number;
        number_id: string;
        wk_numbers: { id: string; e164: string; channel: string; sms_enabled: boolean; is_active: boolean } | null;
      }>;
      for (const r of pinnedRows) {
        const n = r.wk_numbers;
        if (n && n.channel === 'sms' && n.sms_enabled && n.is_active) {
          fromE164 = n.e164;
          break;
        }
      }
    }

    // 2.5. The sending agent's assigned number(s) (wk_number_agents). Prefer a
    //      number whose country matches the destination (UK contact -> the
    //      agent's UK number), then their primary, then any. This is what lets
    //      an admin hand each agent their own line(s).
    if (!fromE164) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: assigned } = await (supa.from('wk_number_agents' as any) as any)
        .select('is_primary, wk_numbers(e164, channel, sms_enabled, is_active)')
        .eq('agent_id', agentId);
      const rows = ((assigned ?? []) as Array<{
        is_primary: boolean;
        wk_numbers: { e164: string; channel: string; sms_enabled: boolean; is_active: boolean } | null;
      }>).filter((r) => r.wk_numbers && r.wk_numbers.channel === 'sms' && r.wk_numbers.sms_enabled && r.wk_numbers.is_active);
      if (rows.length) {
        const dest = countryClass(toE164);
        const match = rows.find((r) => countryClass(r.wk_numbers!.e164) === dest);
        const primary = rows.find((r) => r.is_primary);
        fromE164 = (match ?? primary ?? rows[0]).wk_numbers!.e164;
      }
    }

    // 3. Workspace default: prefer one whose country matches the destination,
    //    else the first SMS-enabled number.
    if (!fromE164) {
      const { data: nums } = await supa
        .from('wk_numbers')
        .select('e164')
        .eq('sms_enabled', true)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      const list = ((nums ?? []) as Array<{ e164: string }>).map((n) => n.e164);
      const dest = countryClass(toE164);
      fromE164 = list.find((e) => countryClass(e) === dest) ?? list[0] ?? '';
    }
    if (!fromE164) {
      return json(503, { error: 'No SMS-enabled number configured (wk_numbers)' });
    }

    // C2: honour the global kill switch + daily SMS cap before spending.
    const { data: gate } = await supa.rpc('wk_outbound_sms_allowed');
    if (gate && (gate as { allowed?: boolean }).allowed === false) {
      return json(429, { error: 'Outbound sending is blocked', detail: gate });
    }

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return json(503, { error: 'Twilio creds not set on edge function secrets' });
    }

    // POST to Twilio Messages.create.
    // MMS (MediaUrl) only works in US/Canada. UK numbers get the
    // attachment as a clickable link appended to the body instead.
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth64 = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    let smsBody = body;
    if (payload.attachment_url) {
      smsBody = `${body}\n\n${payload.attachment_url}`;
    }
    const form = new URLSearchParams({
      To: toE164,
      From: fromE164,
      Body: smsBody,
    });
    const twResp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth64}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!twResp.ok) {
      const errText = await twResp.text();
      console.error('[wk-sms-send] twilio error', twResp.status, errText);
      return json(502, { error: `Twilio ${twResp.status}: ${errText}` });
    }
    const twJson = await twResp.json() as {
      sid?: string;
      status?: string;
    };

    // Persist the outbound row. We always write, even if Twilio's
    // response is unparseable — the message has left.
    const { data: inserted, error: insErr } = await supa
      .from('wk_sms_messages')
      .insert({
        contact_id: contactId,
        direction: 'outbound',
        // PR 96: was implicit (DB default 'sms'); now explicit so the
        // row carries its channel like every other send path and the
        // inbox channel-glyph rendering is correct.
        channel: 'sms',
        body,
        twilio_sid: twJson.sid ?? null,
        external_id: twJson.sid ?? null,
        from_e164: fromE164,
        to_e164: toE164,
        status: twJson.status ?? 'queued',
        created_by: agentId,
        attachment_url: payload.attachment_url ?? null,
      })
      .select('id')
      .single();

    if (insErr) {
      console.error('[wk-sms-send] db insert failed (twilio sent though)', insErr);
      return json(200, {
        twilio_sid: twJson.sid ?? null,
        warning: 'sent via Twilio but local insert failed',
      });
    }

    // Bump wk_contacts.last_contact_at so the inbox sorts correctly.
    await supa
      .from('wk_contacts')
      .update({ last_contact_at: new Date().toISOString() })
      .eq('id', contactId);

    return json(200, {
      message_id: inserted?.id,
      twilio_sid: twJson.sid ?? null,
      status: twJson.status ?? 'queued',
    });
  } catch (e) {
    console.error('[wk-sms-send] threw', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
