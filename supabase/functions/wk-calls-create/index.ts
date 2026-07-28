// wk-calls-create — pre-dial allocator for the manual softphone "Call" button.
//
// Frontend (softphone, contact rows, inbox, dialer "Call now") calls this
// BEFORE invoking Twilio Device.connect. We:
//   1. Verify agent JWT.
//   2. Run the spend / killswitch gate (wk_check_spend RPC).
//   3. Resolve the agent's caller-ID number (default → first voice-enabled).
//   4. Validate the contact (resolves to an existing wk_contacts row owned
//      by this agent or, if admin, any row).
//   5. INSERT a wk_calls row with status='queued' and our own UUID; return
//      that UUID as call_id so the browser can pass it as a TwiML param.
//   6. wk-voice-twiml-outgoing later UPDATEs the row with the Twilio CallSid
//      + status='in_progress' instead of inserting a duplicate.
//
// AUTH: Supabase JWT (verify_jwt = true via supabase/config.toml).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  contact_id?: string;
  to_phone?: string;
  campaign_id?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return jsonResponse(401, { error: 'Missing bearer token' });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userResp?.user) {
      return jsonResponse(401, { error: 'Invalid token' });
    }
    const agentId = userResp.user.id;

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON' });
    }
    const phone = (body.to_phone ?? '').trim();
    const contactId = body.contact_id ?? null;
    const campaignId = body.campaign_id ?? null;
    if (!phone) {
      return jsonResponse(400, { error: 'to_phone required' });
    }

    // Spend / killswitch gate. Returns { allowed, reason, daily_spend_pence,
    // daily_limit_pence, is_admin }.
    const { data: spend } = await supa.rpc('wk_check_spend', { p_agent_id: agentId });
    const spendObj = (spend ?? {}) as {
      allowed?: boolean;
      reason?: string;
      daily_spend_pence?: number;
      daily_limit_pence?: number;
    };
    if (spendObj.allowed === false) {
      return jsonResponse(200, {
        allowed: false,
        reason: spendObj.reason ?? 'spend_blocked',
        daily_spend_pence: spendObj.daily_spend_pence ?? 0,
        daily_limit_pence: spendObj.daily_limit_pence ?? null,
      });
    }

    // Resolve caller-ID number. Precedence:
    //   1. Campaign pin — wk_campaign_numbers row joined to a voice-
    //      enabled wk_numbers entry, lowest priority wins (same pattern
    //      the SMS send paths use for their from-line).
    //   2. Agent profile default (profiles.default_caller_id_number_id).
    //   3. Workspace fallback — first voice-enabled number ever created.
    //
    // 2026-05-22 (Hugo): added step 1. Previously the function only
    // consulted profile + workspace fallback, so a campaign-level pin
    // was silently ignored and outbound calls fell through to the
    // agent's own default line.
    let fromE164: string | null = null;
    let numberId: string | null = null;

    const campaignIdForCaller = body.campaign_id ?? null;
    if (campaignIdForCaller) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pinned } = await (supa.from('wk_campaign_numbers' as any) as any)
        .select('priority, wk_numbers(id, e164, voice_enabled, is_active)')
        .eq('campaign_id', campaignIdForCaller)
        .order('priority', { ascending: true });
      const rows = (pinned ?? []) as Array<{
        priority: number;
        wk_numbers: { id: string; e164: string; voice_enabled: boolean; is_active: boolean } | null;
      }>;
      for (const r of rows) {
        const n = r.wk_numbers;
        if (n && n.voice_enabled && n.is_active) {
          fromE164 = n.e164;
          numberId = n.id;
          break;
        }
      }
    }

    if (!fromE164) {
      const { data: profile } = await supa
        .from('profiles')
        .select('default_caller_id_number_id')
        .eq('id', agentId)
        .maybeSingle();
      if (profile?.default_caller_id_number_id) {
        const { data: num } = await supa
          .from('wk_numbers')
          .select('id, e164')
          .eq('id', profile.default_caller_id_number_id)
          .maybeSingle();
        if (num) {
          fromE164 = num.e164;
          numberId = num.id;
        }
      }
    }

    if (!fromE164) {
      const { data: anyNum } = await supa
        .from('wk_numbers')
        .select('id, e164')
        .eq('voice_enabled', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (anyNum) {
        fromE164 = anyNum.e164;
        numberId = anyNum.id;
      }
    }

    // Validate contact (best effort — direct dials may not have a row yet,
    // and DialPad sends synthetic ids like "manual-1714567890000").
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let resolvedContactId: string | null = null;
    if (contactId && UUID_RE.test(contactId)) {
      const { data: contact } = await supa
        .from('wk_contacts')
        .select('id')
        .eq('id', contactId)
        .maybeSingle();
      resolvedContactId = contact?.id ?? null;
    }

    // One-agent-per-lead lock (2026-07-28): mirrors wk-sms-send. Once ANY
    // agent has texted or called this contact, no OTHER agent may dial it.
    // Admin never checks or sets the lock. Manual dials with no resolved
    // contact (DialPad synthetic ids) have nothing to lock, so skip.
    if (resolvedContactId) {
      const { data: adminRow } = await supa
        .from('admin_users')
        .select('email')
        .eq('email', userResp.user.email ?? '')
        .maybeSingle();
      const { data: callerProfile } = await supa
        .from('profiles')
        .select('workspace_role')
        .eq('id', agentId)
        .maybeSingle();
      const isAdminCaller = !!adminRow || callerProfile?.workspace_role === 'admin';
      if (!isAdminCaller && callerProfile?.workspace_role === 'agent') {
        const { data: lockedAgent } = await supa.rpc('wk_contact_locked_agent', { p_contact: resolvedContactId });
        if (lockedAgent && lockedAgent !== agentId) {
          return jsonResponse(200, {
            allowed: false,
            reason: 'already contacted by another agent',
          });
        }
      }
    }

    // Live AI coach gate — workspace-level toggle in wk_ai_settings. We mint
    // the call with ai_coach_enabled=true ONLY if all three are set: the
    // master ai_enabled flag, the live_coach_enabled flag, AND an OpenAI key.
    // The env secret OPENAI_API_KEY is the primary key source (same policy
    // as wk-voice-transcription / wk-ai-postcall); the DB column
    // wk_ai_settings.openai_api_key is only a fallback. wk-voice-twiml-outgoing
    // reads this flag back to decide whether to inject the live-transcription
    // TwiML for the call.
    let aiCoachEnabled = false;
    try {
      const { data: ai } = await supa
        .from('wk_ai_settings')
        .select('ai_enabled, live_coach_enabled, openai_api_key')
        .limit(1)
        .maybeSingle();
      aiCoachEnabled = !!(
        ai &&
        ai.ai_enabled &&
        ai.live_coach_enabled &&
        (Deno.env.get('OPENAI_API_KEY') ||
          (ai.openai_api_key && String(ai.openai_api_key).length > 0))
      );
    } catch {
      aiCoachEnabled = false;
    }

    // INSERT the wk_calls row with status='queued' and our minted UUID.
    const { data: inserted, error: insErr } = await supa
      .from('wk_calls')
      .insert({
        agent_id: agentId,
        contact_id: resolvedContactId,
        campaign_id: campaignId,
        number_id: numberId,
        direction: 'outbound',
        status: 'queued',
        from_e164: fromE164,
        to_e164: phone,
        started_at: new Date().toISOString(),
        ai_coach_enabled: aiCoachEnabled,
      })
      .select('id')
      .single();

    if (insErr || !inserted) {
      console.error('wk-calls-create insert failed', insErr);
      return jsonResponse(500, { error: 'Failed to mint call row' });
    }

    // Pre-warm wk-voice-transcription so its pod is hot by the time Twilio
    // fires the first transcription-content webhook. Fire-and-forget —
    // never blocks dialing.
    if (aiCoachEnabled) {
      const warmupUrl = `${SUPABASE_URL}/functions/v1/wk-voice-transcription?warmup=1`;
      void fetch(warmupUrl, { method: 'GET' }).catch(() => null);
    }

    return jsonResponse(200, {
      allowed: true,
      call_id: inserted.id,
      from_e164: fromE164,
      to_e164: phone,
    });
  } catch (e) {
    console.error('wk-calls-create error', e);
    return jsonResponse(500, { error: 'Internal error' });
  }
});
