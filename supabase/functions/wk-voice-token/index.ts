// wk-voice-token — mints a Twilio Voice SDK access token for an authenticated agent.
//
// AUTH MODEL:
//   - Caller MUST send Authorization: Bearer <supabase_jwt>
//   - We resolve the user from the JWT, confirm workspace_role IN ('agent','admin'),
//     and use profiles.id (uuid) as the Twilio Client identity.
//
// CREDS REQUIRED:
//   - TWILIO_ACCOUNT_SID
//   - TWILIO_API_KEY_SID         (NEW — created in Twilio console)
//   - TWILIO_API_KEY_SECRET      (NEW — created in Twilio console)
//   - TWILIO_TWIML_APP_SID       (NEW — TwiML App pointing to wk-voice-twiml-outgoing)
//
// If any of the three new vars are missing, returns 503 with a clear message.
// Source of truth: supabase/config.toml (verify_jwt = false; we check JWT manually).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_API_KEY_SID = Deno.env.get('TWILIO_API_KEY_SID') ?? '';
const TWILIO_API_KEY_SECRET = Deno.env.get('TWILIO_API_KEY_SECRET') ?? '';
const TWILIO_TWIML_APP_SID = Deno.env.get('TWILIO_TWIML_APP_SID') ?? '';

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---- Minimal HS256 JWT signer (Twilio Access Tokens use HS256 with API Key Secret) ----
function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signJwt(payload: Record<string, unknown>, secret: string, header: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${base64url(new Uint8Array(sig))}`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Cred presence check — return clear 503 instead of cryptic crash
  const missing: string[] = [];
  if (!TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
  if (!TWILIO_API_KEY_SID) missing.push('TWILIO_API_KEY_SID');
  if (!TWILIO_API_KEY_SECRET) missing.push('TWILIO_API_KEY_SECRET');
  if (!TWILIO_TWIML_APP_SID) missing.push('TWILIO_TWIML_APP_SID');
  if (missing.length > 0) {
    return new Response(
      JSON.stringify({
        error: 'Voice SDK not configured',
        missing_env: missing,
        hint: 'Create Twilio API Key + TwiML App, then set these as Supabase secrets.',
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Resolve calling user from Supabase JWT
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Missing bearer token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userResp?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const user = userResp.user;

    // Confirm workspace role
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, workspace_role, agent_extension')
      .eq('id', user.id)
      .maybeSingle();
    if (profileErr) {
      return new Response(JSON.stringify({ error: 'Profile lookup failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Admin = email exists in the admin_users allow-list table
    const { data: adminRow } = await supabase
      .from('admin_users')
      .select('email')
      .ilike('email', user.email ?? '') // case-insensitive — admin_users.email has no lowercase constraint
      .maybeSingle();
    const isAdmin = !!adminRow;
    const role = profile?.workspace_role;
    if (!isAdmin && role !== 'agent' && role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Not a workspace agent' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PR 145 (Hugo 2026-04-28): REVERT PR 143's identity suffix.
    //
    // Phase-1 audit evidence (Twilio Debugger + REST-API isolation):
    //   - The bare REST API can dial these destinations from this caller-
    //     ID just fine (test calls completed with status busy/completed).
    //   - The TwiML our function returns is byte-for-byte valid (verified
    //     via signed webhook simulation).
    //   - The same destination via the SDK → Application SID path fails
    //     with `error_code: 13224 "invalid phone number"` and the SDK
    //     surfaces it as `31404 NotFound` / `31486 BusyHere` (SIP
    //     semantics for "the bridged Client identity isn't found / is
    //     busy").
    //   - Timeline: ~50% of calls completed BEFORE PR 143 (no suffix);
    //     ~0% completed AFTER PR 143 (with `:` suffix).
    //
    // Diagnosis: `:` is a reserved SIP URI delimiter (RFC 3261). Twilio's
    // signaling layer mis-parses `client:user.id:session.id` as a SIP
    // URI prefix and the bridge-target lookup at `<Dial>` time can't
    // resolve back to the calling Client → the dial leg fails with
    // 13224. The wk_voice_sessions table created in PR 143 stays in
    // place but is now unused (no readers, no writers).
    //
    // Multi-tab collisions are a separate, secondary concern that the
    // 50% pre-PR-143 success rate shows is not the dominant failure
    // mode. If we want multi-tab protection later we'll use a non-SIP
    // -reserved separator (`_`, `.`, `-`) — not `:`.
    const identity = user.id;

    const now = Math.floor(Date.now() / 1000);

    // Twilio Access Token JWT format (per Twilio docs)
    const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' };
    const payload = {
      jti: `${TWILIO_API_KEY_SID}-${now}`,
      iss: TWILIO_API_KEY_SID,
      sub: TWILIO_ACCOUNT_SID,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
      grants: {
        identity,
        voice: {
          incoming: { allow: true },
          outgoing: { application_sid: TWILIO_TWIML_APP_SID },
        },
      },
    };
    const token = await signJwt(payload, TWILIO_API_KEY_SECRET, header);

    return new Response(
      JSON.stringify({
        token,
        identity,
        ttl_seconds: TOKEN_TTL_SECONDS,
        extension: profile?.agent_extension ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('wk-voice-token error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
