import { createClient } from '@supabase/supabase-js';
import { callLLM, getModelForAgent } from '../lib/llm.js';
import { buildSystemPrompt } from '../../src/prompts/system-builder.js';
import type { Business, Service, FAQ, CallInfoType } from '../../src/prompts/system-builder.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '- ');
}

async function buildBusinessContext(businessId: string, opts?: { contactName?: string; channel?: string; agentId?: string | null }): Promise<string> {
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

  let prompt = buildSystemPrompt(
    business,
    (svcRes.data || []) as Service[],
    (faqRes.data || []) as FAQ[],
    callInfoTypes,
    channelType,
    knowledgeContent || undefined,
    effectiveTimezone,
    effectiveWorkDays,
  );

  if (effectivePrompt?.trim()) {
    prompt += `\n\n## Custom instructions from the business owner\n${effectivePrompt.trim()}`;
  }

  prompt += '\n\n## Formatting rules\n- NEVER use markdown formatting (no **, no ##, no bullet asterisks). Write plain text only.\n- NEVER use placeholders like [Name] or [Your Name].';

  if (opts?.contactName) {
    prompt += `\n- The contact's name is: ${opts.contactName}. Use their first name naturally.`;
  } else {
    prompt += '\n- You do not know the customer\'s name. Do not guess or use placeholders.';
  }

  return prompt;
}

async function getConversationHistory(conversationId: string): Promise<Array<{role: 'user' | 'assistant', content: string}>> {
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

async function generateAIReply(systemPrompt: string, history: Array<{role: 'user' | 'assistant', content: string}>, businessId?: string, agentId?: string): Promise<string> {
  const model = await getModelForAgent(businessId || '', agentId);
  const raw = await callLLM(model, systemPrompt, history);
  return stripMarkdown(raw);
}

async function sendUnipileMessage(accountId: string, recipientPhone: string, text: string) {
  await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_TOKEN, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ account_id: accountId, text, attendees_ids: [recipientPhone] }),
  });
}

