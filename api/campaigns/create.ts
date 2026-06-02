import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { name, message_template, audience_filter } = (await req.json()) as {
      name?: string;
      message_template?: string;
      audience_filter?: { lead_status?: string[]; tags?: string[] };
    };

    if (!name || !message_template) {
      return new Response(JSON.stringify({ error: 'name and message_template are required' }), { status: 400 });
    }

    const filter = audience_filter || {};

    // Build the audience: WhatsApp-reachable contacts, optionally filtered by lead status / tags
    let query = supabase
      .from('contacts')
      .select('id, phone, whatsapp, tags')
      .eq('business_id', auth.businessId);

    if (filter.lead_status && filter.lead_status.length > 0) {
      query = query.in('lead_status', filter.lead_status);
    }
    if (filter.tags && filter.tags.length > 0) {
      query = query.overlaps('tags', filter.tags);
    }

    const { data: contacts, error: cErr } = await query;
    if (cErr) return new Response(JSON.stringify({ error: cErr.message }), { status: 500 });

    const recipients = (contacts || []).filter(
      (c) => (c.whatsapp || c.phone) && !(c.tags || []).includes('unsubscribed'),
    );

    const { data: campaign, error: insErr } = await supabase
      .from('campaigns')
      .insert({
        business_id: auth.businessId,
        name,
        channel: 'whatsapp',
        message_template,
        audience_filter: filter,
        status: 'draft',
        recipient_count: recipients.length,
      })
      .select('id')
      .single();

    if (insErr || !campaign) {
      return new Response(JSON.stringify({ error: insErr?.message || 'Failed to create campaign' }), { status: 500 });
    }

    if (recipients.length > 0) {
      const rows = recipients.map((c) => ({
        campaign_id: campaign.id,
        contact_id: c.id,
        status: 'pending',
      }));
      const { error: rErr } = await supabase.from('campaign_recipients').insert(rows);
      if (rErr) return new Response(JSON.stringify({ error: rErr.message }), { status: 500 });
    }

    return new Response(
      JSON.stringify({ ok: true, campaign_id: campaign.id, recipient_count: recipients.length }),
      { status: 200 },
    );
  } catch (err: any) {
    console.error('[campaigns/create] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
