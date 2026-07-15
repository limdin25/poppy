// wk-ai-template — generate / refine SMS / WhatsApp / Email templates.
// PR 88, Hugo 2026-04-27.
//
// Body:
//   {
//     mode: 'generate' | 'refine',
//     channel: 'sms' | 'whatsapp' | 'email' | null,
//     name?: string,        // hint for generate; existing name for refine
//     subject?: string,     // for email refine
//     body?: string,        // existing body for refine
//     model?: string,       // optional override; default gpt-4o-mini
//   }
//
// Returns: { name, subject, body, model_used }
//
// Behavior:
//   - generate: from a short hint (name) + channel, produce a sensible
//     template. Always populates name + body. For email, also subject.
//   - refine: improve an existing draft. Preserves structure, fixes
//     phrasing, makes it sound natural for the channel.
//
// Templates use {first_name} / {agent_first_name} placeholders (PR 87
// substitution helper accepts both single + double brace).

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_MODELS = new Set([
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
]);

const DEFAULT_MODEL = 'gpt-4o-mini';

interface Body {
  mode?: 'generate' | 'refine';
  channel?: 'sms' | 'whatsapp' | 'email' | null;
  name?: string;
  subject?: string;
  body?: string;
  model?: string;
}

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function buildSystemPrompt(channel: string, mode: string): string {
  const channelGuide =
    channel === 'sms'
      ? 'SMS: keep it under 160 chars. No emoji. Plain text.'
      : channel === 'whatsapp'
        ? 'WhatsApp: 1–3 short sentences. Conversational. Light emoji OK if natural. No URLs unless asked.'
        : channel === 'email'
          ? 'Email: 3–6 sentences with line breaks. Friendly but professional. Subject is a short hook (max 60 chars). No greeting line like "Dear" — start with "Hi {first_name},"'
          : 'Universal: must read well as SMS, WhatsApp, or Email. Keep under 200 chars body, neutral tone.';

  const modeGuide =
    mode === 'refine'
      ? 'You are REFINING an existing draft. Preserve intent and structure. Fix grammar, awkward phrasing, and make it sound natural for the channel. Do NOT invent new content or change the offer.'
      : 'You are GENERATING a new template from scratch using the provided name as a hint about the purpose.';

  return `You are an expert UK CRM copywriter (GBP, British English).

${modeGuide}

${channelGuide}

Templates MUST use these merge tags exactly:
  - {first_name}        \u2014 contact's first name
  - {agent_first_name}  \u2014 sending agent's first name

Use single curly braces. Do NOT use {{double braces}}.

Return STRICT JSON only \u2014 no markdown, no commentary:
{
  "name": "short label for the template (4 words max)",
  "subject": "email subject line, or empty string for SMS/WhatsApp",
  "body": "the template body with merge tags"
}`;
}

function buildUserPrompt(b: Body): string {
  const parts: string[] = [];
  parts.push(`Channel: ${b.channel ?? 'universal'}`);
  if (b.name) parts.push(`Name / purpose: ${b.name}`);
  if (b.mode === 'refine') {
    if (b.subject) parts.push(`Existing subject: ${b.subject}`);
    if (b.body) parts.push(`Existing body:\n${b.body}`);
    parts.push('\nRefine the above. Return JSON.');
  } else {
    parts.push('\nGenerate a fresh template. Return JSON.');
  }
  return parts.join('\n');
}

interface AiOut {
  name?: string;
  subject?: string;
  body?: string;
}

function parseAiJson(raw: string): AiOut {
  // Strip ```json fences if the model used them.
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  try {
    const j = JSON.parse(s);
    return {
      name: typeof j.name === 'string' ? j.name : undefined,
      subject: typeof j.subject === 'string' ? j.subject : undefined,
      body: typeof j.body === 'string' ? j.body : undefined,
    };
  } catch {
    return { body: s };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const mode: 'generate' | 'refine' = body.mode === 'refine' ? 'refine' : 'generate';
  const channel = body.channel ?? 'universal';
  const requestedModel = (body.model ?? '').trim();
  const model =
    requestedModel && ALLOWED_MODELS.has(requestedModel)
      ? requestedModel
      : DEFAULT_MODEL;

  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    return json(503, { error: 'OPENAI_API_KEY not configured' });
  }

  const systemPrompt = buildSystemPrompt(channel, mode);
  const userPrompt = buildUserPrompt(body);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: mode === 'refine' ? 0.4 : 0.7,
        response_format: { type: 'json_object' },
        max_tokens: 600,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[wk-ai-template] OpenAI error', res.status, errText);
      return json(200, {
        error: `OpenAI ${res.status}: ${errText.slice(0, 400)}`,
      });
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed = parseAiJson(raw);

    return json(200, {
      name: (parsed.name ?? body.name ?? '').trim(),
      subject: (parsed.subject ?? '').trim(),
      body: (parsed.body ?? '').trim(),
      model_used: model,
    });
  } catch (e) {
    console.error('[wk-ai-template] threw', e);
    return json(500, {
      error: e instanceof Error ? e.message : 'Internal error',
    });
  }
});
