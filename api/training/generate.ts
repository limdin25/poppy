import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

export const config = { runtime: 'edge' };

async function getModelForBusiness(businessId: string): Promise<string> {
  const { data } = await supabase
    .from('businesses')
    .select('ai_model')
    .eq('id', businessId)
    .single();
  if (data?.ai_model?.startsWith('claude')) return data.ai_model;
  const { data: setting } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'ai_model')
    .single();
  return setting?.value || 'claude-sonnet-4-6';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  const body = await req.json() as { agent_id?: string };
  const agentId = body.agent_id;

  const query = supabase
    .from('knowledge_sources')
    .select('name, type, url, summary, content')
    .eq('business_id', businessId)
    .eq('status', 'synced');

  if (agentId) {
    query.or(`agent_id.is.null,agent_id.eq.${agentId}`);
  }

  const { data: sources } = await query;

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

  const model = await getModelForBusiness(businessId);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are setting up an AI receptionist for a business. Based on the training data below, generate a complete agent configuration.

Business name: ${business?.name || 'Unknown'}
Industry: ${business?.industry || 'Unknown'}

## Training data:
${trainingContent}

## Generate the following as JSON:

{
  "greeting": "A warm, natural opening greeting (1-2 sentences). Include the business name.",
  "tone": "One of: professional, friendly, casual, formal — pick what fits the business best",
  "instructions": "Custom instructions for the AI receptionist (2-4 sentences). How should it handle calls? What's the priority?",
  "rules": ["Array of 3-5 strict rules the AI must follow, e.g. 'Never quote exact prices', 'Always take a callback number'"],
  "services": [{"name": "Service Name"}],
  "faqs": [{"question": "Common question?", "answer": "Helpful answer based on the training data"}],
  "info_fields": ["Caller name", "Phone number", "Email address", "Nature of enquiry"]
}

Rules:
- Generate 3-8 services based on what the business offers
- Generate 4-8 FAQs with real answers from the training data
- Info fields should be relevant to this type of business
- Keep the greeting under 200 characters
- Make rules specific to this business type
- Return ONLY valid JSON, no markdown, no explanation`,
      }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    return new Response(JSON.stringify({ error: `AI generation failed: ${res.status} ${errBody.slice(0, 200)}` }), { status: 500 });
  }

  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const config = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify({ config }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to parse generated config' }), { status: 500 });
  }
}
