import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;

function retellHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${RETELL_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {

    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('id, name, ai_system_prompt, greeting, tone')
      .eq('id', businessId)
      .single();

    if (bizErr || !business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    // Step 1: Create Retell LLM with the business system prompt
    const llmRes = await fetch('https://api.retellai.com/create-retell-llm', {
      method: 'POST',
      headers: retellHeaders(),
      body: JSON.stringify({
        general_prompt: business.ai_system_prompt || `You are the AI receptionist for ${business.name}.`,
        model: 'gpt-4.1-mini',
        general_tools: [{ name: 'end_call', type: 'end_call' }],
      }),
    });

    if (!llmRes.ok) {
      const err = await llmRes.text();
      return new Response(JSON.stringify({ error: `Failed to create LLM: ${err}` }), { status: 500 });
    }

    const llm = await llmRes.json() as { llm_id: string };

    // Step 2: Create Retell Agent referencing the LLM
    const agentRes = await fetch('https://api.retellai.com/create-agent', {
      method: 'POST',
      headers: retellHeaders(),
      body: JSON.stringify({
        agent_name: `${business.name} Receptionist`,
        response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
        voice_id: 'retell-Willa',
        language: 'en-GB',
        enable_backchannel: true,
        begin_message: business.greeting || null,
        webhook_url: `${process.env.APP_URL || 'https://poppy-henna.vercel.app'}/api/webhooks/retell`,
      }),
    });

    if (!agentRes.ok) {
      const err = await agentRes.text();
      return new Response(JSON.stringify({ error: `Failed to create agent: ${err}` }), { status: 500 });
    }

    const agent = await agentRes.json() as { agent_id: string };

    // Step 3: Store in channels table
    const { error: channelErr } = await supabase.from('channels').insert({
      business_id: businessId,
      type: 'voice',
      status: 'connected',
      config: {
        retell_agent_id: agent.agent_id,
        retell_llm_id: llm.llm_id,
      },
    });

    if (channelErr) {
      return new Response(JSON.stringify({ error: channelErr.message }), { status: 500 });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        agentId: agent.agent_id,
        llmId: llm.llm_id,
      }),
      { status: 200 },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
