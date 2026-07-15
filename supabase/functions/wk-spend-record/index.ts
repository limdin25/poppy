// wk-spend-record — runs after a call completes, called by wk-jobs-worker
// for jobs of kind='compute_cost'.
//
// Pulls the carrier price from Twilio's Calls REST API (this is the truth —
// our duration estimate is just a placeholder), stores it via wk_record_carrier_cost
// (which also bumps the agent's daily spend + flips block_outbound if cap is hit).
//
// AUTH: service-role bearer.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

// Twilio prices in USD; we convert to GBP pence for storage.
// Approximate live rate is fetched daily by a separate job; default fallback.
const USD_TO_GBP = parseFloat(Deno.env.get('USD_TO_GBP') ?? '0.79');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface TwilioCall {
  sid: string;
  status: string;
  duration: string;          // seconds, as string
  price: string | null;      // negative USD as string, e.g. "-0.0085"
  price_unit: string | null; // "USD"
}

async function fetchTwilioCall(callSid: string): Promise<TwilioCall | null> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!resp.ok) return null;
  return await resp.json() as TwilioCall;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '') !== SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { call_sid?: string };
  try { body = await req.json(); } catch { body = {}; }
  const callSid = body.call_sid ?? '';
  if (!callSid) {
    return new Response(JSON.stringify({ error: 'missing call_sid' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: call } = await supabase
    .from('wk_calls')
    .select('id, duration_sec')
    .eq('twilio_call_sid', callSid)
    .maybeSingle();
  if (!call) {
    return new Response(JSON.stringify({ error: 'call not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Try the real Twilio price first
  const tCall = await fetchTwilioCall(callSid);
  let pence = 0;
  if (tCall?.price && tCall.price_unit === 'USD') {
    const usd = Math.abs(parseFloat(tCall.price));
    const gbp = usd * USD_TO_GBP;
    pence = Math.max(1, Math.round(gbp * 100));
  } else {
    // Fallback: 4p/min UK landline-mobile estimate
    const minutes = Math.max(0.1, (call.duration_sec ?? 0) / 60);
    pence = Math.max(1, Math.round(minutes * 4));
  }

  const { error } = await supabase.rpc('wk_record_carrier_cost', {
    p_call_id: call.id,
    p_pence: pence,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    call_id: call.id,
    carrier_pence: pence,
    source: tCall?.price ? 'twilio' : 'estimate',
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
