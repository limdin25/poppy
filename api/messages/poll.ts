import { createClient } from '@supabase/supabase-js';
import { stripHtml, cleanEmailBody, isEmailSpam, normalizeSubject, extractUnsubscribeUrls } from '../lib/email-utils.js';
import { fetchAndStoreAvatar, fetchEmailAvatar } from '../lib/fetch-avatar.js';
import { callLLM, getModelForAgent } from '../lib/llm.js';
import { maybeAlertChannelDisconnected } from '../lib/channel-alerts.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;
const POLL_SECRET = process.env.UNIPILE_POLL_SECRET || '';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function toE164(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? `+${digits}` : '';
}

function counterpartyPhone(msg: any): string {
  if (msg.chat_provider_id?.includes('@s.whatsapp.net')) {
    return toE164(msg.chat_provider_id);
  }
  if (msg.sender_id?.includes('@s.whatsapp.net')) {
    return toE164(msg.sender_id);
  }
  return '';
}

function isGroupMessage(msg: any): boolean {
  return msg.chat_provider_id?.includes('@g.us') || msg.chat_id?.includes('@g.us') || false;
}

function groupSenderPhone(msg: any): string {
  if (msg.sender_id?.includes('@s.whatsapp.net')) {
    return toE164(msg.sender_id);
  }
  return '';
}


function detectContentType(attachments: any[]): 'text' | 'image' | 'audio' | 'video' | 'file' {
  if (!attachments || attachments.length === 0) return 'text';
  const first = attachments[0];
  const t = (first.type || first.mimetype || '').toLowerCase();
  if (t.includes('img') || t.includes('image')) return 'image';
  if (t.includes('audio') || t.includes('ptt') || t.includes('voice')) return 'audio';
  if (t.includes('video')) return 'video';
  return 'file';
}

