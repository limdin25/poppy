import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { callLLM, getModelForAgent } from '../lib/llm.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  const body = await req.json() as { agent_id?: string };
  const agentId = body.agent_id;

  const ksFilter = agentId ? `agent_id.eq.${agentId}` : 'agent_id.is.null';

  const { data: sources } = await supabase
    .from('knowledge_sources')
    .select('name, type, url, summary, content')
    .eq('business_id', businessId)
    .or(ksFilter)
    .eq('status', 'synced');

  if (!sources?.length) {
    return new Response(JSON.stringify({ error: 'No training data available. Add a website, document, or pasted text first.' }), { status: 400 });
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('name, industry, address, phone, website')
    .eq('id', businessId)
    .single();

  const trainingContent = sources
    .map((s) => {
      const label = s.type === 'website' ? `Website (${s.url})` : `Document (${s.name})`;
      return `### ${label}\n${s.summary || s.content || ''}`;
    })
    .join('\n\n');

  const model = await getModelForAgent(businessId, agentId);

  const systemPrompt = `Based on the training data provided, generate a COMPLETE agent configuration as JSON. Analyse the training data carefully and generate content that matches its purpose, tone, and intent exactly. Do NOT impose any specific role or framing — let the training data define what the agent does.

You must fill in EVERY field in the JSON structure. Do not skip any section. Think carefully about what timing, automation, and notification settings make sense for this specific agent based on the training data.

Return ONLY valid JSON, no markdown, no explanation, no code fences.`;

  const userContent = `Business: ${business?.name || 'Unknown'}
Industry: ${business?.industry || 'Unknown'}

## Training data:
${trainingContent}

## Generate this COMPLETE JSON structure (every field is required):

{
  "greeting": "A natural opening message (1-2 sentences) that fits the training data's purpose and tone",
  "tone": "One of: professional, friendly, casual, formal",
  "instructions": "Custom instructions for the agent (2-4 sentences) based on the training data's intent and purpose",
  "rules": ["Array of 3-5 strict rules the agent must always follow, derived from the training data"],
  "services": [{"name": "Service or capability name"}],
  "faqs": [{"question": "Relevant question?", "answer": "Answer based on the training data"}],
  "info_fields": ["Relevant data fields to collect from contacts"],

  "takeover_delay_seconds": 300,
  "after_hours_delay_seconds": 0,
  "working_hours_start": 8,
  "working_hours_end": 22,
  "working_days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],

  "auto_reply_enabled": true,
  "draft_mode": false,
  "follow_up_enabled": true,
  "follow_up_max_attempts": 2,
  "follow_up_delay_hours": [7200, 86400],
  "follow_up_preferred_channel": "same_channel",
  "follow_up_tone": "friendly",
  "follow_up_prompt": "A follow-up message template with {name} placeholder",

  "confirmation_enabled": true,
  "confirmation_delay_seconds": 1,
  "confirmation_channels": ["whatsapp", "sms", "email"],
  "reminder_enabled": true,
  "reminder_times_seconds": [86400, 3600],
  "reminder_channels": ["whatsapp", "sms", "email"],
  "owner_confirmation_enabled": true,
  "owner_reminder_enabled": true,
  "owner_reminder_times_seconds": [86400]
}

Rules for generation:
- Generate 3-8 services/capabilities based on what the training data describes
- Generate 4-8 FAQs with real answers from the training data
- Keep the greeting under 200 characters
- Make rules specific to this agent's purpose
- For timing: choose values that make sense for this agent's use case (e.g. a dating bot should reply fast with low delay; a business receptionist might have longer delays)
- takeover_delay_seconds: how long to wait before AI takes over (in seconds). Fast-response agents should use 60-300, slow ones 600-1800
- after_hours_delay_seconds: delay for after-hours messages (0 = reply immediately even after hours)
- follow_up_delay_hours: array of delays in SECONDS between follow-up attempts (e.g. [7200, 86400] = 2 hours then 24 hours)
- reminder_times_seconds: array of reminder times before appointments in SECONDS (e.g. [86400, 3600] = 24h and 1h before)
- follow_up_prompt: write a follow-up message that fits the agent's tone and purpose, include {name} placeholder
- draft_mode: false means auto-send, true means create draft for human review
- Return ONLY valid JSON`;

  const text = await callLLM(model, systemPrompt, [{ role: 'user', content: userContent }], 4000);

  if (!text) {
    return new Response(JSON.stringify({ error: 'AI generation failed' }), { status: 500 });
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const config = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify({ config }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to parse generated config' }), { status: 500 });
  }
}
