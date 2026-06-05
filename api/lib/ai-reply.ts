import { createClient } from '@supabase/supabase-js';
import { callLLM, getModelForAgent } from './llm.js';
import { buildSystemPrompt } from '../../src/prompts/system-builder.js';
import type { Business, Service, FAQ, CallInfoType } from '../../src/prompts/system-builder.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '- ');
}

export async function buildBusinessContext(businessId: string, opts?: { contactName?: string; channel?: string; agentId?: string | null }): Promise<string> {
  const agentId = opts?.agentId;
  const channelType = opts?.channel === 'email' ? 'EMAIL' as const : 'WHATSAPP' as const;

  const agentRes = agentId
    ? await supabase.from('agents').select('greeting, tone, ai_system_prompt, working_days').eq('id', agentId).single()
    : { data: null };
  const agentData = agentRes.data as Record<string, unknown> | null;
  const hasOwnPrompt = !!(agentData?.ai_system_prompt as string);

  const resourceFilter = hasOwnPrompt
    ? `agent_id.eq.${agentId}`
    : (agentId ? `agent_id.is.null,agent_id.eq.${agentId}` : 'agent_id.is.null');
  const ksFilter = agentId ? `agent_id.eq.${agentId}` : 'agent_id.is.null';

  const [bizRes, svcRes, faqRes, callInfoRes, ksRes] = await Promise.all([
    supabase.from('businesses').select('name, industry, address, phone, website, tone, greeting, ai_system_prompt, timezone').eq('id', businessId).single(),
    supabase.from('services').select('name, description, price_from, price_to, bookable').eq('business_id', businessId).or(resourceFilter).order('sort_order'),
    supabase.from('faqs').select('question, answer').eq('business_id', businessId).or(resourceFilter).order('sort_order'),
    supabase.from('call_info_types').select('name, enabled, fields').eq('business_id', businessId).or(resourceFilter).order('sort_order'),
    supabase.from('knowledge_sources').select('summary').eq('business_id', businessId).or(ksFilter).eq('status', 'synced'),
  ]);

  const biz = bizRes.data;
  if (!biz) return '';

  const effectiveGreeting = (agentData?.greeting as string) ?? biz.greeting;
  const effectiveTone = (agentData?.tone as string) ?? biz.tone;
  const effectivePrompt = (agentData?.ai_system_prompt as string) ?? biz.ai_system_prompt;
  const effectiveTimezone = (biz as Record<string, unknown>).timezone as string || 'Europe/London';
  const effectiveWorkDays = (agentData?.working_days as string[]) || undefined;

  const business: Business = {
    name: biz.name,
    industry: biz.industry ?? undefined,
    address: biz.address ?? undefined,
    phone: biz.phone ?? undefined,
    website: biz.website ?? undefined,
    greeting: effectiveGreeting ?? undefined,
    tone: effectiveTone ?? undefined,
  };

  const callInfoTypes: CallInfoType[] = (callInfoRes.data || []).map((r: Record<string, unknown>) => ({
    name: r.name as string,
    enabled: r.enabled as boolean,
    fields: (r.fields as Array<{ name: string; type: string; required?: boolean }>) || [
      { name: (r.name as string).toLowerCase().replace(/\s+/g, '_'), type: 'text', required: false },
    ],
  }));

  const knowledgeContent = (ksRes.data || [])
    .map((s: { summary: string | null }) => s.summary)
    .filter(Boolean)
    .join('\n\n');

  const assistantMode = /\[ASSISTANT_MODE\]/i.test(effectivePrompt || '');
  const cleanPrompt = (effectivePrompt || '').replace(/\[ASSISTANT_MODE\]\s*/gi, '').trim();

  let prompt = buildSystemPrompt(
    business,
    (svcRes.data || []) as Service[],
    (faqRes.data || []) as FAQ[],
    callInfoTypes,
    channelType,
    knowledgeContent || undefined,
    effectiveTimezone,
    effectiveWorkDays,
    assistantMode,
  );

  if (cleanPrompt) {
    prompt += `\n\n## ${assistantMode ? 'Extra instructions' : 'Custom instructions from the business owner'}\n${cleanPrompt}`;
  }

  prompt += '\n\n## Formatting rules\n- NEVER use markdown formatting (no **, no ##, no bullet asterisks). Write plain text only.\n- NEVER use placeholders like [Name] or [Your Name].';

  if (opts?.contactName) {
    prompt += `\n- The contact's name is: ${opts.contactName}. Use their first name naturally.`;
  } else {
    prompt += '\n- You do not know the customer\'s name. Do not guess or use placeholders.';
  }

  return prompt;
}

export async function getConversationHistory(conversationId: string): Promise<Array<{role: 'user' | 'assistant', content: string}>> {
  const { data: rows } = await supabase
    .from('messages')
    .select('body, sender')
    .eq('conversation_id', conversationId)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!rows || rows.length === 0) return [];

  return rows.reverse().map((m: any) => ({
    role: m.sender === 'contact' ? 'user' as const : 'assistant' as const,
    content: (m.body || '').slice(0, 2000),
  }));
}

export async function generateAIReply(systemPrompt: string, history: Array<{role: 'user' | 'assistant', content: string}>, businessId?: string, agentId?: string): Promise<string> {
  const model = await getModelForAgent(businessId || '', agentId);
  const raw = await callLLM(model, systemPrompt, history);
  return stripMarkdown(raw);
}
