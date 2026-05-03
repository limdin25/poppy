import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;
const UNIPILE_WEBHOOK_SECRET = process.env.UNIPILE_WEBHOOK_SECRET || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#?\w+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripQuotedReply(text: string): string {
  // First: cut inline "On ... wrote:" (e.g. "oiiii On Sat, 2 May 2026 at 20:12, Hugo wrote:")
  const inlineMatch = text.match(/\s+On\s.{5,120}\swrote:\s*/i);
  if (inlineMatch && inlineMatch.index !== undefined) {
    text = text.substring(0, inlineMatch.index);
  }

  const lines = text.split('\n');
  const cutPatterns = [
    /^On .{5,80} wrote:\s*$/i,
    /^-{3,}\s*Original Message\s*-{3,}/i,
    /^From:\s*.+/i,
    /^_{3,}/,
    /^>{3,}/,
    /^\*{3,}/,
  ];

  let cutIndex = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (cutPatterns.some((p) => p.test(line))) {
      cutIndex = i;
      break;
    }
    if (line.startsWith('>') && i > 0 && lines[i - 1].trim() === '') {
      cutIndex = i;
      break;
    }
  }

  return lines
    .slice(0, cutIndex)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanEmailBody(text: string): string {
  let cleaned = stripQuotedReply(text);
  // Remove long tracking URLs (keep short URLs)
  cleaned = cleaned.replace(/\(\s*https?:\/\/\S{80,}\s*\)/g, '');
  cleaned = cleaned.replace(/https?:\/\/\S{120,}/g, '[link]');
  // Remove rows of asterisks/dashes used as separators
  cleaned = cleaned.replace(/^\*{5,}\s*$/gm, '');
  cleaned = cleaned.replace(/^-{5,}\s*$/gm, '');
  // Collapse excessive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function isSpamEmail(fromEmail: string, subject: string, body: string): boolean {
  const lowerFrom = fromEmail.toLowerCase();
  const lowerBody = body.toLowerCase().slice(0, 3000);

  const spamPrefixes = ['noreply@', 'no-reply@', 'newsletter@', 'marketing@', 'promo@', 'notifications@', 'digest@', 'updates@', 'mailer@', 'bulk@', 'campaign@'];
  const spamDomains = ['cyberimpact.com', 'skool.com', 'etsy.com', 'mailchimp.com', 'sendgrid.net', 'constantcontact.com', 'hubspot.com', 'klaviyo.com', 'mailerlite.com', 'convertkit.com', 'signalheadline.com', 'theharmonydiaries.com', 'substack.com', 'beehiiv.com'];

  if (spamPrefixes.some(p => lowerFrom.startsWith(p))) return true;
  if (spamDomains.some(d => lowerFrom.includes(d))) return true;

  if (lowerBody.includes('unsubscribe') || lowerBody.includes('opt out') || lowerBody.includes('opt-out') || lowerBody.includes('manage your preferences') || lowerBody.includes('email preferences') || lowerBody.includes('view in browser') || lowerBody.includes('view this email in')) return true;

  const spamSubjectPatterns = [/\$\d+.*waiting/i, /finalize receipt/i, /claim your/i, /act now/i, /limited time/i, /congratulations/i, /you('ve| have) been selected/i, /winner/i, /free gift/i, /lbs per day/i, /weight loss/i, /new notifications? since/i, /\d+ new notifications/i];
  if (spamSubjectPatterns.some(p => p.test(subject))) return true;

  const spamBodySignals = [/eliminate.*pain/i, /restore energy/i, /lose \d+ lbs/i, /miracle cure/i, /limited offer/i, /click here to claim/i, /wire transfer/i, /dear (sir|madam|friend|winner)/i, /you have been chosen/i];
  if (spamBodySignals.filter(p => p.test(body)).length >= 2) return true;

  return false;
}

function isRawId(name: string): boolean {
  if (!name) return true;
  if (name.includes('@lid') || name.includes('@')) return true;
  const digits = name.replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length === name.replace(/[+ ()-]/g, '').length;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '- ');
}

function toE164(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.replace(/^whatsapp:/, '').trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return trimmed;
  return trimmed.startsWith('+') ? trimmed : `+${digits}`;
}

async function fetchUnipileAccount(accountId: string) {
  const res = await fetch(`https://${UNIPILE_DSN}/api/v1/accounts/${accountId}`, {
    headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' },
  });
  if (!res.ok) return null;
  const j: any = await res.json();
  const phone =
    j?.connection_params?.im?.phone ??
    j?.params?.phone_number ??
    j?.phone_number ??
    null;
  const email =
    j?.connection_params?.imap?.email ??
    j?.connection_params?.email ??
    j?.email ??
    j?.identifier ??
    null;
  return {
    phone,
    email,
    type: j?.type ?? j?.provider,
    status: j?.sources?.[0]?.status ?? j?.status,
    name: j?.name ?? j?.display_name,
  };
}

async function generateAIReply(systemPrompt: string, history: Array<{role: 'user' | 'assistant', content: string}>): Promise<string> {
  let messages = history.length > 0 ? history : [{ role: 'user' as const, content: '(new conversation)' }];
  // Anthropic requires first message to be role 'user'
  if (messages[0]?.role === 'assistant') {
    messages = [{ role: 'user' as const, content: '(prior context)' }, ...messages];
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    console.error('[ai-reply] Anthropic error:', res.status, await res.text().catch(() => ''));
    return '';
  }
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const raw = data.content?.[0]?.text || '';
  return stripMarkdown(raw);
}

async function buildBusinessContext(businessId: string, opts?: { contactName?: string; channel?: string }): Promise<string> {
  const [bizRes, svcRes, faqRes] = await Promise.all([
    supabase.from('businesses').select('name, industry, address, phone, website, tone, greeting, ai_system_prompt').eq('id', businessId).single(),
    supabase.from('services').select('name, description, price_from, price_to, bookable').eq('business_id', businessId),
    supabase.from('faqs').select('question, answer').eq('business_id', businessId),
  ]);

  const biz = bizRes.data;
  if (!biz) return '';

  let prompt = `You are an AI assistant for ${biz.name || 'this business'}.`;
  if (biz.industry) prompt += ` Industry: ${biz.industry}.`;
  if (biz.address) prompt += ` Location: ${biz.address}.`;
  if (biz.phone) prompt += ` Phone: ${biz.phone}.`;
  if (biz.website) prompt += ` Website: ${biz.website}.`;
  if (biz.tone) prompt += ` Tone: ${biz.tone}.`;
  if (biz.greeting) prompt += `\n\nGreeting: ${biz.greeting}`;

  const services = svcRes.data || [];
  if (services.length > 0) {
    prompt += '\n\nServices offered:\n';
    services.forEach(s => {
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
    faqs.forEach(f => { prompt += `Q: ${f.question}\nA: ${f.answer}\n\n`; });
  }

  if (biz.ai_system_prompt) {
    prompt += `\nCustom instructions:\n${biz.ai_system_prompt}`;
  }

  prompt += '\n\nIMPORTANT RULES:\n- NEVER use markdown formatting (no **, no *, no #, no bullet points with -). Write plain text only.\n- NEVER use placeholders like [Name] or [Your Name]. Use the actual contact name provided or skip the greeting name entirely.';

  if (opts?.contactName) {
    prompt += `\n- The customer's name is: ${opts.contactName}. Use their first name naturally.`;
  } else {
    prompt += '\n- You do not know the customer\'s name. Do not guess or use placeholders — just skip the name in greetings.';
  }

  if (opts?.channel === 'whatsapp') {
    prompt += '\n- This is a WhatsApp message. Keep replies short, casual, and conversational. No formal greetings like "Dear X" — just reply naturally as you would in a chat.';
  } else if (opts?.channel === 'email') {
    prompt += '\n- This is an email reply. Be professional but concise. Use the customer\'s first name in the greeting (e.g. "Hi Hugo,").';
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

  return rows.reverse().map(m => ({
    role: m.sender === 'contact' ? 'user' as const : 'assistant' as const,
    content: (m.body || '').slice(0, 2000),
  }));
}

async function downloadAndStoreAttachment(messageId: string, attachment: { id: string; type?: string; mimetype?: string }): Promise<string | null> {
  try {
    const res = await fetch(`https://${UNIPILE_DSN}/api/v1/messages/${messageId}/attachments/${attachment.id}`, {
      headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: '*/*' },
    });
    if (!res.ok) {
      console.error('[attachment] download failed:', res.status);
      return null;
    }
    const blob = await res.arrayBuffer();
    const mime = attachment.mimetype || res.headers.get('content-type') || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : mime.includes('webp') ? 'webp' : 'jpg';
    const fileName = `attachments/${Date.now()}_${attachment.id}.${ext}`;

    const { error } = await supabase.storage
      .from('media')
      .upload(fileName, blob, { contentType: mime, upsert: false });

    if (error) {
      console.error('[attachment] upload failed:', error.message);
      return null;
    }

    const { data: urlData } = supabase.storage.from('media').getPublicUrl(fileName);
    return urlData?.publicUrl || null;
  } catch (err: any) {
    console.error('[attachment] error:', err.message);
    return null;
  }
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
      attendees_ids: [recipientPhone],
      text,
    }),
  });
}

