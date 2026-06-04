import { createClient } from '@supabase/supabase-js';
import { buildSystemPrompt } from '../../src/prompts/system-builder.js';
import type { Business, Service, FAQ, CallInfoType } from '../../src/prompts/system-builder.js';
import { requireAuth } from '../lib/auth.js';
import { getCallTools, getDefaultTools } from '../lib/booking-tools.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;

// Retell uses its own model identifiers (e.g. claude-4.6-sonnet) which differ
// from Anthropic's API ids (claude-sonnet-4-6). Map ours → Retell's; pass through
// anything already in Retell's namespace (claude-4.x / gpt-* / gemini-*).
const RETELL_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-6': 'claude-4.6-sonnet',
  'claude-sonnet-4-5': 'claude-4.5-sonnet',
  'claude-sonnet-4-0': 'claude-4.0-sonnet',
  'claude-haiku-4-5': 'claude-4.5-haiku',
};
function toRetellModel(model: string | undefined): string {
  if (!model) return 'claude-4.6-sonnet';
  return RETELL_MODEL_MAP[model] || model;
}

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let businessId: string;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const cronSecret = process.env.CRON_SECRET;
  const internalToolSecret = process.env.TOOL_SECRET;
  const headerSecret = req.headers.get('x-tool-secret') || req.headers.get('x_tool_secret');
  const headerCron = req.headers.get('x-cron-secret');
  const isInternal = (cronSecret && headerCron === cronSecret) || (internalToolSecret && headerSecret === internalToolSecret);

  if (isInternal) {
    if (!body.businessId) {
      return new Response(JSON.stringify({ error: 'businessId required for internal calls' }), { status: 400 });
    }
    businessId = body.businessId as string;
  } else {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
    businessId = auth.businessId;
  }

  try {
    let agentId = body.agentId as string | undefined;

    if (!agentId) {
      const { data: defaultAgent } = await supabase
        .from('agents')
        .select('id')
        .eq('business_id', businessId)
        .limit(1)
        .maybeSingle();
      if (defaultAgent) agentId = defaultAgent.id;
    }

    let llmId: string | undefined;
    let retellAgentId: string | undefined;

    if (agentId) {
      const { data: agent } = await supabase
        .from('agents')
        .select('retell_llm_id, retell_agent_id')
        .eq('id', agentId)
        .eq('business_id', businessId)
        .single();
      llmId = agent?.retell_llm_id ?? undefined;
      retellAgentId = agent?.retell_agent_id ?? undefined;
    }

    if (!llmId || !retellAgentId) {
      const { data: channel } = await supabase
        .from('channels')
        .select('config')
        .eq('business_id', businessId)
        .eq('type', 'voice')
        .limit(1)
        .maybeSingle();

      if (channel?.config) {
        const cfg = channel.config as Record<string, string>;
        if (!llmId) llmId = cfg.retell_llm_id;
        if (!retellAgentId) retellAgentId = cfg.retell_agent_id;
      } else if (body.preview !== true) {
        // Preview only builds the prompt text, so a missing voice channel is fine.
        return new Response(JSON.stringify({ error: 'No voice channel configured' }), { status: 404 });
      }
    }

    if (!llmId && body.preview !== true && body.pullRetell !== true) {
      return new Response(JSON.stringify({ error: 'No Retell LLM ID found' }), { status: 404 });
    }

    // Pull the LIVE prompt currently on Retell (e.g. edited by hand in the Retell
    // dashboard) so it can be viewed/adopted in the app.
    if (body.pullRetell === true) {
      if (!llmId) {
        return new Response(JSON.stringify({ error: 'This agent is not connected to Retell yet.' }), { status: 404 });
      }
      const r = await fetch(`https://api.retellai.com/get-retell-llm/${llmId}`, {
        headers: { Authorization: `Bearer ${RETELL_API_KEY}` },
      });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: 'Could not read the live prompt from Retell.' }), { status: 502 });
      }
      const llm = await r.json() as { general_prompt?: string };
      return new Response(JSON.stringify({ ok: true, retell_prompt: llm.general_prompt || '' }), { status: 200 });
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('name, industry, address, phone, website, greeting, tone, ai_system_prompt, timezone')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    let agentOverrides: Record<string, unknown> = {};
    if (agentId) {
      const { data: agent } = await supabase
        .from('agents')
        .select('greeting, tone, ai_system_prompt, ai_model, voice_id, voice_speed, language, interruption_sensitivity, max_call_duration_seconds, post_call_analysis_model, working_days, start_speaker, responsiveness, reminder_trigger_seconds, reminder_max_count, ambient_sound, full_prompt_override')
        .eq('id', agentId)
        .single();
      if (agent) agentOverrides = agent;
    }

    const hasOwnPrompt = !!(agentOverrides.ai_system_prompt as string);
    const resourceFilter = hasOwnPrompt ? `agent_id.eq.${agentId}` : (agentId ? `agent_id.is.null,agent_id.eq.${agentId}` : 'agent_id.is.null');
    const ksFilter = agentId ? `agent_id.eq.${agentId}` : 'agent_id.is.null';

    const { data: services } = await supabase
      .from('services')
      .select('name, description, price_from, price_to, bookable')
      .eq('business_id', businessId)
      .or(resourceFilter)
      .order('sort_order');

    const { data: faqs } = await supabase
      .from('faqs')
      .select('question, answer')
      .eq('business_id', businessId)
      .or(resourceFilter)
      .order('sort_order');

    const { data: callInfoRows } = await supabase
      .from('call_info_types')
      .select('name, enabled, fields')
      .eq('business_id', businessId)
      .or(resourceFilter)
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
      .or(ksFilter)
      .eq('status', 'synced');

    const knowledgeContent = (knowledgeSources || [])
      .map((s: { summary: string | null }) => s.summary)
      .filter(Boolean)
      .join('\n\n');

    const hasBookable = (services || []).some((s: Record<string, unknown>) => s.bookable);

    const effectiveTimezone = (business as Record<string, unknown>).timezone as string || 'Europe/London';
    const effectiveWorkDays = (agentOverrides.working_days as string[]) || undefined;

    let prompt = buildSystemPrompt(
      biz,
      (services || []) as Service[],
      (faqs || []) as FAQ[],
      callInfoTypes,
      'VOICE',
      knowledgeContent || undefined,
      effectiveTimezone,
      effectiveWorkDays,
    );

    if (effectivePrompt?.trim()) {
      prompt += `\n\n## Custom instructions from the business owner\n${effectivePrompt.trim()}`;
    }

    const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
    const toolSecret = process.env.TOOL_SECRET || '';
    const webSearchEnabled = !!process.env.TAVILY_API_KEY;
    const tools = toolSecret
      ? getCallTools(appUrl, toolSecret, businessId, agentId, { booking: hasBookable, webSearch: webSearchEnabled })
      : getDefaultTools();

    if (toolSecret) {
      prompt += `\n\n## Things you can do for the caller during the call
You can do these WHILE the call is live. Use them when the caller asks (e.g. "can you email me that?", "text it to me"):
- **send_email** — email the caller. Always confirm and read back their email address before sending.
- **send_sms** — text the caller. Default to their own number ({{from_number}}) unless they give a different one.
- **send_whatsapp** — WhatsApp the caller. Default to their own number ({{from_number}}) unless they give a different one.
${webSearchEnabled ? '- **web_search** — look something up online when you genuinely do not know the answer. Say "let me check that for you" first, keep it brief, and never read out raw web addresses.\n' : ''}When you send something, confirm it to the caller in one short sentence. If a tool reports it could not send, apologise briefly and offer an alternative — never pretend something was sent.`;
    }

    // If the owner hand-wrote a full prompt, that wins verbatim; else use the
    // auto-assembled one. Editable from the "Full prompt" box in the app.
    const overrideRaw = agentOverrides.full_prompt_override as string | null | undefined;
    const isOverride = !!(overrideRaw && overrideRaw.trim());
    const finalPrompt = isOverride ? (overrideRaw as string) : prompt;

    const aiModel = (agentOverrides.ai_model as string) || 'claude-sonnet-4-6';
    const llmPayload: Record<string, unknown> = {
      general_prompt: finalPrompt,
      general_tools: tools,
      begin_message: effectiveGreeting || null,
      start_speaker: (agentOverrides.start_speaker as string) || (effectiveGreeting ? 'agent' : 'user'),
      model: toRetellModel(aiModel),
    };

    // Preview mode: return the exact prompt (override or generated) without
    // pushing to Retell. Powers the editable "Full prompt" box in the app.
    if (body.preview === true) {
      return new Response(JSON.stringify({
        ok: true,
        prompt: finalPrompt,
        is_override: isOverride,
        model: toRetellModel(aiModel),
        tools: tools.map((t) => t.name),
      }), { status: 200 });
    }

    const res = await fetch(`https://api.retellai.com/update-retell-llm/${llmId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(llmPayload),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `Retell update failed: ${err}` }), { status: 500 });
    }

    if (retellAgentId) {
      const reminderSec = agentOverrides.reminder_trigger_seconds as number | null | undefined;
      const agentPayload: Record<string, unknown> = {
        voice_id: (agentOverrides.voice_id as string) || undefined,
        voice_speed: (agentOverrides.voice_speed as number) || undefined,
        language: (agentOverrides.language as string) || 'en-GB',
        interruption_sensitivity: (agentOverrides.interruption_sensitivity as number) ?? 0.9,
        max_call_duration_ms: ((agentOverrides.max_call_duration_seconds as number) ?? 3600) * 1000,
        post_call_analysis_model: (agentOverrides.post_call_analysis_model as string) || 'gpt-4.1-mini',
        responsiveness: (agentOverrides.responsiveness as number | null | undefined) ?? undefined,
        reminder_trigger_ms: reminderSec != null ? reminderSec * 1000 : undefined,
        reminder_max_count: (agentOverrides.reminder_max_count as number | null | undefined) ?? undefined,
        // ambient_sound: null is a valid value ("no background"), so only drop when undefined.
        ambient_sound: (agentOverrides.ambient_sound as string | null | undefined),
      };

      Object.keys(agentPayload).forEach(k => {
        if (agentPayload[k] === undefined) delete agentPayload[k];
      });

      // update-agent edits the latest DRAFT version and returns its number;
      // publish-agent then makes that exact version live (inbound calls use the
      // latest published version since the number isn't pinned to one).
      const agentRes = await fetch(`https://api.retellai.com/update-agent/${retellAgentId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(agentPayload),
      });
      const updatedAgent = agentRes.ok ? await agentRes.json().catch(() => ({})) as { version?: number } : {};

      await fetch(`https://api.retellai.com/publish-agent/${retellAgentId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedAgent.version != null ? { version: updatedAgent.version } : {}),
      });

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