function previewForType(ct: string): string {
  if (ct === 'image') return '📷 Photo';
  if (ct === 'audio') return '🎤 Voice message';
  if (ct === 'file') return '📎 Attachment';
  return '';
}

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

  const agentRes = agentId ? await supabase.from('agents').select('greeting, tone, ai_system_prompt').eq('id', agentId).single() : { data: null };
  const hasOwnPrompt = !!(agentRes.data as any)?.ai_system_prompt;

  const svcFilter = hasOwnPrompt ? `agent_id.eq.${agentId}` : (agentId ? `agent_id.is.null,agent_id.eq.${agentId}` : 'agent_id.is.null');
  const faqFilter = hasOwnPrompt ? `agent_id.eq.${agentId}` : (agentId ? `agent_id.is.null,agent_id.eq.${agentId}` : 'agent_id.is.null');
  const ksFilter = agentId ? `agent_id.eq.${agentId}` : 'agent_id.is.null';

  const [bizRes, svcRes, faqRes, ksRes] = await Promise.all([
    supabase.from('businesses').select('name, industry, address, phone, website, tone, greeting, ai_system_prompt').eq('id', businessId).single(),
    supabase.from('services').select('name, description, price_from, price_to, bookable').eq('business_id', businessId).or(svcFilter),
    supabase.from('faqs').select('question, answer').eq('business_id', businessId).or(faqFilter),
    supabase.from('knowledge_sources').select('summary, content').eq('business_id', businessId).or(ksFilter).eq('status', 'synced'),
  ]);

  const biz = bizRes.data;
  if (!biz) return '';

  const agentData = agentRes.data as Record<string, unknown> | null;
  const effectiveTone = (agentData?.tone as string) ?? biz.tone;
  const effectiveGreeting = (agentData?.greeting as string) ?? biz.greeting;
  const effectivePrompt = (agentData?.ai_system_prompt as string) ?? biz.ai_system_prompt;

  if (effectivePrompt) {
    let prompt = effectivePrompt;

    const knowledgeSources = ksRes.data || [];
    if (knowledgeSources.length > 0) {
      prompt += '\n\nKnowledge base:\n';
      knowledgeSources.forEach((ks: any) => {
        if (ks.summary) prompt += `${ks.summary}\n`;
        else if (ks.content) prompt += `${(ks.content as string).slice(0, 3000)}\n`;
      });
    }

    const services = svcRes.data || [];
    if (services.length > 0) {
      prompt += '\n\nServices offered:\n';
      services.forEach((s: any) => {
        prompt += `- ${s.name}`;
        if (s.description) prompt += `: ${s.description}`;
        if (s.price_from != null) prompt += ` (from £${s.price_from}${s.price_to ? ` to £${s.price_to}` : ''})`;
        if (s.bookable) prompt += ' [bookable]';
        prompt += '\n';
      });
    }

    const faqs = faqRes.data || [];
    if (faqs.length > 0) {
      prompt += '\nFAQs:\n';
      faqs.forEach((f: any) => { prompt += `Q: ${f.question}\nA: ${f.answer}\n\n`; });
    }

    prompt += '\n\nIMPORTANT RULES:\n- NEVER use markdown formatting. Write plain text only.\n- NEVER use placeholders like [Name] or [Your Name].';
    if (opts?.contactName) {
      prompt += `\n- The contact's name is: ${opts.contactName}. Use their first name naturally.`;
    }
    return prompt;
  }

  let prompt = `You are an AI assistant for ${biz.name || 'this business'}.`;
  if (biz.industry) prompt += ` Industry: ${biz.industry}.`;
  if (biz.address) prompt += ` Location: ${biz.address}.`;
  if (biz.phone) prompt += ` Phone: ${biz.phone}.`;
  if (biz.website) prompt += ` Website: ${biz.website}.`;
  if (effectiveTone) prompt += ` Tone: ${effectiveTone}.`;
  if (effectiveGreeting) prompt += `\n\nGreeting: ${effectiveGreeting}`;

  const knowledgeSources = ksRes.data || [];
  if (knowledgeSources.length > 0) {
    prompt += '\n\nKnowledge base:\n';
    knowledgeSources.forEach((ks: any) => {
      if (ks.summary) prompt += `${ks.summary}\n`;
      else if (ks.content) prompt += `${(ks.content as string).slice(0, 3000)}\n`;
    });
  }

  const services = svcRes.data || [];
  if (services.length > 0) {
    prompt += '\n\nServices offered:\n';
    services.forEach((s: any) => {
      prompt += `- ${s.name}`;
      if (s.description) prompt += `: ${s.description}`;
      if (s.price_from != null) prompt += ` (from £${s.price_from}${s.price_to ? ` to £${s.price_to}` : ''})`;
      if (s.bookable) prompt += ' [bookable]';
      prompt += '\n';
    });
  }

  const faqs = faqRes.data || [];
  if (faqs.length > 0) {
    prompt += '\nFAQs:\n';
    faqs.forEach((f: any) => { prompt += `Q: ${f.question}\nA: ${f.answer}\n\n`; });
  }

  prompt += '\n\nIMPORTANT RULES:\n- NEVER use markdown formatting. Write plain text only.\n- NEVER use placeholders like [Name] or [Your Name].';

  if (opts?.contactName) {
    prompt += `\n- The customer's name is: ${opts.contactName}. Use their first name naturally.`;
  } else {
    prompt += '\n- You do not know the customer\'s name. Do not guess or use placeholders.';
  }

  if (opts?.channel === 'email') {
    prompt += '\n- This is an email reply. Be professional but concise.';
  } else {
    prompt += '\n- This is a WhatsApp message. Keep replies short, casual, and conversational.';
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
    headers: {
      'X-API-KEY': UNIPILE_TOKEN,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      text,
      attendees_ids: [recipientPhone.replace('+', '') + '@s.whatsapp.net'],
    }),
  });
}

