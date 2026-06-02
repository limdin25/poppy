import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

export const config = { runtime: 'edge' };

function render(template: string, name: string | null): string {
  return template.replace(/\{name\}/gi, (name || 'there').split(' ')[0]);
}

// Find an open WhatsApp conversation for a contact, or create one, so the
// blast shows in the inbox and threads with any reply.
async function ensureConversation(businessId: string, contactId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('business_id', businessId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .eq('status', 'open')
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await supabase
    .from('conversations')
    .insert({ business_id: businessId, contact_id: contactId, channel: 'whatsapp', status: 'open', ai_handling: false })
    .select('id')
    .single();
  return created?.id || null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { campaignId } = (await req.json()) as { campaignId?: string };
    if (!campaignId) {
      return new Response(JSON.stringify({ error: 'campaignId is required' }), { status: 400 });
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, business_id, message_template, status')
      .eq('id', campaignId)
      .single();

    if (!campaign || campaign.business_id !== auth.businessId) {
      return new Response(JSON.stringify({ error: 'Campaign not found' }), { status: 404 });
    }
    if (campaign.status === 'sending' || campaign.status === 'sent') {
      return new Response(JSON.stringify({ error: 'Campaign already sent' }), { status: 400 });
    }

    // Connected WhatsApp channel
    const { data: channel } = await supabase
      .from('channels')
      .select('unipile_account_id')
      .eq('business_id', auth.businessId)
      .eq('type', 'whatsapp')
      .eq('status', 'connected')
      .maybeSingle();

    if (!channel?.unipile_account_id) {
      return new Response(JSON.stringify({ error: 'No connected WhatsApp channel. Connect one in Settings.' }), { status: 400 });
    }

    await supabase.from('campaigns').update({ status: 'sending' }).eq('id', campaignId);

    // Pending recipients with contact phone
    const { data: recipients } = await supabase
      .from('campaign_recipients')
      .select('id, contact_id, contacts(id, name, phone, whatsapp)')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending');

    let sent = 0;
    let failed = 0;

    for (const r of recipients || []) {
      const contact = (r as any).contacts as { id: string; name: string | null; phone: string | null; whatsapp: string | null } | null;
      const phone = contact?.whatsapp || contact?.phone;
      if (!contact || !phone) {
        failed++;
        await supabase.from('campaign_recipients').update({ status: 'failed', error: 'No phone' }).eq('id', r.id);
        continue;
      }

      const text = render(campaign.message_template, contact.name);
      try {
        const uRes = await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: { 'X-API-KEY': UNIPILE_TOKEN, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ account_id: channel.unipile_account_id, attendees_ids: [phone], text }),
        });

        if (!uRes.ok) {
          failed++;
          await supabase.from('campaign_recipients').update({ status: 'failed', error: `Unipile ${uRes.status}` }).eq('id', r.id);
          continue;
        }

        let externalId: string | null = null;
        try {
          const j = JSON.parse(await uRes.text());
          externalId = j.chat_id ?? j.message_id ?? j.id ?? null;
        } catch {}

        // Record the outbound message in the inbox thread
        const conversationId = await ensureConversation(auth.businessId, contact.id);
        if (conversationId) {
          await supabase.from('messages').insert({
            conversation_id: conversationId,
            direction: 'outbound',
            sender: 'human',
            content_type: 'text',
            body: text,
            metadata: { external_id: externalId, via: 'campaign', campaign_id: campaignId },
          });
          await supabase
            .from('conversations')
            .update({ last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 100) })
            .eq('id', conversationId);
        }

        sent++;
        await supabase.from('campaign_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id);
      } catch (err: any) {
        failed++;
        await supabase.from('campaign_recipients').update({ status: 'failed', error: (err?.message || 'send error').slice(0, 200) }).eq('id', r.id);
      }
    }

    await supabase
      .from('campaigns')
      .update({ status: 'sent', sent_count: sent, failed_count: failed, sent_at: new Date().toISOString() })
      .eq('id', campaignId);

    return new Response(JSON.stringify({ ok: true, sent, failed }), { status: 200 });
  } catch (err: any) {
    console.error('[campaigns/send] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
