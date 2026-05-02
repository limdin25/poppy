import { createClient } from '@supabase/supabase-js';

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

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // Verify auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  const pollHeader = req.headers.get('x-poll-secret') || '';

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // Vercel cron — allowed
  } else if (POLL_SECRET && pollHeader === POLL_SECRET) {
    // Manual trigger with poll secret — allowed
  } else if (cronSecret || POLL_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  if (!UNIPILE_TOKEN) {
    return new Response(JSON.stringify({ error: 'UNIPILE_TOKEN not configured' }), { status: 503 });
  }

  try {
    const cutoffMs = Date.now() - MAX_AGE_MS;

    // Get all Unipile accounts
    const accountsRes = await fetch(`https://${UNIPILE_DSN}/api/v1/accounts`, {
      headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' },
    });
    if (!accountsRes.ok) {
      return new Response(
        JSON.stringify({ error: `accounts fetch failed: ${accountsRes.status}` }),
        { status: 502 },
      );
    }
    const accountsJson = await accountsRes.json();
    const accounts = accountsJson.items ?? [];

    const summary: any[] = [];

    for (const acct of accounts) {
      if (acct.type !== 'WHATSAPP') continue;
      const accountId = acct.id;

      if (acct.sources?.[0]?.status !== 'OK') {
        summary.push({ account_id: accountId, error: 'not OK' });
        continue;
      }

      // Self-heal: upsert channel row for this account
      const phone = acct.connection_params?.im?.phone_number
        ? toE164(acct.connection_params.im.phone_number)
        : '';

      // Find the channel for this account
      const { data: channel } = await supabase
        .from('channels')
        .select('id, business_id')
        .eq('unipile_account_id', accountId)
        .single();

      if (!channel) {
        summary.push({ account_id: accountId, error: 'no channel row' });
        continue;
      }

      const businessId = channel.business_id;

      // Update channel status + phone in config
      await supabase
        .from('channels')
        .update({
          status: 'connected',
          config: { phone, polled_at: new Date().toISOString() },
        })
        .eq('id', channel.id);

      // Fetch recent messages from Unipile
      const msgRes = await fetch(
        `https://${UNIPILE_DSN}/api/v1/messages?account_id=${accountId}&limit=100`,
        { headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' } },
      );
      if (!msgRes.ok) {
        summary.push({ account_id: accountId, error: `messages ${msgRes.status}` });
        continue;
      }
      const msgJson = await msgRes.json();
      const msgs = msgJson.items ?? [];

      let inserted = 0;
      let skipped = 0;

      for (const m of msgs) {
        if (!m.id) { skipped++; continue; }

        const msgMs = m.timestamp ? Date.parse(m.timestamp) : Date.now();
        if (Number.isFinite(msgMs) && msgMs < cutoffMs) { skipped++; continue; }

        const counterparty = counterpartyPhone(m);
        if (!counterparty) { skipped++; continue; }

        const direction: 'inbound' | 'outbound' =
          m.is_sender === true || m.is_sender === 1 ? 'outbound' : 'inbound';

        // Find or create contact
        let contactId: string | null = null;
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('business_id', businessId)
          .eq('phone', counterparty)
          .maybeSingle();

        if (existing) {
          contactId = existing.id;
        } else if (direction === 'inbound') {
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              business_id: businessId,
              phone: counterparty,
              whatsapp: counterparty,
              name: counterparty,
            })
            .select('id')
            .single();
          contactId = newContact?.id || null;
        }

        if (!contactId) { skipped++; continue; }

        // Find or create conversation
        let conversationId: string | null = null;
        const { data: convo } = await supabase
          .from('conversations')
          .select('id')
          .eq('business_id', businessId)
          .eq('contact_id', contactId)
          .eq('channel', 'whatsapp')
          .in('status', ['open', 'closed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (convo) {
          conversationId = convo.id;
        } else {
          const { data: newConvo } = await supabase
            .from('conversations')
            .insert({
              business_id: businessId,
              contact_id: contactId,
              channel: 'whatsapp',
              status: 'open',
              ai_handling: true,
            })
            .select('id')
            .single();
          conversationId = newConvo?.id || null;
        }

        if (!conversationId) { skipped++; continue; }

        // Check for duplicate by external_id in metadata
        const { data: dup } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .contains('metadata', { external_id: m.id })
          .maybeSingle();

        if (dup) { skipped++; continue; }

        // Insert message
        const { error: insErr } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            direction,
            sender: direction === 'inbound' ? 'contact' : 'ai',
            content_type: 'text',
            body: m.text ?? '',
            metadata: {
              external_id: m.id,
              via: 'unipile_poll',
              from_phone: direction === 'inbound' ? counterparty : phone,
              to_phone: direction === 'inbound' ? phone : counterparty,
            },
          });

        if (insErr) { skipped++; continue; }

        inserted++;

        // Update conversation preview
        await supabase
          .from('conversations')
          .update({
            last_message_at: m.timestamp ?? new Date().toISOString(),
            last_message_preview: (m.text ?? '').slice(0, 100),
          })
          .eq('id', conversationId);
      }

      summary.push({ account_id: accountId, pulled: msgs.length, inserted, skipped });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        polled_at: new Date().toISOString(),
        accounts: summary,
      }),
      { status: 200 },
    );
  } catch (err: any) {
    console.error('[messages/poll] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