async function sendUnipileEmail(accountId: string, to: string, subject: string, body: string, replyToEmailId?: string) {
  const payload: any = { account_id: accountId, to: [{ identifier: to }], subject, body };
  if (replyToEmailId) payload.in_reply_to = replyToEmailId;
  await fetch(`https://${UNIPILE_DSN}/api/v1/emails`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_TOKEN, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function downloadAttachment(messageId: string, attachment: any): Promise<string | null> {
  try {
    const res = await fetch(`https://${UNIPILE_DSN}/api/v1/messages/${messageId}/attachments/${attachment.id}`, {
      headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: '*/*' },
    });
    if (!res.ok) return null;
    const blob = await res.arrayBuffer();
    if (blob.byteLength < 100) return null;

    const mime = attachment.mimetype || res.headers.get('content-type') || 'application/octet-stream';
    const extMap: Record<string, string> = {
      'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/jpeg': 'jpg',
      'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
      'audio/opus': 'opus', 'audio/webm': 'webm', 'audio/amr': 'amr',
      'video/mp4': 'mp4', 'application/pdf': 'pdf',
    };
    const cleanMime = mime.split(';')[0].trim();
    const ext = extMap[cleanMime] || Object.entries(extMap).find(([k]) => mime.includes(k.split('/')[1]))?.[1] || 'bin';
    const fileName = `attachments/${Date.now()}_${attachment.id}.${ext}`;

    const { error } = await supabase.storage
      .from('media')
      .upload(fileName, blob, { contentType: cleanMime, upsert: false });
    if (error) return null;

    const { data } = supabase.storage.from('media').getPublicUrl(fileName);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}

async function pollEmailAccount(acct: any, cutoffMs: number): Promise<any> {
  const accountId = acct.id;

  const sourceStatus = acct.sources?.[0]?.status;

  if (sourceStatus !== 'OK') {
    const { data: ch } = await supabase
      .from('channels')
      .select('id, config')
      .eq('unipile_account_id', accountId)
      .single();
    if (ch) {
      await supabase.from('channels').update({
        status: 'disconnected',
        disconnected_at: new Date().toISOString(),
        config: { ...(ch.config as any), disconnect_reason: sourceStatus || 'unknown' },
      }).eq('id', ch.id);
    }
    return { account_id: accountId, type: 'email', error: `status: ${sourceStatus}` };
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id, business_id, agent_id, auto_reply_enabled, draft_mode, auto_unsubscribe, config')
    .eq('unipile_account_id', accountId)
    .single();

  if (!channel) {
    return { account_id: accountId, type: 'email', error: 'no channel row' };
  }

  const businessId = channel.business_id;
  const autoUnsubscribe = (channel as any).auto_unsubscribe === true;
  const ownEmail = ((channel.config as any)?.email || '').toLowerCase();

  await supabase
    .from('channels')
    .update({ status: 'connected', config: { ...(channel.config as any), polled_at: new Date().toISOString(), disconnect_reason: null } })
    .eq('id', channel.id);

  const emailsRes = await fetch(
    `https://${UNIPILE_DSN}/api/v1/emails?account_id=${accountId}&limit=20`,
    { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } },
  );
  if (!emailsRes.ok) {
    return { account_id: accountId, type: 'email', error: `emails ${emailsRes.status}` };
  }
  const emailsJson = await emailsRes.json() as { items?: any[] };
  const emails = emailsJson.items ?? [];

  let inserted = 0;
  let skipped = 0;

  for (const email of emails) {
    const emailId = email.id || '';
    if (!emailId) { skipped++; continue; }

    const emailDate = email.date || email.timestamp || '';
    if (emailDate) {
      const msgMs = Date.parse(emailDate);
      if (Number.isFinite(msgMs) && msgMs < cutoffMs) { skipped++; continue; }
    }

    const fromAttendee = email.from_attendee || email.from || {};
    const fromEmail = (fromAttendee.identifier || fromAttendee.email || '').toLowerCase();
    const fromName = fromAttendee.display_name || fromAttendee.name || fromEmail;
    const subject = email.subject || '';
    const htmlBody = email.body || '';
    const plainBody = email.body_plain || (htmlBody.includes('<') ? stripHtml(htmlBody) : htmlBody);
    const emailText = cleanEmailBody(plainBody);
    const toAttendees = email.to_attendees || [];

    if (!fromEmail) { skipped++; continue; }

    const isOutbound = (ownEmail && fromEmail === ownEmail) || email.role === 'sent';

    if (isOutbound && email.origin === 'unipile') { skipped++; continue; }

    const counterpartyEmail = isOutbound
      ? (toAttendees[0]?.identifier || '').toLowerCase()
      : fromEmail;
    const counterpartyName = isOutbound
      ? (toAttendees[0]?.display_name || counterpartyEmail)
      : (fromName || fromEmail);

    if (!counterpartyEmail) { skipped++; continue; }

    // Find or create contact by email
    let contactId: string | null = null;
    let resolvedContactName = '';
    const { data: existing } = await supabase
      .from('contacts')
      .select('id, name, avatar_url')
      .eq('business_id', businessId)
      .eq('email', counterpartyEmail)
      .maybeSingle();

    if (existing) {
      contactId = existing.id;
      resolvedContactName = existing.name || '';
      if (counterpartyName && counterpartyName !== counterpartyEmail && !existing.name) {
        await supabase.from('contacts').update({ name: counterpartyName }).eq('id', contactId);
        resolvedContactName = counterpartyName;
      }
      if (!existing.avatar_url) {
        fetchEmailAvatar(existing.id, counterpartyEmail).catch(() => {});
      }
    } else if (!isOutbound) {
      const { data: newContact } = await supabase
        .from('contacts')
        .insert({ business_id: businessId, email: counterpartyEmail, name: counterpartyName })
        .select('id')
        .single();
      contactId = newContact?.id || null;
      resolvedContactName = counterpartyName;
      if (contactId) {
        fetchEmailAvatar(contactId, counterpartyEmail).catch(() => {});
      }
    }

    if (!contactId) { skipped++; continue; }

    // Thread the email into ONE conversation. Prefer the provider's thread id
    // (groups a reply with its original even when it comes from a different
    // address, e.g. Elsie replying from hello@). Fall back to the contact's
    // existing open email thread — same person stays in the same inbox thread.
    const normalSub = normalizeSubject(subject);
    const threadId = (email.thread_id || email.thread || '').toString() || null;
    let conversationId: string | null = null;
    let convoAiHandling = true;

    if (threadId) {
      const { data: byThread } = await supabase
        .from('conversations')
        .select('id, ai_handling')
        .eq('business_id', businessId)
        .eq('channel', 'email')
        .eq('email_thread_id', threadId)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byThread) {
        conversationId = byThread.id;
        convoAiHandling = byThread.ai_handling !== false;
      }
    }

    if (!conversationId) {
      const { data: byContact } = await supabase
        .from('conversations')
        .select('id, ai_handling')
        .eq('business_id', businessId)
        .eq('contact_id', contactId)
        .eq('channel', 'email')
        .eq('status', 'open')
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byContact) {
        conversationId = byContact.id;
        convoAiHandling = byContact.ai_handling !== false;
        // Backfill the thread id so future replies on this thread match fast.
        if (threadId) await supabase.from('conversations').update({ email_thread_id: threadId }).eq('id', byContact.id);
      }
    }

    if (!conversationId) {
      const { data: newConvo } = await supabase
        .from('conversations')
        .insert({ business_id: businessId, contact_id: contactId, agent_id: (channel as any).agent_id || null, channel: 'email', status: 'open', ai_handling: true, subject: normalSub || null, email_thread_id: threadId, received_address: ownEmail || null })
        .select('id')
        .single();
      conversationId = newConvo?.id || null;
    }

    if (!conversationId) { skipped++; continue; }

    // Deduplicate by external_id (limit(1), not maybeSingle which errors on >1 dup)
    const { data: dupRows } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .contains('metadata', { external_id: emailId })
      .limit(1);

    if (dupRows?.[0]) { skipped++; continue; }

    // Spam check — pass HTML body to detect marketing emails with unsubscribe links
    const spam = !isOutbound && isEmailSpam(fromEmail, subject, emailText, htmlBody);

    const direction: 'inbound' | 'outbound' = isOutbound ? 'outbound' : 'inbound';
    const preview = emailText.slice(0, 100);

    const { data: insertedEmailPollMsg } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction,
      sender: isOutbound ? 'human' : 'contact',
      content_type: 'text',
      body: emailText.slice(0, 10000) || null,
      metadata: {
        sender_email: fromEmail,
        sender_name: fromName,
        subject,
        external_id: emailId,
        to_attendees: toAttendees,
        is_spam: spam,
        via: 'unipile_email_poll',
      },
      created_at: emailDate || new Date().toISOString(),
    }).select('id').single();

    await supabase
      .from('conversations')
      .update({
        last_message_at: emailDate || new Date().toISOString(),
        last_message_preview: preview,
        ...(ownEmail ? { received_address: ownEmail } : {}),
      })
      .eq('id', conversationId);

    if (spam) {
      await supabase.from('conversations').update({ is_spam: true } as any).eq('id', conversationId);

      if (autoUnsubscribe && htmlBody) {
        const unsubUrls = extractUnsubscribeUrls(htmlBody);
        if (unsubUrls.length > 0) {
          const results: Array<{ url: string; status: number | string }> = [];
          for (const url of unsubUrls.slice(0, 3)) {
            try {
              const r = await fetch(url, { method: 'GET', redirect: 'follow' });
              results.push({ url, status: r.status });
            } catch (e: any) {
              results.push({ url, status: e.message || 'error' });
            }
          }
          await supabase.from('messages')
            .update({ metadata: { sender_email: fromEmail, sender_name: fromName, subject, external_id: emailId, to_attendees: toAttendees, is_spam: true, via: 'unipile_email_poll', auto_unsubscribed: true, unsubscribe_results: results } })
            .eq('conversation_id', conversationId)
            .contains('metadata', { external_id: emailId });
          console.log(`[poll/auto-unsub] ${fromEmail}: hit ${results.length} unsubscribe URL(s)`);
        }
      }

      inserted++;
      continue;
    }

    inserted++;

    // Queue AI takeover for inbound non-spam emails
    if (
      direction === 'inbound' &&
      emailText &&
      (channel as any).auto_reply_enabled &&
      convoAiHandling &&
      insertedEmailPollMsg?.id
    ) {
      const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
      fetch(`${appUrl}/api/messages/queue-takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          conversation_id: conversationId,
          message_id: insertedEmailPollMsg.id,
          channel: 'email',
          received_at: new Date().toISOString(),
        }),
      }).catch(() => {});
    }
  }

  return { account_id: accountId, type: 'email', pulled: emails.length, inserted, skipped };
}

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  const pollHeader = req.headers.get('x-poll-secret') || '';

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // Vercel cron
  } else if (POLL_SECRET && pollHeader === POLL_SECRET) {
    // Manual trigger
  } else if (cronSecret || POLL_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  if (!UNIPILE_TOKEN) {
    return new Response(JSON.stringify({ error: 'UNIPILE_TOKEN not configured' }), { status: 503 });
  }

  try {
    const cutoffMs = Date.now() - MAX_AGE_MS;

    const accountsRes = await fetch(`https://${UNIPILE_DSN}/api/v1/accounts`, {
      headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' },
    });
    if (!accountsRes.ok) {
      return new Response(JSON.stringify({ error: `accounts fetch failed: ${accountsRes.status}` }), { status: 502 });
    }
    const accountsJson = await accountsRes.json() as { items?: any[] };
    const accounts = accountsJson.items ?? [];

    const summary: any[] = [];

    for (const acct of accounts) {
      if (acct.type !== 'WHATSAPP' && !acct.type?.includes('GOOGLE') && acct.type !== 'INSTAGRAM' && !acct.type?.includes('MICROSOFT') && !acct.type?.includes('OUTLOOK')) continue;

      // Route to email handler for non-IM accounts
      if (acct.type !== 'WHATSAPP' && acct.type !== 'INSTAGRAM') {
        const emailResult = await pollEmailAccount(acct, cutoffMs);
        summary.push(emailResult);
        continue;
      }
      const accountId = acct.id;

      const waSourceStatus = acct.sources?.[0]?.status;
      if (waSourceStatus !== 'OK') {
        const { data: ch } = await supabase
          .from('channels')
          .select('id, config, business_id, type')
          .eq('unipile_account_id', accountId)
          .single();
        if (ch) {
          const alertPatch = await maybeAlertChannelDisconnected({
            channelId: ch.id,
            businessId: ch.business_id,
            unipileAccountId: accountId,
            config: ch.config as any,
            reason: waSourceStatus || 'unknown',
            channelType: ch.type,
          });
          await supabase.from('channels').update({
            status: 'disconnected',
            disconnected_at: new Date().toISOString(),
            config: { ...(ch.config as any), disconnect_reason: waSourceStatus || 'unknown', ...alertPatch },
          }).eq('id', ch.id);
        }
        summary.push({ account_id: accountId, error: `status: ${waSourceStatus}` });
        continue;
      }

      const phone = acct.connection_params?.im?.phone_number
        ? toE164(acct.connection_params.im.phone_number)
        : '';

      const { data: channel } = await supabase
        .from('channels')
        .select('id, business_id, agent_id, auto_reply_enabled, draft_mode, type')
        .eq('unipile_account_id', accountId)
        .single();

      if (!channel) {
        summary.push({ account_id: accountId, error: 'no channel row' });
        continue;
      }

      const businessId = channel.business_id;
      const imChannelType = (channel as any).type === 'instagram' ? 'instagram' : 'whatsapp';

      await supabase
        .from('channels')
        .update({ status: 'connected', config: { phone, polled_at: new Date().toISOString(), disconnect_reason: null } })
        .eq('id', channel.id);

      const msgRes = await fetch(
        `https://${UNIPILE_DSN}/api/v1/messages?account_id=${accountId}&limit=100`,
        { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } },
      );
      if (!msgRes.ok) {
        summary.push({ account_id: accountId, error: `messages ${msgRes.status}` });
        continue;
      }
      const msgJson = await msgRes.json() as { items?: any[] };
      const msgs = msgJson.items ?? [];

      let inserted = 0;
      let skipped = 0;
      let reactionsStored = 0;

      for (const m of msgs) {
        if (!m.id) { skipped++; continue; }

        const msgMs = m.timestamp ? Date.parse(m.timestamp) : Date.now();
        if (Number.isFinite(msgMs) && msgMs < cutoffMs) { skipped++; continue; }

        // Skip event messages (reactions, system notifications)
        if (m.is_event === 1 || m.is_event === true) { skipped++; continue; }

        // Skip hidden messages
        if (m.hidden === 1 || m.hidden === true) { skipped++; continue; }

        // Skip reaction notification texts (e.g. "{{447863992555@s.whatsapp.net}} reacted 👍")
        // These come through with is_event=0 sometimes
        if (m.text && /reacted\s+./u.test(m.text) && /\{?\{?\d+@(s\.whatsapp\.net|lid)\}?\}?/.test(m.text)) {
          skipped++; continue;
        }

        const isGroup = isGroupMessage(m);
        const counterparty = isGroup ? groupSenderPhone(m) : counterpartyPhone(m);
        if (!isGroup && !counterparty) { skipped++; continue; }

        const isOutbound = m.is_sender === true || m.is_sender === 1;
        const direction: 'inbound' | 'outbound' = isOutbound ? 'outbound' : 'inbound';

        // Find or create contact (for groups: resolve the sender as a contact)
        let contactId: string | null = null;
        let contactName: string | null = null;
        const msgChatId = m.chat_id || '';
        const contactAttendeeId = direction === 'inbound' ? (m.sender_attendee_id || '') : '';

        if (counterparty) {
          const { data: existing } = await supabase
            .from('contacts')
            .select('id, name, avatar_url')
            .eq('business_id', businessId)
            .eq('phone', counterparty)
            .maybeSingle();

          if (existing) {
            contactId = existing.id;
            contactName = existing.name;
            if (!existing.avatar_url && (contactAttendeeId || msgChatId)) {
              fetchAndStoreAvatar(existing.id, { attendeeId: contactAttendeeId || undefined, chatId: msgChatId || undefined }).catch(() => {});
            }
          } else {
            // Create the contact for BOTH inbound and outbound. Previously only
            // inbound created a contact, so a chat you START from WhatsApp (an
            // outbound message to a new number) was silently skipped and never
            // appeared in the inbox.
            const { data: newContact } = await supabase
              .from('contacts')
              .insert({ business_id: businessId, phone: counterparty, whatsapp: counterparty, name: counterparty })
              .select('id')
              .single();
            contactId = newContact?.id || null;
            if (contactId && (contactAttendeeId || msgChatId)) {
              fetchAndStoreAvatar(contactId, { attendeeId: contactAttendeeId || undefined, chatId: msgChatId || undefined }).catch(() => {});
            }
          }
        }

        if (!isGroup && !contactId) { skipped++; continue; }

        // Find or create conversation
        let conversationId: string | null = null;
        let convoAiHandling = true;

        if (isGroup) {
          // m.chat_id is the Unipile internal ID, m.chat_provider_id is the WhatsApp @g.us ID
          const unipileInternalId = m.chat_id || '';
          const providerId = m.chat_provider_id || '';

          // Look up existing group conversation by Unipile internal ID (primary) or provider_id (legacy)
          let convo: Record<string, any> | null = null;
          if (unipileInternalId) {
            const { data: found } = await supabase
              .from('conversations')
              .select('id, ai_handling, group_name, unipile_chat_id')
              .eq('business_id', businessId)
              .eq('unipile_chat_id', unipileInternalId)
              .order('created_at', { ascending: true })
              .limit(1);
            convo = found?.[0] || null;
          }
          if (!convo && providerId) {
            const { data: found } = await supabase
              .from('conversations')
              .select('id, ai_handling, group_name, unipile_chat_id')
              .eq('business_id', businessId)
              .eq('unipile_chat_id', providerId)
              .order('created_at', { ascending: true })
              .limit(1);
            convo = found?.[0] || null;
          }

          if (convo) {
            conversationId = convo.id;
            convoAiHandling = convo.ai_handling !== false;
            // Migrate to Unipile internal ID if still using provider_id, and refresh name
            if (unipileInternalId && convo.unipile_chat_id !== unipileInternalId) {
              await supabase.from('conversations').update({ unipile_chat_id: unipileInternalId }).eq('id', convo.id);
            }
          } else {
            // Fetch group name from Unipile
            let groupName = 'Group Chat';
            if (unipileInternalId) {
              try {
                const chatRes = await fetch(`https://${UNIPILE_DSN}/api/v1/chats/${unipileInternalId}`, {
                  headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' },
                });
                if (chatRes.ok) {
                  const chatData = await chatRes.json() as Record<string, any>;
                  groupName = chatData.name || chatData.title || 'Group Chat';
                }
              } catch {}
            }
            const { data: newConvo } = await supabase
              .from('conversations')
              .insert({
                business_id: businessId,
                contact_id: null,
                agent_id: (channel as any).agent_id || null,
                channel: imChannelType,
                status: 'open',
                ai_handling: false,
                is_group: true,
                group_name: groupName,
                unipile_chat_id: unipileInternalId || providerId,
              })
              .select('id')
              .single();
            conversationId = newConvo?.id || null;
            convoAiHandling = false;
          }
        } else {
          const { data: convo } = await supabase
            .from('conversations')
            .select('id, ai_handling, status')
            .eq('business_id', businessId)
            .eq('contact_id', contactId)
            .eq('channel', imChannelType)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (convo) {
            conversationId = convo.id;
            convoAiHandling = convo.ai_handling !== false;
            // A new inbound on an archived/closed thread should bring it back to the inbox
            if (convo.status === 'archived' || convo.status === 'closed') {
              await supabase.from('conversations').update({ status: 'open' }).eq('id', convo.id);
            }
          } else {
            const { data: newConvo } = await supabase
              .from('conversations')
              .insert({ business_id: businessId, contact_id: contactId, agent_id: (channel as any).agent_id || null, channel: imChannelType, status: 'open', ai_handling: true })
              .select('id')
              .single();
            conversationId = newConvo?.id || null;
          }
        }

        if (!conversationId) { skipped++; continue; }

        // Check for duplicate (limit(1) — maybeSingle() ERRORS once >1 dup exists, which
        // silently disabled dedup and caused runaway re-inserts)
        const { data: dupRows } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .contains('metadata', { external_id: m.id })
          .limit(1);
        const dup = dupRows?.[0];

        if (dup) {
          // Even if message exists, update reactions if present
          if (m.reactions?.length > 0) {
            const reactions = m.reactions.map((r: any) => ({ emoji: r.value, sender_id: r.sender_id || '' }));
            const { data: existingMsg } = await supabase
              .from('messages')
              .select('metadata')
              .eq('id', dup.id)
              .single();
            const meta = (existingMsg?.metadata as Record<string, any>) || {};
            await supabase
              .from('messages')
              .update({ metadata: { ...meta, reactions } })
              .eq('id', dup.id);
            reactionsStored++;
          }
          skipped++;
          continue;
        }

        // Handle attachments
        const attachments: any[] = m.attachments || [];
        const contentType = detectContentType(attachments);
        let mediaUrl: string | null = null;

        if (attachments.length > 0 && m.id) {
          mediaUrl = await downloadAttachment(m.id, attachments[0]);
        }

        const text = m.text ?? '';
        const preview = text.slice(0, 100) || previewForType(contentType);

        // Build metadata with reactions if present
        const metadata: Record<string, any> = {
          external_id: m.id,
          via: 'unipile_poll',
          from_phone: direction === 'inbound' ? counterparty : phone,
          to_phone: direction === 'inbound' ? phone : counterparty,
        };

        if (m.reactions?.length > 0) {
          metadata.reactions = m.reactions.map((r: any) => ({ emoji: r.value, sender_id: r.sender_id || '' }));
        }

        const senderDisplayName = isGroup ? (contactName && !contactName.startsWith('+') ? contactName : (counterparty || null)) : null;

        const { data: insertedPollMsg, error: insErr } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction,
            sender: direction === 'inbound' ? 'contact' : 'human',
            content_type: contentType,
            body: text || null,
            media_url: mediaUrl,
            sender_name: senderDisplayName,
            sender_contact_id: isGroup ? contactId : null,
            metadata,
            // Use the real WhatsApp send time so threads always sort chronologically
            created_at: m.timestamp ?? new Date().toISOString(),
          }).select('id').single();

        if (insErr) { skipped++; continue; }

        inserted++;

        const groupPrefix = isGroup && direction === 'inbound' && senderDisplayName ? `${senderDisplayName}: ` : '';
        await supabase
          .from('conversations')
          .update({
            last_message_at: m.timestamp ?? new Date().toISOString(),
            last_message_preview: `${groupPrefix}${preview}`.slice(0, 100),
          })
          .eq('id', conversationId);

        // Queue AI takeover instead of replying inline
        if (
          direction === 'inbound' &&
          text &&
          !isGroup &&
          (channel as any).auto_reply_enabled &&
          convoAiHandling &&
          insertedPollMsg?.id
        ) {
          const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
          fetch(`${appUrl}/api/messages/queue-takeover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              business_id: businessId,
              conversation_id: conversationId,
              message_id: insertedPollMsg.id,
              channel: imChannelType,
              received_at: m.timestamp || new Date().toISOString(),
            }),
          }).catch(() => {});
        }
      }

      summary.push({ account_id: accountId, pulled: msgs.length, inserted, skipped, reactionsStored });
    }

    return new Response(JSON.stringify({ ok: true, polled_at: new Date().toISOString(), accounts: summary }), { status: 200 });
  } catch (err: any) {
    console.error('[messages/poll] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
