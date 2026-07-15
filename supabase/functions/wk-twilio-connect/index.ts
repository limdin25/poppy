// wk-twilio-connect — admin manages the workspace's Twilio account.
//
// Actions (POST body):
//   { action: 'state' }
//     → returns { connected, account_sid, friendly_name, numbers: [...] }
//
//   { action: 'connect', account_sid, auth_token }
//     → validates against Twilio API, stores account_sid + friendly_name in
//       wk_twilio_account (the auth token is NOT persisted — runtime creds
//       come from env), fetches incoming-phone-numbers and upserts wk_numbers.
//
//   { action: 'disconnect' }
//     → clears wk_twilio_account row. Does NOT delete wk_numbers.
//
//   { action: 'sync_numbers' }
//     → re-pulls numbers from Twilio and upserts wk_numbers.
//
//   { action: 'toggle_number', e164, enabled }
//     → flips wk_numbers.voice_enabled.
//
// AUTH: admin only (wk_is_admin RPC).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// ----- Twilio helpers ---------------------------------------------------

interface TwilioAccount {
  sid: string;
  friendly_name: string;
  status: string;
}

interface TwilioNumber {
  sid: string;
  phone_number: string;
  friendly_name?: string;
  trunk_sid?: string | null;
  capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean };
}

async function twilioGetAccount(
  sid: string,
  token: string
): Promise<{ ok: boolean; data?: TwilioAccount; error?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`;
  const auth = btoa(`${sid}:${token}`);
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    let msg = `Twilio ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
    } catch { /* ignore */ }
    return { ok: false, error: msg };
  }
  const data = (await res.json()) as TwilioAccount;
  return { ok: true, data };
}

