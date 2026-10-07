import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

// Inbound texts to the old receptionist numbers (5169, 8278) land here.
//
// NOTHING TEXTS ANYBODY ON ITS OWN. Until 7 Oct 2026 this handler had Claude
// write a reply and texted it straight back to whoever had texted in, with no
// human pressing send. It sent 6 of those on 26 Aug, the JL Brickwork day, and
// one more on 27 Aug, the day after Hugo ordered every text automation off;
// it was missed because it is not the Retell recap. It now only saves the
// inbound text so a person can read it and choose to answer.
// Pinned by tests/receptionist-off.test.ts.

const empty = () => new Response('', { status: 200, headers: { 'Content-Type': 'text/xml' } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return empty();
  try {
    const params = new URLSearchParams(await req.text());
    const from = (params.get('From') || '').trim();     // the customer
    const to = (params.get('To') || '').trim();          // our Elsie number
    const body = (params.get('Body') || '').trim();
    const sid = params.get('MessageSid') || null;
    if (!from || !to || !body) return empty();

    // Which business owns the number that was texted?
    const { data: channels } = await supabase
      .from('channels')
      .select('business_id, agent_id, config')
      .in('type', ['voice', 'sms']);
    const channel = (channels || []).find((c: any) => (c.config?.phone || '') === to);
    if (!channel) return empty();
    const businessId = channel.business_id as string;
    const agentId = (channel.agent_id as string) || null;

    // Find or create the contact by phone.
    let contactId: string | null = null;
    const { data: existingContact } = await supabase
      .from('contacts').select('id').eq('business_id', businessId).eq('phone', from).maybeSingle();
    if (existingContact) contactId = existingContact.id;
    else {
      const { data: nc } = await supabase.from('contacts').insert({ business_id: businessId, phone: from }).select('id').single();
      contactId = nc?.id || null;
    }

    // Find or create the SMS conversation for this contact.
    let conversationId: string | null = null;
    const { data: convo } = await supabase
      .from('conversations').select('id')
      .eq('business_id', businessId).eq('contact_id', contactId).eq('channel', 'sms')
      .neq('status', 'archived').order('last_message_at', { ascending: false }).limit(1).maybeSingle();
    if (convo) conversationId = convo.id;
    else {
      const { data: nc } = await supabase.from('conversations').insert({
        business_id: businessId, contact_id: contactId, agent_id: agentId,
        channel: 'sms', status: 'open', last_message_at: new Date().toISOString(),
        last_message_preview: body, unread_count: 1, ai_handling: false,
      }).select('id').single();
      conversationId = nc?.id || null;
    }

    // Store the inbound text. No reply is generated or sent.
    await supabase.from('messages').insert({
      conversation_id: conversationId, direction: 'inbound', sender: 'contact',
      content_type: 'text', body, metadata: { twilio_sid: sid },
    });
    if (convo) {
      await supabase.from('conversations').update({
        last_message_at: new Date().toISOString(), last_message_preview: body,
      }).eq('id', conversationId);
    }
    return empty();
  } catch (e) {
    console.error('[twilio-sms] error:', e);
    return empty();
  }
}
