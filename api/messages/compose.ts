import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {
    const { to, subject, body } = await req.json() as {
      to?: string;
      subject?: string;
      body?: string;
    };

    if (!to || !body) {
      return new Response(
        JSON.stringify({ error: 'to and body are required' }),
        { status: 400 },
      );
    }

    // Get connected email channel (gmail, outlook, or smtp)
    let channel: { id: string; unipile_account_id: string } | null = null;
    for (const t of ['email_gmail', 'email_outlook', 'email_smtp']) {
      const { data } = await supabase
        .from('channels')
        .select('id, unipile_account_id')
        .eq('business_id', businessId)
        .eq('type', t)
        .eq('status', 'connected')
        .maybeSingle();
      if (data) { channel = data; break; }
    }

    if (!channel?.unipile_account_id) {
      return new Response(
        JSON.stringify({ error: 'No connected email channel. Connect one in Settings.' }),
        { status: 400 },
      );
    }

    // Send via Unipile
    const htmlBody = body.replace(/\n/g, '<br>');
    const uRes = await fetch(`https://${UNIPILE_DSN}/api/v1/emails`, {
      method: 'POST',
      headers: {
        'X-API-KEY': UNIPILE_TOKEN,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        account_id: channel.unipile_account_id,
        to: [{ identifier: to }],
        subject: subject || '(no subject)',
        body: htmlBody,
      }),
    });

    const uText = await uRes.text();
    if (!uRes.ok) {
      return new Response(
        JSON.stringify({ error: `Email send failed: ${uRes.status}`, detail: uText.slice(0, 500) }),
        { status: 502 },
      );
    }

    let externalId: string | null = null;
    try {
      const uJson = JSON.parse(uText);
      externalId = uJson.email_id ?? uJson.id ?? null;
    } catch {}

    // Find or create contact
    let contactId: string | null = null;
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('business_id', businessId)
      .eq('email', to)
      .maybeSingle();

    if (existing) {
      contactId = existing.id;
    } else {
      const { data: newContact } = await supabase
        .from('contacts')
        .insert({ business_id: businessId, email: to, name: to })
        .select('id')
        .single();
      contactId = newContact?.id || null;
    }

    if (!contactId) {
      return new Response(JSON.stringify({ error: 'Failed to create contact' }), { status: 500 });
    }

    // Create conversation
    const normalSubject = (subject || '').replace(/^(Re|Fwd|Fw):\s*/gi, '').trim().toLowerCase() || null;
    const { data: convo } = await supabase
      .from('conversations')
      .insert({
        business_id: businessId,
        contact_id: contactId,
        channel: 'email',
        status: 'open',
        ai_handling: false,
        subject: normalSubject,
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 100),
      })
      .select('id')
      .single();

    if (!convo) {
      return new Response(JSON.stringify({ error: 'Failed to create conversation' }), { status: 500 });
    }

    // Store message
    await supabase.from('messages').insert({
      conversation_id: convo.id,
      direction: 'outbound',
      sender: 'human',
      content_type: 'text',
      body,
      metadata: {
        external_id: externalId,
        via: 'unipile_email',
        subject: subject || '(no subject)',
        to_attendees: [{ identifier: to }],
      },
    });

    return new Response(
      JSON.stringify({ ok: true, conversation_id: convo.id }),
      { status: 200 },
    );
  } catch (err: any) {
    console.error('[messages/compose] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
