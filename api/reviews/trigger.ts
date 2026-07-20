// Inbound trigger for Zapier / CRM connectors / generic webhooks:
// "job completed → queue a review request". Auth = the business's inbound
// token (Settings → Integrations). Creates/updates the contact and queues an
// initial request in the business's ongoing campaign, honouring cooldown +
// suppression. This endpoint is what makes "Custom CRM Integration" real.

import { createClient } from '@supabase/supabase-js';
import { isSuppressed, normalizePhone } from '../lib/review-guards.js';
import { scheduleSlots, randomToken, type SendSettings } from '../lib/review-send.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const COOLDOWN_DAYS = 30;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const url = new URL(req.url);
  const token = url.searchParams.get('token') || req.headers.get('x-elsie-token');
  if (!token) return new Response(JSON.stringify({ error: 'Missing token' }), { status: 401 });

  const { data: settings } = await supabase
    .from('review_settings')
    .select('*')
    .eq('inbound_token', token)
    .maybeSingle();
  if (!settings) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  const businessId = settings.business_id as string;

  try {
    const body = (await req.json()) as {
      first_name?: string; last_name?: string; name?: string;
      phone?: string; email?: string;
    };
    const name = (body.name || `${body.first_name ?? ''} ${body.last_name ?? ''}`).trim();
    const phone = normalizePhone(body.phone);
    const email = body.email?.trim().toLowerCase() || null;
    if (!phone && !email) {
      return new Response(JSON.stringify({ error: 'phone or email required' }), { status: 400 });
    }

    if (await isSuppressed(businessId, { phone, email })) {
      return new Response(JSON.stringify({ ok: true, skipped: 'suppressed' }), { status: 200 });
    }

    // Find-or-create the contact (phone first, then email)
    let contactId: string | null = null;
    if (phone) {
      const { data } = await supabase.from('contacts').select('id').eq('business_id', businessId).eq('phone', phone).maybeSingle();
      contactId = data?.id ?? null;
    }
    if (!contactId && email) {
      const { data } = await supabase.from('contacts').select('id').eq('business_id', businessId).eq('email', email).maybeSingle();
      contactId = data?.id ?? null;
    }
    if (!contactId) {
      const { data, error } = await supabase
        .from('contacts')
        .insert({ business_id: businessId, name: name || 'Customer', phone, email })
        .select('id')
        .single();
      if (error || !data) return new Response(JSON.stringify({ error: error?.message || 'contact create failed' }), { status: 500 });
      contactId = data.id;
    }

    // Cooldown: don't re-ask within 30 days / while a funnel row is open
    const since = new Date(Date.now() - COOLDOWN_DAYS * 86400_000).toISOString();
    const { data: recent } = await supabase
      .from('review_requests')
      .select('id')
      .eq('business_id', businessId)
      .eq('contact_id', contactId)
      .or(`created_at.gte.${since},status.in.(queued,in_progress)`)
      .limit(1);
    if (recent?.length) {
      return new Response(JSON.stringify({ ok: true, skipped: 'cooldown' }), { status: 200 });
    }

    // Ongoing campaign (find-or-create)
    let { data: campaign } = await supabase
      .from('review_campaigns')
      .select('id, total_contacts')
      .eq('business_id', businessId)
      .eq('type', 'ongoing')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (!campaign) {
      const { data: created } = await supabase
        .from('review_campaigns')
        .insert({ business_id: businessId, name: 'Ongoing (new customers)', type: 'ongoing' })
        .select('id, total_contacts')
        .single();
      campaign = created!;
    }

    // "When to send the first request" (Right away → 1 week): shift the base
    // time by the configured delay, then scheduleSlots rolls it into the
    // 09:00–20:00 send window as usual.
    const delayMs = ((settings.initial_delay_hours as number) || 0) * 3600_000;
    const [slot] = scheduleSlots(settings as SendSettings, 1, new Date(Date.now() + delayMs));
    const { data: request, error: reqErr } = await supabase
      .from('review_requests')
      .insert({
        business_id: businessId,
        contact_id: contactId,
        campaign_id: campaign.id,
        status: 'queued',
        next_send_at: slot,
        click_token: randomToken(),
      })
      .select('id')
      .single();
    if (reqErr) return new Response(JSON.stringify({ error: reqErr.message }), { status: 500 });

    await supabase
      .from('review_campaigns')
      .update({ total_contacts: (campaign.total_contacts ?? 0) + 1 })
      .eq('id', campaign.id);

    return new Response(JSON.stringify({ ok: true, requestId: request!.id, scheduledFor: slot }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