async function sendUnipileEmail(accountId: string, to: string, subject: string, body: string, replyToEmailId?: string) {
  const htmlBody = body.replace(/\n/g, '<br>');
  const payload: Record<string, any> = {
    account_id: accountId,
    to: [{ identifier: to }],
    subject,
    body: htmlBody,
  };
  if (replyToEmailId) {
    payload.reply_to = replyToEmailId;
  }
  await fetch(`https://${UNIPILE_DSN}/api/v1/emails`, {
    method: 'POST',
    headers: {
      'X-API-KEY': UNIPILE_TOKEN,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const payload = await req.json() as Record<string, any>;

    console.log('[unipile-webhook] payload:', JSON.stringify(payload).slice(0, 2000));

    // Detect payload type: account_connected vs messaging event
    const looksLikeHostedNotify =
      typeof payload.status === 'string' ||
      (payload.account_id && payload.name && !payload.event);

    // Verify webhook secret on messaging events (not on hosted-auth callbacks)
    if (!looksLikeHostedNotify && UNIPILE_WEBHOOK_SECRET) {
      const got = req.headers.get('unipile-auth') || req.headers.get('Unipile-Auth') || '';
      if (got !== UNIPILE_WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ ok: true, note: 'bad auth' }), { status: 200 });
      }
    }

    // ── Branch 1: Account connected (hosted-auth callback) ──
    if (
      payload.status === 'CREATION_SUCCESS' ||
      payload.status === 'OK' ||
      (payload.account_id && payload.name && !payload.event)
    ) {
      const accountId = payload.account_id;
      if (!accountId) {
        return new Response(JSON.stringify({ ok: true, note: 'no account_id' }), { status: 200 });
      }

      const acct = await fetchUnipileAccount(accountId);
      const phone = toE164(acct?.phone ?? '');

      // Map Unipile account type to our channel type
      const unipileType = (acct?.type || '').toUpperCase();
      let channelType = 'whatsapp';
      if (unipileType.startsWith('GOOGLE') || unipileType.includes('GMAIL')) channelType = 'email_gmail';
      else if (unipileType.includes('OUTLOOK') || unipileType.includes('MICROSOFT')) channelType = 'email_outlook';
      else if (unipileType.includes('IMAP') || unipileType.includes('SMTP') || unipileType.includes('MAIL')) channelType = 'email_smtp';

      // Try to find channel by unipile_account_id first
      let { data: existingChannel } = await supabase
        .from('channels')
        .select('id, business_id')
        .eq('unipile_account_id', accountId)
        .single();

      // If not found, find a disconnected channel of the matching type
      if (!existingChannel) {
        const { data: pendingChannel } = await supabase
          .from('channels')
          .select('id, business_id')
          .eq('type', channelType)
          .eq('status', 'disconnected')
          .is('unipile_account_id', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        existingChannel = pendingChannel;
      }

      if (existingChannel) {
        await supabase
          .from('channels')
          .update({
            status: 'connected',
            unipile_account_id: accountId,
            connected_at: new Date().toISOString(),
            config: { phone, email: acct?.email, unipile_type: acct?.type },
          })
          .eq('id', existingChannel.id);
      }

      return new Response(JSON.stringify({ ok: true, note: 'account_connected', accountId }), { status: 200 });
    }

    // ── Branch 2: Inbound message ──
    if (payload.event === 'message_received' && payload.account_id) {
      const accountId = payload.account_id;

      // Unipile webhook sends flat payload — handle both flat and nested formats
      const messageId = payload.message_id || payload.message?.id || '';
      const messageText =
        (typeof payload.message === 'string' ? payload.message : payload.message?.text) || '';
      const messageSubject = payload.subject || payload.message?.subject || '';

      // Attachments from WhatsApp messages (images, files, audio)
      const rawAttachments: Array<{ id: string; type?: string; mimetype?: string }> =
        payload.attachments || payload.message?.attachments || [];
      const hasAttachments = rawAttachments.length > 0;

      // sender can be { display_name, identifier } (flat) or { provider_id, name } (nested)
      const senderObj = payload.sender || {};
      const senderProviderId =
        senderObj.identifier || senderObj.provider_id || '';
      const senderName =
        senderObj.display_name || senderObj.name || '';

      // Allow messages with attachments even if no text (e.g. photo-only)
      if (!messageText && !hasAttachments) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no text or attachments' }), { status: 200 });
      }

      // Find channel by unipile_account_id
      const { data: channel } = await supabase
        .from('channels')
        .select('id, business_id, auto_reply_enabled, type, draft_mode')
        .eq('unipile_account_id', accountId)
        .eq('status', 'connected')
        .single();

      if (!channel) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no channel' }), { status: 200 });
      }

      const businessId = channel.business_id;
      const isEmail = channel.type === 'email_gmail' || channel.type === 'email_outlook' || channel.type === 'email_smtp';
      const conversationChannel = isEmail ? 'email' : 'whatsapp';

      // Detect outbound WhatsApp messages (sent from Hugo's phone)
      // Unipile sets is_sender=true or the sender matches the channel's own phone/email
      const isSentByMe = payload.is_sender === true ||
        (payload.message?.is_sender === true) ||
        (payload.role === 'sent');
      const ownPhone = ((channel as any).config as any)?.phone || '';
      const ownEmail = ((channel as any).config as any)?.email || '';
      const isOutboundWA = !isEmail && (isSentByMe || (ownPhone && toE164(senderProviderId) === toE164(ownPhone)));

      // For outbound WhatsApp, the "sender" in the payload is ourselves — the recipient is in receiver/attendees
      const recipientObj = payload.receiver || payload.to || {};
      const recipientId = recipientObj.identifier || recipientObj.provider_id || '';

      // Strip HTML from email bodies + clean quoted replies
      const rawClean = isEmail && messageText.includes('<') ? stripHtml(messageText) : messageText;
      const cleanText = isEmail ? cleanEmailBody(rawClean) : rawClean;

      // Determine the counterparty (for outbound = recipient, for inbound = sender)
      const senderEmail = isEmail ? senderProviderId : '';
      const senderPhone = isEmail ? '' : toE164(isOutboundWA && recipientId ? recipientId : senderProviderId);
      // WhatsApp LIDs (e.g. "184322967507111@lid") are not real names
      const cleanSenderName = (senderName && !senderName.includes('@lid')) ? senderName : '';
      const senderDisplay = cleanSenderName || senderEmail || senderPhone;

      if (!senderEmail && !senderPhone) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no sender' }), { status: 200 });
      }

      // Find or create contact
      let contactId: string | null = null;
      let resolvedName = cleanSenderName;
      if (isEmail) {
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, name')
          .eq('business_id', businessId)
          .eq('email', senderEmail)
          .maybeSingle();

        if (existing) {
          contactId = existing.id;
          if (!resolvedName && existing.name && !isRawId(existing.name)) resolvedName = existing.name;
        } else {
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              business_id: businessId,
              email: senderEmail,
              name: cleanSenderName || senderEmail,
            })
            .select('id')
            .single();
          contactId = newContact?.id || null;
        }
      } else {
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, name')
          .eq('business_id', businessId)
          .eq('phone', senderPhone)
          .maybeSingle();

        if (existing) {
          contactId = existing.id;
          if (!resolvedName && existing.name && !isRawId(existing.name)) resolvedName = existing.name;
        } else {
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              business_id: businessId,
              phone: senderPhone,
              whatsapp: senderPhone,
              name: cleanSenderName || null,
            })
            .select('id')
            .single();
          contactId = newContact?.id || null;
        }
      }

      if (!contactId) {
        return new Response(JSON.stringify({ ok: true, skipped: 'contact failed' }), { status: 200 });
      }

      // Find or create conversation
      let conversationId: string | null = null;
      let convoAiHandling = true;
      const { data: existingConvo } = await supabase
        .from('conversations')
        .select('id, ai_handling')
        .eq('business_id', businessId)
        .eq('contact_id', contactId)
        .eq('channel', conversationChannel)
        .eq('status', 'open')
        .maybeSingle();

      if (existingConvo) {
        conversationId = existingConvo.id;
        convoAiHandling = existingConvo.ai_handling !== false;
      } else {
        const { data: newConvo } = await supabase
          .from('conversations')
          .insert({
            business_id: businessId,
            contact_id: contactId,
            channel: conversationChannel,
            status: 'open',
            ai_handling: true,
          })
          .select('id')
          .single();
        conversationId = newConvo?.id || null;
      }

      if (!conversationId) {
        return new Response(JSON.stringify({ ok: true, skipped: 'conversation failed' }), { status: 200 });
      }

      // Download and store attachments (images, files)
      let mediaUrl: string | null = null;
      let contentType: 'text' | 'image' | 'file' = 'text';
      if (hasAttachments && messageId) {
        const firstAtt = rawAttachments[0];
        const attType = (firstAtt.type || firstAtt.mimetype || '').toLowerCase();
        const isImage = attType.includes('img') || attType.includes('image');
        contentType = isImage ? 'image' : 'file';
        mediaUrl = await downloadAndStoreAttachment(messageId, firstAtt);
      }

      // Store message
      const preview = cleanText.slice(0, 100) || (contentType === 'image' ? '📷 Photo' : '📎 Attachment');

      await supabase.from('messages').insert({
        conversation_id: conversationId,
        direction: isOutboundWA ? 'outbound' : 'inbound',
        sender: isOutboundWA ? 'human' : 'contact',
        content_type: contentType,
        body: cleanText || null,
        media_url: mediaUrl,
        metadata: {
          sender_name: isOutboundWA ? 'You' : senderDisplay,
          ...(isEmail
            ? { sender_email: senderEmail, subject: messageSubject }
            : { sender_phone: senderPhone }),
          external_id: messageId,
        },
      });

      // Update conversation preview
      await supabase
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: preview,
          unread_count: isOutboundWA ? (existingConvo ? 0 : 0) : 1,
        })
        .eq('id', conversationId);

      // AI auto-reply if enabled — skip for outbound (sent from phone), spam, or image-only
      const spam = isEmail && isSpamEmail(senderEmail, messageSubject, cleanText);
      const draftMode = (channel as any).draft_mode !== false;

      if (channel.auto_reply_enabled && convoAiHandling && !spam && !isOutboundWA && cleanText) {
        const [systemPrompt, history] = await Promise.all([
          buildBusinessContext(businessId, { contactName: resolvedName || undefined, channel: conversationChannel }),
          getConversationHistory(conversationId!),
        ]);

        if (systemPrompt) {
          const fullPrompt = isEmail
            ? `${systemPrompt}\n\nYou are replying to an email. Write a professional, well-formatted email reply. Do not include a subject line — just the body text. Keep it concise and helpful.`
            : systemPrompt;

          const reply = await generateAIReply(fullPrompt, history);

          if (reply) {
            if (!draftMode) {
              if (isEmail) {
                await sendUnipileEmail(accountId, senderEmail, messageSubject ? `Re: ${messageSubject.replace(/^Re:\s*/i, '')}` : `Re: Your message`, reply);
              } else {
                await sendUnipileMessage(accountId, senderPhone, reply);
              }
            }

            await supabase.from('messages').insert({
              conversation_id: conversationId,
              direction: 'outbound',
              sender: 'ai',
              content_type: 'text',
              body: reply,
              status: draftMode ? 'draft' : 'sent',
              metadata: { via: isEmail ? 'unipile_email_auto_reply' : 'unipile_auto_reply' },
            });

            if (!draftMode) {
              await supabase
                .from('conversations')
                .update({
                  last_message_at: new Date().toISOString(),
                  last_message_preview: reply.slice(0, 100),
                })
                .eq('id', conversationId);
            }
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, note: 'message_received', channel: conversationChannel }), { status: 200 });
    }

    // ── Branch 3: Email webhook (source: email) ──
    // Events: mail_received, mail_sent, mail_moved
    // Payload: from_attendee, to_attendees, cc_attendees, bcc_attendees,
    //          subject, body, body_plain, has_attachments, attachments,
    //          email_id, message_id, in_reply_to, date, folders, role, origin
    if (payload.from_attendee && payload.account_id) {
      const event = payload.event || 'mail_received';
      const accountId = payload.account_id;
      const emailId = payload.email_id || '';
      const messageRfcId = payload.message_id || '';
      const htmlBody = payload.body || '';
      const rawBody = payload.body_plain || htmlBody;
      const rawCleanEmail = rawBody.includes('<') ? stripHtml(rawBody) : rawBody;
      const emailText = cleanEmailBody(rawCleanEmail);
      const emailSubject = payload.subject || '';
      const fromEmail = payload.from_attendee?.identifier || '';
      const fromName = payload.from_attendee?.display_name || '';
      const toAttendees = payload.to_attendees || [];
      const ccAttendees = payload.cc_attendees || [];
      const bccAttendees = payload.bcc_attendees || [];
      const replyToAttendees = payload.reply_to_attendees || [];
      const hasAttachments = payload.has_attachments || false;
      const attachments = payload.attachments || [];
      const inReplyTo = payload.in_reply_to || null;
      const emailDate = payload.date || new Date().toISOString();
      const origin = payload.origin || 'external';

      // Skip mail_moved events — we only care about received and sent
      if (event === 'mail_moved') {
        return new Response(JSON.stringify({ ok: true, skipped: 'mail_moved' }), { status: 200 });
      }

      if (!fromEmail) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no sender' }), { status: 200 });
      }

      // Find channel
      const { data: channel } = await supabase
        .from('channels')
        .select('id, business_id, auto_reply_enabled, type, config, draft_mode')
        .eq('unipile_account_id', accountId)
        .eq('status', 'connected')
        .single();

      if (!channel) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no channel for email' }), { status: 200 });
      }

      const businessId = channel.business_id;
      const ownEmail = ((channel.config as any)?.email || '').toLowerCase();

      // Determine direction: mail_sent or own email in from = outbound
      const isOutbound = event === 'mail_sent' || (ownEmail && fromEmail.toLowerCase() === ownEmail);

      // For outbound, the counterparty is the TO recipient; for inbound, it's the FROM sender
      const counterpartyEmail = isOutbound
        ? (toAttendees[0]?.identifier || '')
        : fromEmail;
      const counterpartyName = isOutbound
        ? (toAttendees[0]?.display_name || toAttendees[0]?.identifier || '')
        : (fromName || fromEmail);

      if (!counterpartyEmail) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no counterparty' }), { status: 200 });
      }

      // Skip outbound emails sent via Unipile (we already stored them when sending)
      if (isOutbound && origin === 'unipile') {
        return new Response(JSON.stringify({ ok: true, skipped: 'own outbound via unipile' }), { status: 200 });
      }

      // Find or create contact by email
      let contactId: string | null = null;
      let resolvedContactName = '';
      const { data: existing } = await supabase
        .from('contacts')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('email', counterpartyEmail)
        .maybeSingle();

      if (existing) {
        contactId = existing.id;
        resolvedContactName = existing.name || '';
        if (counterpartyName && counterpartyName !== counterpartyEmail) {
          await supabase.from('contacts').update({ name: counterpartyName }).eq('id', contactId);
          resolvedContactName = counterpartyName;
        }
      } else {
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            business_id: businessId,
            email: counterpartyEmail,
            name: counterpartyName,
          })
          .select('id')
          .single();
        contactId = newContact?.id || null;
        if (counterpartyName && counterpartyName !== counterpartyEmail) {
          resolvedContactName = counterpartyName;
        }
      }

      if (!contactId) {
        return new Response(JSON.stringify({ ok: true, skipped: 'contact failed' }), { status: 200 });
      }

      // For email: each unique subject thread = separate conversation
      // Normalise subject for matching (strip Re:/Fwd: prefixes)
      const normalSubject = emailSubject
        .replace(/^(Re|Fwd|Fw):\s*/gi, '')
        .trim()
        .toLowerCase() || null;

      let conversationId: string | null = null;
      let existingConvo: { id: string; unread_count: number; ai_handling: boolean } | null = null;

      if (normalSubject) {
        const { data: threadConvo } = await supabase
          .from('conversations')
          .select('id, unread_count, ai_handling')
          .eq('business_id', businessId)
          .eq('contact_id', contactId)
          .eq('channel', 'email')
          .eq('status', 'open')
          .ilike('subject', normalSubject)
          .maybeSingle();
        existingConvo = threadConvo;
      }

      if (!existingConvo && !normalSubject) {
        const { data: fallbackConvo } = await supabase
          .from('conversations')
          .select('id, unread_count, ai_handling')
          .eq('business_id', businessId)
          .eq('contact_id', contactId)
          .eq('channel', 'email')
          .eq('status', 'open')
          .is('subject', null)
          .maybeSingle();
        existingConvo = fallbackConvo;
      }

      if (existingConvo) {
        conversationId = existingConvo.id;
      } else {
        const { data: newConvo } = await supabase
          .from('conversations')
          .insert({
            business_id: businessId,
            contact_id: contactId,
            channel: 'email',
            status: 'open',
            ai_handling: true,
            subject: normalSubject,
          })
          .select('id, unread_count')
          .single();
        conversationId = newConvo?.id || null;
        existingConvo = newConvo as any;
      }

      if (!conversationId) {
        return new Response(JSON.stringify({ ok: true, skipped: 'conversation failed' }), { status: 200 });
      }

      // Deduplicate by email_id
      if (emailId) {
        const { data: dup } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .contains('metadata', { external_id: emailId })
          .maybeSingle();
        if (dup) {
          return new Response(JSON.stringify({ ok: true, skipped: 'duplicate' }), { status: 200 });
        }
      }

      const emailIsSpam = !isOutbound && isSpamEmail(counterpartyEmail, emailSubject, emailText);

      const preview = emailText.slice(0, 100);

      await supabase.from('messages').insert({
        conversation_id: conversationId,
        direction: isOutbound ? 'outbound' : 'inbound',
        sender: isOutbound ? 'human' : 'contact',
        content_type: 'text',
        body: emailText.slice(0, 10000),
        metadata: {
          sender_name: fromName,
          sender_email: fromEmail,
          subject: emailSubject,
          external_id: emailId,
          message_id: messageRfcId,
          thread_id: inReplyTo || null,
          in_reply_to: inReplyTo,
          to_attendees: toAttendees,
          cc_attendees: ccAttendees,
          bcc_attendees: bccAttendees,
          reply_to_attendees: replyToAttendees,
          has_attachments: hasAttachments,
          attachments: attachments,
          date: emailDate,
          origin,
          is_spam: emailIsSpam,
          body_html: htmlBody.includes('<') ? htmlBody.slice(0, 50000) : null,
        },
      });

      // Update conversation preview and unread count
      const currentUnread = (existingConvo as any)?.unread_count || 0;
      await supabase
        .from('conversations')
        .update({
          last_message_at: emailDate,
          last_message_preview: preview,
          unread_count: isOutbound ? currentUnread : currentUnread + 1,
        })
        .eq('id', conversationId);

      if (emailIsSpam) {
        await supabase
          .from('conversations')
          .update({ is_spam: true } as any)
          .eq('id', conversationId)
          .then(() => {}, () => {});
      }
      const convoAiOn = existingConvo?.ai_handling !== false;
      const emailDraftMode = (channel as any).draft_mode !== false;

      if (!isOutbound && channel.auto_reply_enabled && convoAiOn && !emailIsSpam) {
        const [systemPrompt, history] = await Promise.all([
          buildBusinessContext(businessId, { contactName: resolvedContactName || undefined, channel: 'email' }),
          getConversationHistory(conversationId!),
        ]);

        if (systemPrompt) {
          const fullPrompt = `${systemPrompt}\n\nYou are replying to an email. Write a professional, well-formatted email reply. Do not include a subject line — just the body text. Keep it concise and helpful.`;
          const reply = await generateAIReply(fullPrompt, history);

          if (reply) {
            const replySubject = emailSubject
              ? `Re: ${emailSubject.replace(/^Re:\s*/i, '')}`
              : 'Re: Your message';

            if (!emailDraftMode) {
              await sendUnipileEmail(accountId, counterpartyEmail, replySubject, reply, emailId);
            }

            await supabase.from('messages').insert({
              conversation_id: conversationId,
              direction: 'outbound',
              sender: 'ai',
              content_type: 'text',
              body: reply,
              status: emailDraftMode ? 'draft' : 'sent',
              metadata: {
                via: 'unipile_email_auto_reply',
                subject: replySubject,
                reply_to_email_id: emailId,
                to_attendees: [{ identifier: counterpartyEmail, display_name: counterpartyName }],
              },
            });

            if (!emailDraftMode) {
              await supabase
                .from('conversations')
                .update({
                  last_message_at: new Date().toISOString(),
                  last_message_preview: reply.slice(0, 100),
                })
                .eq('id', conversationId);
            }
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, note: event, direction: isOutbound ? 'outbound' : 'inbound' }), { status: 200 });
    }

    // Unknown event — acknowledge
    return new Response(JSON.stringify({ ok: true, skipped: 'unhandled event' }), { status: 200 });
  } catch (err: any) {
    console.error('[unipile-webhook] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
