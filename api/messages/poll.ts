import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;
const POLL_SECRET = process.env.UNIPILE_POLL_SECRET || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

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

async function buildBusinessContext(businessId: string, opts?: { contactName?: string }): Promise<string> {
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

  if (biz.ai_system_prompt) {
    prompt += `\nCustom instructions:\n${biz.ai_system_prompt}`;
  }

  prompt += '\n\nIMPORTANT RULES:\n- NEVER use markdown formatting (no **, no *, no #, no bullet points with -). Write plain text only.\n- NEVER use placeholders like [Name] or [Your Name]. Use the actual contact name provided or skip the greeting name entirely.';

  if (opts?.contactName) {
    prompt += `\n- The customer's name is: ${opts.contactName}. Use their first name naturally.`;
  } else {
    prompt += '\n- You do not know the customer\'s name. Do not guess or use placeholders — just skip the name in greetings.';
  }

  prompt += '\n- This is a WhatsApp message. Keep replies short, casual, and conversational. No formal greetings like "Dear X" — just reply naturally as you would in a chat.';

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

async function generateAIReply(systemPrompt: string, history: Array<{role: 'user' | 'assistant', content: string}>): Promise<string> {
  if (!ANTHROPIC_API_KEY) return '';
  let messages = history.length > 0 ? history : [{ role: 'user' as const, content: '(new conversation)' }];
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
    console.error('[poll/ai-reply] Anthropic error:', res.status);
    return '';
  }
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const raw = data.content?.[0]?.text || '';
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
      if (acct.type !== 'WHATSAPP') continue;
      const accountId = acct.id;

      if (acct.sources?.[0]?.status !== 'OK') {
        summary.push({ account_id: accountId, error: 'not OK' });
        continue;
      }

      const phone = acct.connection_params?.im?.phone_number
        ? toE164(acct.connection_params.im.phone_number)
        : '';

      const { data: channel } = await supabase
        .from('channels')
        .select('id, business_id, auto_reply_enabled, draft_mode')
        .eq('unipile_account_id', accountId)
        .single();

      if (!channel) {
        summary.push({ account_id: accountId, error: 'no channel row' });
        continue;
      }

      const businessId = channel.business_id;

      await supabase
        .from('channels')
        .update({ status: 'connected', config: { phone, polled_at: new Date().toISOString() } })
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

        const counterparty = counterpartyPhone(m);
        if (!counterparty) { skipped++; continue; }

        const isOutbound = m.is_sender === true || m.is_sender === 1;
        const direction: 'inbound' | 'outbound' = isOutbound ? 'outbound' : 'inbound';

        // Find or create contact
        let contactId: string | null = null;
        let contactName: string | null = null;
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, name')
          .eq('business_id', businessId)
          .eq('phone', counterparty)
          .maybeSingle();

        if (existing) {
          contactId = existing.id;
          contactName = existing.name;
        } else if (direction === 'inbound') {
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({ business_id: businessId, phone: counterparty, whatsapp: counterparty, name: counterparty })
            .select('id')
            .single();
          contactId = newContact?.id || null;
        }

        if (!contactId) { skipped++; continue; }

        // Find or create conversation
        let conversationId: string | null = null;
        let convoAiHandling = true;
        const { data: convo } = await supabase
          .from('conversations')
          .select('id, ai_handling')
          .eq('business_id', businessId)
          .eq('contact_id', contactId)
          .eq('channel', 'whatsapp')
          .in('status', ['open', 'closed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (convo) {
          conversationId = convo.id;
          convoAiHandling = convo.ai_handling !== false;
        } else {
          const { data: newConvo } = await supabase
            .from('conversations')
            .insert({ business_id: businessId, contact_id: contactId, channel: 'whatsapp', status: 'open', ai_handling: true })
            .select('id')
            .single();
          conversationId = newConvo?.id || null;
        }

        if (!conversationId) { skipped++; continue; }

        // Check for duplicate
        const { data: dup } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .contains('metadata', { external_id: m.id })
          .maybeSingle();

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

        const { error: insErr } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction,
            sender: direction === 'inbound' ? 'contact' : 'human',
            content_type: contentType,
            body: text || null,
            media_url: mediaUrl,
            metadata,
          });

        if (insErr) { skipped++; continue; }

        inserted++;

        await supabase
          .from('conversations')
          .update({
            last_message_at: m.timestamp ?? new Date().toISOString(),
            last_message_preview: preview,
          })
          .eq('id', conversationId);

        // AI auto-reply for new inbound text messages
        const draftMode = (channel as any).draft_mode !== false;
        if (
          direction === 'inbound' &&
          text &&
          (channel as any).auto_reply_enabled &&
          convoAiHandling &&
          ANTHROPIC_API_KEY
        ) {
          const resolvedName = contactName && !contactName.startsWith('+') ? contactName : undefined;
          const [systemPrompt, history] = await Promise.all([
            buildBusinessContext(businessId, { contactName: resolvedName }),
            getConversationHistory(conversationId!),
          ]);

          if (systemPrompt) {
            const reply = await generateAIReply(systemPrompt, history);
            if (reply) {
              if (!draftMode) {
                await sendUnipileMessage(accountId, counterparty, reply);
              }

              await supabase.from('messages').insert({
                conversation_id: conversationId,
                direction: 'outbound',
                sender: 'ai',
                content_type: 'text',
                body: reply,
                status: draftMode ? 'draft' : 'sent',
                metadata: { via: 'unipile_auto_reply_poll' },
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
      }

      summary.push({ account_id: accountId, pulled: msgs.length, inserted, skipped, reactionsStored });
    }

    return new Response(JSON.stringify({ ok: true, polled_at: new Date().toISOString(), accounts: summary }), { status: 200 });
  } catch (err: any) {
    console.error('[messages/poll] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
