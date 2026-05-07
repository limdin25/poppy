import { createClient } from '@supabase/supabase-js';
import { buildSystemPrompt } from '../../src/prompts/system-builder.js';
import type { Business, Service, FAQ, CallInfoType } from '../../src/prompts/system-builder.js';
import { requireAuth } from '../lib/auth.js';
import { getBookingTools, getDefaultTools } from '../lib/booking-tools.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const agentId = body.agentId as string | undefined;

    let llmId: string | undefined;

    if (agentId) {
      const { data: agent } = await supabase
        .from('agents')
        .select('retell_llm_id')
        .eq('id', agentId)
        .eq('business_id', businessId)
        .single();
      llmId = agent?.retell_llm_id ?? undefined;
    }

    if (!llmId) {
      const { data: channel } = await supabase
        .from('channels')
        .select('config')
        .eq('business_id', businessId)
        .eq('type', 'voice')
        .limit(1)
        .single();

      if (!channel?.config) {
        return new Response(JSON.stringify({ error: 'No voice channel configured' }), { status: 404 });
      }
      const cfg = channel.config as Record<string, string>;
      llmId = cfg.retell_llm_id;
    }

    if (!llmId) {
      return new Response(JSON.stringify({ error: 'No Retell LLM ID found' }), { status: 404 });
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('name, industry, address, phone, website, greeting, tone, ai_system_prompt')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    let agentOverrides: Record<string, unknown> = {};
    if (agentId) {
      const { data: agent } = await supabase
        .from('agents')
        .select('greeting, tone, ai_system_prompt')
        .eq('id', agentId)
        .single();
      if (agent) agentOverrides = agent;
    }

    const { data: services } = await supabase
      .from('services')
      .select('name, description, price_from, price_to, bookable')
      .eq('business_id', businessId)
      .or(agentId ? `agent_id.is.null,agent_id.eq.${agentId}` : 'agent_id.is.null')
      .order('sort_order');

    const { data: faqs } = await supabase
      .from('faqs')
      .select('question, answer')
      .eq('business_id', businessId)
      .or(agentId ? `agent_id.is.null,agent_id.eq.${agentId}` : 'agent_id.is.null')
      .order('sort_order');

    const { data: callInfoRows } = await supabase
      .from('call_info_types')
      .select('name, enabled, fields')
      .eq('business_id', businessId)
      .or(agentId ? `agent_id.is.null,agent_id.eq.${agentId}` : 'agent_id.is.null')
      .order('sort_order');

    const effectiveGreeting = (agentOverrides.greeting as string) ?? business.greeting;
    const effectiveTone = (agentOverrides.tone as string) ?? business.tone;
    const effectivePrompt = (agentOverrides.ai_system_prompt as string) ?? business.ai_system_prompt;

    const biz: Business = {
      name: business.name,
      industry: business.industry ?? undefined,
      address: business.address ?? undefined,
      phone: business.phone ?? undefined,
      website: business.website ?? undefined,
      greeting: effectiveGreeting ?? undefined,
      tone: effectiveTone ?? undefined,
    };

    const callInfoTypes: CallInfoType[] = (callInfoRows || []).map((r: Record<string, unknown>) => ({
      name: r.name as string,
      enabled: r.enabled as boolean,
      fields: (r.fields as Array<{ name: string; type: string; required?: boolean }>) || [
        { name: (r.name as string).toLowerCase().replace(/\s+/g, '_'), type: 'text', required: false },
      ],
    }));

    const { data: knowledgeSources } = await supabase
      .from('knowledge_sources')
      .select('summary')
      .eq('business_id', businessId)
      .or(agentId ? `agent_id.is.null,agent_id.eq.${agentId}` : 'agent_id.is.null')
      .eq('status', 'synced');

    const knowledgeContent = (knowledgeSources || [])
      .map((s: { summary: string | null }) => s.summary)
      .filter(Boolean)
      .join('\n\n');

    const hasBookable = (services || []).some((s: Record<string, unknown>) => s.bookable);

    let prompt = buildSystemPrompt(
      biz,
      (services || []) as Service[],
      (faqs || []) as FAQ[],
      callInfoTypes,
      'VOICE',
      knowledgeContent || undefined,
    );

    if (effectivePrompt?.trim()) {
      prompt += `\n\n## Custom instructions from the business owner\n${effectivePrompt.trim()}`;
    }

    const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
    const toolSecret = process.env.TOOL_SECRET || '';
    const tools = hasBookable && toolSecret
      ? getBookingTools(appUrl, toolSecret, businessId)
      : getDefaultTools();

    const res = await fetch(`https://api.retellai.com/update-retell-llm/${llmId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ general_prompt: prompt, general_tools: tools }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `Retell update failed: ${err}` }), { status: 500 });
    }

    // Find the Retell agent ID so we can publish + update phone number
    let retellAgentId: string | undefined;
    if (agentId) {
      const { data: agentRow } = await supabase
        .from('agents')
        .select('retell_agent_id')
        .eq('id', agentId)
        .eq('business_id', businessId)
        .single();
      retellAgentId = agentRow?.retell_agent_id ?? undefined;
    }
    if (!retellAgentId) {
      const { data: channel } = await supabase
        .from('channels')
        .select('config')
        .eq('business_id', businessId)
        .eq('type', 'voice')
        .limit(1)
        .maybeSingle();
      retellAgentId = (channel?.config as Record<string, string>)?.retell_agent_id;
    }

    if (retellAgentId) {
      // Publish the agent so the new prompt goes live
      await fetch(`https://api.retellai.com/publish-agent/${retellAgentId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
        body: '{}',
      });

      // Update phone numbers to use the latest published version
      const phoneRes = await fetch('https://api.retellai.com/list-phone-numbers', {
        headers: { Authorization: `Bearer ${RETELL_API_KEY}` },
      });
      if (phoneRes.ok) {
        const phones = await phoneRes.json() as Array<{ phone_number: string; inbound_agent_id?: string }>;
        for (const phone of phones) {
          if (phone.inbound_agent_id === retellAgentId) {
            await fetch(`https://api.retellai.com/update-phone-number/${phone.phone_number}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inbound_agents: [{ agent_id: retellAgentId, weight: 1 }],
              }),
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
