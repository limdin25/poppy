// wk-ai-postcall — runs after a call completes.
//
// Pulled by wk-jobs-worker for jobs of kind='postcall_ai', or invoked directly
// for testing. Reads OpenAI key from the OPENAI_API_KEY secret (falls back to
// wk_ai_settings.openai_api_key with a loud warning if the secret is unset).
//
// FLOW:
//   1. Resolve call_sid → wk_calls.id + wk_recordings.storage_path
//   2. Sign a 10-min URL on the call-recordings bucket
//   3. POST audio to Whisper (whisper-1) → transcript text
//   4. POST transcript to GPT-4o-mini with the postcall_system_prompt
//   5. INSERT wk_transcripts + UPSERT wk_call_intelligence
//   6. UPDATE wk_calls.ai_status='done'
//
// FAIL-SAFE: any non-recoverable error → ai_status='failed', wk_jobs row goes
// dead after 5 attempts; the call + recording remain accessible.
//
// AUTH: service-role bearer (called by wk-jobs-worker or pg_cron).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface AiSettings {
  openai_api_key: string | null;
  postcall_model: string;
  whisper_model: string;
  postcall_system_prompt: string;
  ai_enabled: boolean;
}

async function loadAiSettings(supabase: SupabaseClient): Promise<AiSettings | null> {
  const { data, error } = await supabase.rpc('wk_get_ai_settings');
  if (error || !data || data.length === 0) return null;
  return data[0] as AiSettings;
}

interface IntelligenceJson {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  talk_ratio: number;
  objections: string[];
  next_steps: string[];
}

async function transcribeWithWhisper(
  audioUrl: string,
  apiKey: string,
  model: string
): Promise<string> {
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`audio fetch failed: ${audioResp.status}`);
  const blob = await audioResp.blob();

  const form = new FormData();
  form.append('file', blob, 'recording.mp3');
  form.append('model', model);
  form.append('response_format', 'text');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`whisper failed (${resp.status}): ${t}`);
  }
  return (await resp.text()).trim();
}

async function summariseWithGpt(
  transcript: string,
  apiKey: string,
  model: string,
  systemPrompt: string
): Promise<{ json: IntelligenceJson; costPence: number }> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`chat completion failed (${resp.status}): ${t}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('no completion content');

  const usage = data?.usage ?? {};
  // gpt-4o-mini: $0.15/$0.60 per 1M tokens (in/out) ≈ £0.0001/£0.0005 per 1k.
  // We round to whole pence for storage.
  const inTok = usage.prompt_tokens ?? 0;
  const outTok = usage.completion_tokens ?? 0;
  const costPence = Math.max(1, Math.round(((inTok * 0.012) + (outTok * 0.048)) / 100));

  let json: IntelligenceJson;
  try {
    json = JSON.parse(content);
  } catch (e) {
    throw new Error(`bad JSON from model: ${e}`);
  }

  // Defensive normalisation
  json.summary = String(json.summary ?? '');
  json.sentiment = (['positive', 'neutral', 'negative', 'mixed']
    .includes(json.sentiment as string) ? json.sentiment : 'neutral') as IntelligenceJson['sentiment'];
  json.talk_ratio = Number.isFinite(json.talk_ratio) ? Math.max(0, Math.min(1, json.talk_ratio)) : 0.5;
  json.objections = Array.isArray(json.objections) ? json.objections.map(String) : [];
  json.next_steps = Array.isArray(json.next_steps) ? json.next_steps.map(String) : [];

  return { json, costPence };
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

  let body: { call_sid?: string; call_id?: string };
  try { body = await req.json(); } catch { body = {}; }
  const callSid = body.call_sid ?? null;
  const callIdInput = body.call_id ?? null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const settings = await loadAiSettings(supabase);
  const envOpenAiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
  if (!envOpenAiKey) {
    console.warn('[wk-ai-postcall] OPENAI_API_KEY secret not set — falling back to wk_ai_settings.openai_api_key');
  }
  const openaiKey = envOpenAiKey || settings?.openai_api_key || '';
  if (!settings || !settings.ai_enabled || !openaiKey) {
    return new Response(JSON.stringify({
      skipped: true,
      reason: 'ai disabled or no api key',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Resolve call + recording
  const callQuery = supabase
    .from('wk_calls')
    .select('id, twilio_call_sid')
    .limit(1);
  const { data: callRows } = callIdInput
    ? await callQuery.eq('id', callIdInput)
    : await callQuery.eq('twilio_call_sid', callSid ?? '');
  const call = callRows?.[0];
  if (!call) {
    return new Response(JSON.stringify({ error: 'call not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  await supabase.from('wk_calls').update({ ai_status: 'running' }).eq('id', call.id);

  try {
    const { data: rec } = await supabase
      .from('wk_recordings')
      .select('id, storage_path')
      .eq('call_id', call.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!rec?.storage_path) {
      throw new Error('recording not yet uploaded to storage');
    }

    // 10-minute signed URL on private bucket
    const { data: signed, error: signErr } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(rec.storage_path, 600);
    if (signErr || !signed?.signedUrl) {
      throw new Error(`signed url failed: ${signErr?.message}`);
    }

    const transcript = await transcribeWithWhisper(
      signed.signedUrl,
      openaiKey,
      settings.whisper_model
    );

    await supabase.from('wk_transcripts').insert({
      call_id: call.id,
      source: 'whisper',
      body: transcript,
    });

    const { json: intel, costPence } = await summariseWithGpt(
      transcript,
      openaiKey,
      settings.postcall_model,
      settings.postcall_system_prompt
    );

    await supabase.from('wk_call_intelligence').upsert({
      call_id: call.id,
      summary: intel.summary,
      sentiment: intel.sentiment,
      talk_ratio: intel.talk_ratio,
      objections: intel.objections,
      next_steps: intel.next_steps,
      llm_model: settings.postcall_model,
      cost_pence: costPence,
    }, { onConflict: 'call_id' });

    // Add the AI cost onto the cost row for spend tracking
    await supabase.rpc('wk_add_ai_cost', { p_call_id: call.id, p_pence: costPence })
      .then(() => null, () => null); // best-effort; RPC is created in step D migration

    await supabase.from('wk_calls').update({ ai_status: 'done' }).eq('id', call.id);

    return new Response(JSON.stringify({
      call_id: call.id,
      transcript_chars: transcript.length,
      summary: intel.summary,
      cost_pence: costPence,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('wk-ai-postcall failed for', call.id, msg);
    await supabase.from('wk_calls').update({ ai_status: 'failed' }).eq('id', call.id);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