async function sendUnipileEmail(accountId: string, to: string, subject: string, body: string, replyToEmailId?: string) {
  const htmlBody = body.replace(/\n/g, '<br>');
  const payload: Record<string, any> = { account_id: accountId, to: [{ identifier: to }], subject, body: htmlBody };
  if (replyToEmailId) payload.reply_to = replyToEmailId;
  await fetch(`https://${UNIPILE_DSN}/api/v1/emails`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_TOKEN, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
}

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  try {
    const now = new Date();

    const { data: pending } = await supabase
      .from('ai_takeover_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('takeover_at', now.toISOString())
      .order('takeover_at', { ascending: true })
      .limit(50);

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), { status: 200 });
    }

    let processed = 0;
    let ownerReplied = 0;
    let aiReplied = 0;

    for (const entry of pending) {
      const { data: ownerReply } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', entry.conversation_id)
        .eq('direction', 'outbound')
        .in('sender', ['human'])
        .gt('created_at', entry.message_received_at)
        .limit(1)
        .maybeSingle();

      if (ownerReply) {
        await supabase.from('ai_takeover_queue').update({
          status: 'owner_replied',
          owner_reply_message_id: ownerReply.id,
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        ownerReplied++;
        processed++;
        continue;
      }

      if (!entry.grace_checked_at) {
        await supabase.from('ai_takeover_queue').update({
          grace_checked_at: now.toISOString(),
          takeover_at: new Date(now.getTime() + 60 * 1000).toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      const { data: lateOwnerReply } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', entry.conversation_id)
        .eq('direction', 'outbound')
        .in('sender', ['human'])
        .gt('created_at', entry.grace_checked_at)
        .limit(1)
        .maybeSingle();

      if (lateOwnerReply) {
        await supabase.from('ai_takeover_queue').update({
          status: 'owner_replied',
          owner_reply_message_id: lateOwnerReply.id,
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        ownerReplied++;
        processed++;
        continue;
      }

      const { data: conversation } = await supabase
        .from('conversations')
        .select('id, business_id, contact_id, channel, ai_handling, agent_id')
        .eq('id', entry.conversation_id)
        .single();

      if (!conversation || conversation.ai_handling === false) {
        await supabase.from('ai_takeover_queue').update({
          status: 'cancelled',
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      const { data: channel } = await supabase
        .from('channels')
        .select('id, type, unipile_account_id, auto_reply_enabled, draft_mode, config')
        .eq('business_id', conversation.business_id)
        .eq('status', 'connected');

      const matchedChannel = (channel || []).find((ch: any) => {
        if (entry.channel === 'whatsapp') return ch.type === 'whatsapp' && ch.unipile_account_id;
        if (entry.channel === 'email') return (ch.type || '').includes('email') && ch.unipile_account_id;
        return false;
      });

      if (!matchedChannel?.unipile_account_id || !matchedChannel.auto_reply_enabled) {
        await supabase.from('ai_takeover_queue').update({
          status: 'cancelled',
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      let contactName: string | undefined;
      if (conversation.contact_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('name')
          .eq('id', conversation.contact_id)
          .single();
        if (contact?.name && !contact.name.startsWith('+') && !contact.name.includes('@')) {
          contactName = contact.name;
        }
      }

      const isEmail = entry.channel === 'email';
      const convAgentId = (conversation as any).agent_id as string | null;
      const [systemPrompt, history] = await Promise.all([
        buildBusinessContext(conversation.business_id, { contactName, channel: isEmail ? 'email' : 'whatsapp', agentId: convAgentId }),
        getConversationHistory(conversation.id),
      ]);

      if (!systemPrompt) {
        await supabase.from('ai_takeover_queue').update({
          status: 'cancelled',
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      const fullPrompt = systemPrompt;

      const reply = await generateAIReply(fullPrompt, history, conversation.business_id, convAgentId || undefined);
      if (!reply) {
        await supabase.from('ai_takeover_queue').update({
          status: 'cancelled',
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      const draftMode = (matchedChannel as any).draft_mode !== false;

      if (!draftMode) {
        if (isEmail) {
          const triggerMeta = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', entry.trigger_message_id)
            .single();
          const meta = (triggerMeta.data?.metadata as Record<string, any>) || {};
          const subject = meta.subject || '';
          const externalId = meta.external_id || '';
          const senderEmail = meta.sender_email || '';
          const replySubject = subject ? `Re: ${subject.replace(/^Re:\s*/i, '')}` : 'Re: Your message';
          await sendUnipileEmail(matchedChannel.unipile_account_id, senderEmail, replySubject, reply, externalId);
        } else {
          const { data: contact } = await supabase
            .from('contacts')
            .select('phone, whatsapp')
            .eq('id', conversation.contact_id!)
            .single();
          const recipientPhone = contact?.whatsapp || contact?.phone || '';
          if (recipientPhone) {
            await sendUnipileMessage(matchedChannel.unipile_account_id, recipientPhone, reply);
          }
        }
      }

      const { data: aiMsg } = await supabase.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender: 'ai',
        content_type: 'text',
        body: reply,
        status: draftMode ? 'draft' : 'sent',
        metadata: { via: `takeover_${entry.channel}` },
      }).select('id').single();

      if (!draftMode) {
        await supabase.from('conversations').update({
          last_message_at: new Date().toISOString(),
          last_message_preview: reply.slice(0, 100),
        }).eq('id', conversation.id);
      }

      await supabase.from('ai_takeover_queue').update({
        status: 'ai_replied',
        ai_reply_message_id: aiMsg?.id || null,
        processed_at: now.toISOString(),
      }).eq('id', entry.id);

      aiReplied++;
      processed++;
    }

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    await supabase.from('ai_takeover_queue')
      .update({ status: 'expired', processed_at: now.toISOString() })
      .eq('status', 'pending')
      .lt('created_at', twoHoursAgo);

    return new Response(JSON.stringify({ ok: true, processed, ownerReplied, aiReplied }), { status: 200 });
  } catch (err: any) {
    console.error('[process-takeovers] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
