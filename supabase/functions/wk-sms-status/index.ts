// wk-sms-status: Twilio delivery-status callback for CRM sends (2026-08-02).
//
// Why this exists: Twilio ACCEPTS a WhatsApp free-form message outside the
// 24h window (201, status queued) and only fails it AFTERWARDS with error
// 63016 on the status callback. Without this function a dead send sat at
// 'queued' forever while the agent saw a green "sent" toast. Same for SMS:
// "the status webhook does not write back, believe Twilio, not the CRM row"
// stops being true the day this ships.
//
// Wired by wk-sms-send and wk-draft-action passing StatusCallback on
// Messages.create. Updates wk_sms_messages.status by twilio_sid, forward-only
// (an out-of-order 'sent' after 'delivered' must not regress the row).
//
// Signature validation: same fail-closed Twilio HMAC-SHA1 as wk-sms-incoming.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-twilio-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signature === expected;
}

// Forward-only ordering. A callback can arrive out of order; a lower rank
// never overwrites a higher one. failed/undelivered are terminal.
const STATUS_RANK: Record<string, number> = {
  queued: 0,
  accepted: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  undelivered: 5,
  failed: 5,
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const params: Record<string, string> = {};
  try {
    const formData = await req.formData();
    formData.forEach((v, k) => { params[k] = v.toString(); });
  } catch {
    return new Response('Bad request', { status: 400, headers: corsHeaders });
  }

  const sig = req.headers.get('x-twilio-signature') ?? '';
  const publicUrl = `${SUPABASE_URL}/functions/v1/wk-sms-status`;
  if (!TWILIO_AUTH_TOKEN || !sig ||
      !(await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, publicUrl, params))) {
    console.error('[wk-sms-status] signature rejected (fail closed)');
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }

  try {
    const messageSid = params.MessageSid ?? params.SmsSid ?? '';
    const status = (params.MessageStatus ?? params.SmsStatus ?? '').toLowerCase();
    const errorCode = params.ErrorCode ?? '';
    if (!messageSid || !status || !(status in STATUS_RANK)) {
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: row } = await supa
      .from('wk_sms_messages')
      .select('id, status')
      .eq('twilio_sid', messageSid)
      .maybeSingle();
    if (!row) {
      // Not a CRM message (reviews product, dialer SMS, etc.), not ours.
      return new Response('ok', { status: 200, headers: corsHeaders });
    }

    const currentRank = STATUS_RANK[(row.status as string | null) ?? ''] ?? -1;
    if (STATUS_RANK[status] > currentRank) {
      await supa.from('wk_sms_messages').update({ status }).eq('id', row.id);
      if (errorCode) {
        // 63016 = WhatsApp free-form outside the 24h window; the send LOOKED
        // accepted and died here. Loud log so the pattern is findable.
        console.error(`[wk-sms-status] sid=${messageSid} -> ${status} error=${errorCode}`);
      } else {
        console.log(`[wk-sms-status] sid=${messageSid} -> ${status}`);
      }
    }

    return new Response('ok', { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error('[wk-sms-status] threw', e);
    // 200 so Twilio doesn't retry-spam an event we cannot process.
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
});