async function twilioListNumbers(
  sid: string,
  token: string
): Promise<{ ok: boolean; data?: TwilioNumber[]; error?: string }> {
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json` +
    `?PageSize=200`;
  const auth = btoa(`${sid}:${token}`);
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) return { ok: false, error: `Twilio list ${res.status}` };
  const body = (await res.json()) as { incoming_phone_numbers?: TwilioNumber[] };
  return { ok: true, data: body.incoming_phone_numbers ?? [] };
}

// ----- Server -----------------------------------------------------------

interface ConnectBody {
  action: 'connect';
  account_sid: string;
  auth_token: string;
}
interface ToggleBody {
  action: 'toggle_number';
  e164: string;
  enabled: boolean;
}
type Body =
  | { action: 'state' }
  | { action: 'disconnect' }
  | { action: 'sync_numbers' }
  | ConnectBody
  | ToggleBody;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return json(401, { error: 'Missing bearer token' });

    const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userResp, error: userErr } = await caller.auth.getUser(jwt);
    if (userErr || !userResp?.user) return json(401, { error: 'Invalid token' });
    const { data: isAdmin, error: adminErr } = await caller.rpc('wk_is_admin');
    if (adminErr) return json(500, { error: adminErr.message });
    if (!isAdmin) return json(403, { error: 'Admin only' });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    // ---- state -------------------------------------------------------
    if (body.action === 'state') {
      const { data: acc } = await admin
        .from('wk_twilio_account')
        .select('account_sid, friendly_name, connected_at')
        .eq('id', 'default')
        .maybeSingle();
      const { data: numbers } = await admin
        .from('wk_numbers')
        .select(
          'id, e164, twilio_sid, voice_enabled, sms_enabled, recording_enabled, max_calls_per_minute, cooldown_seconds_after_call'
        )
        .order('e164', { ascending: true });
      return json(200, {
        connected: !!acc,
        account_sid: acc?.account_sid ?? null,
        friendly_name: acc?.friendly_name ?? null,
        connected_at: acc?.connected_at ?? null,
        numbers: numbers ?? [],
      });
    }

    // ---- connect -----------------------------------------------------
    if (body.action === 'connect') {
      const sid = (body.account_sid ?? '').trim();
      const token = (body.auth_token ?? '').trim();
      if (!sid.startsWith('AC') || sid.length < 20)
        return json(400, { error: 'Account SID must start with AC' });
      if (token.length < 16) return json(400, { error: 'Auth token looks too short' });

      const acc = await twilioGetAccount(sid, token);
      if (!acc.ok) return json(400, { error: `Twilio rejected credentials: ${acc.error}` });

      const { error: upErr } = await admin.from('wk_twilio_account').upsert(
        {
          id: 'default',
          account_sid: sid,
          // Auth token is deliberately NOT persisted — runtime creds come from
          // env (TWILIO_AUTH_TOKEN). Column is NOT NULL, so store ''.
          auth_token: '',
          friendly_name: acc.data?.friendly_name ?? null,
          connected_by: userResp.user.id,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (upErr) return json(500, { error: upErr.message });

      // Pull numbers and seed wk_numbers
      const list = await twilioListNumbers(sid, token);
      if (list.ok && list.data) {
        for (const n of list.data) {
          // Numbers attached to a SIP trunk belong to another system —
          // insert them disabled ONCE, then never touch their flags/label
          // again (admin may have opted a trunk number in via toggle_number,
          // and label is the admin-editable note column).
          if (n.trunk_sid) {
            await admin.from('wk_numbers').upsert(
              {
                e164: n.phone_number,
                twilio_sid: n.sid,
                sms_enabled: false,
                voice_enabled: false,
                label: n.friendly_name ?? null,
              },
              { onConflict: 'e164', ignoreDuplicates: true }
            );
          } else {
            await admin.from('wk_numbers').upsert(
              {
                e164: n.phone_number,
                twilio_sid: n.sid,
                sms_enabled: !!n.capabilities?.sms,
                // voice stays disabled by default — admin opts in per-number
              },
              { onConflict: 'e164' }
            );
          }
        }
      }

      await admin.from('wk_audit_log').insert({
        actor_id: userResp.user.id,
        action: 'twilio_connected',
        entity_type: 'twilio_account',
        meta: { account_sid: sid, numbers: list.data?.length ?? 0 },
      });

      return json(200, {
        connected: true,
        account_sid: sid,
        friendly_name: acc.data?.friendly_name,
        numbers_synced: list.data?.length ?? 0,
      });
    }

    // ---- disconnect --------------------------------------------------
    if (body.action === 'disconnect') {
      const { error } = await admin.from('wk_twilio_account').delete().eq('id', 'default');
      if (error) return json(500, { error: error.message });
      await admin.from('wk_audit_log').insert({
        actor_id: userResp.user.id,
        action: 'twilio_disconnected',
        entity_type: 'twilio_account',
      });
      return json(200, { connected: false });
    }

    // ---- sync_numbers -----------------------------------------------
    if (body.action === 'sync_numbers') {
      const { data: acc } = await admin
        .from('wk_twilio_account')
        .select('account_sid')
        .eq('id', 'default')
        .maybeSingle();
      if (!acc) return json(400, { error: 'Twilio not connected' });
      // Auth token is not stored in the DB — runtime creds come from env.
      if (!TWILIO_AUTH_TOKEN) return json(500, { error: 'TWILIO_AUTH_TOKEN not configured' });
      const list = await twilioListNumbers(acc.account_sid, TWILIO_AUTH_TOKEN);
      if (!list.ok) return json(502, { error: list.error });
      let synced = 0;
      for (const n of list.data ?? []) {
        // Numbers attached to a SIP trunk belong to another system —
        // insert them disabled ONCE, then never touch their flags/label
        // again (admin may have opted a trunk number in via toggle_number,
        // and label is the admin-editable note column).
        if (n.trunk_sid) {
          await admin.from('wk_numbers').upsert(
            {
              e164: n.phone_number,
              twilio_sid: n.sid,
              sms_enabled: false,
              voice_enabled: false,
              label: n.friendly_name ?? null,
            },
            { onConflict: 'e164', ignoreDuplicates: true }
          );
        } else {
          await admin.from('wk_numbers').upsert(
            {
              e164: n.phone_number,
              twilio_sid: n.sid,
              sms_enabled: !!n.capabilities?.sms,
              // voice stays disabled by default — admin opts in per-number
            },
            { onConflict: 'e164' }
          );
        }
        synced++;
      }
      return json(200, { numbers_synced: synced });
    }

    // ---- toggle_number ----------------------------------------------
    if (body.action === 'toggle_number') {
      const { error } = await admin
        .from('wk_numbers')
        .update({ voice_enabled: body.enabled })
        .eq('e164', body.e164);
      if (error) return json(500, { error: error.message });
      return json(200, { e164: body.e164, voice_enabled: body.enabled });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('wk-twilio-connect error', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
