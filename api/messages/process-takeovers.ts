import { createClient } from '@supabase/supabase-js';
import { buildBusinessContext, getConversationHistory, generateAIReply } from '../lib/ai-reply.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

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
