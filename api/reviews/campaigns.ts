// Create / list review campaigns. A "reactivation" campaign enqueues every
// eligible contact (send-to-all — eligibility is only about deliverability and
// consent, NEVER sentiment): has phone or email, not suppressed, not asked in
// the last 30 days. Rows are drip-staggered inside the send window.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { isSuppressed } from '../lib/review-guards.js';
import { scheduleSlots, randomToken, type SendSettings } from '../lib/review-send.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const COOLDOWN_DAYS = 30;

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('review_campaigns')
      .select('*')
      .eq('business_id', auth.businessId)
      .order('created_at', { ascending: false });
    return new Response(JSON.stringify({ campaigns: data ?? [] }), { status: 200 });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const { name, type, contact_ids } = (await req.json()) as {
      name?: string;
      type?: 'reactivation' | 'ongoing';
      contact_ids?: string[];
    };

    const { data: settings } = await supabase
      .from('review_settings')
      .select('*')
      .eq('business_id', auth.businessId)
      .maybeSingle();
    if (!settings) {
      return new Response(JSON.stringify({ error: 'Finish onboarding first (review settings missing)' }), { status: 400 });
    }
    if (!settings.attested_at) {
      return new Response(JSON.stringify({ error: 'Confirm your lawful basis for contacting customers before sending (Settings → Compliance)' }), { status: 400 });
    }
    const { data: conn } = await supabase
      .from('gbp_connections')
      .select('status, review_url')
      .eq('business_id', auth.businessId)
      .maybeSingle();
    if (conn?.status !== 'connected' || !conn.review_url) {
      return new Response(JSON.stringify({ error: 'Connect your Google Business Profile before sending requests' }), { status: 400 });
    }

    // Candidate contacts
    let q = supabase
      .from('contacts')
      .select('id, name, phone, email')
      .eq('business_id', auth.businessId);
    if (contact_ids?.length) q = q.in('id', contact_ids.slice(0, 5000));
    const { data: contacts } = await q.limit(5000);

    // Contacts already asked recently or with an open funnel row
    const since = new Date(Date.now() - COOLDOWN_DAYS * 86400_000).toISOString();
    const { data: recent } = await supabase
      .from('review_requests')
      .select('contact_id, status, created_at')
      .eq('business_id', auth.businessId)
      .or(`created_at.gte.${since},status.in.(queued,in_progress)`);
    const excluded = new Set((recent ?? []).map((r) => r.contact_id));

    const eligible: Array<{ id: string }> = [];
    let skippedSuppressed = 0;
    let skippedNoChannel = 0;
    let skippedCooldown = 0;
    for (const c of contacts ?? []) {
      if (excluded.has(c.id)) { skippedCooldown++; continue; }
      if (!c.phone && !c.email) { skippedNoChannel++; continue; }
      if (await isSuppressed(auth.businessId, { phone: c.phone, email: c.email })) { skippedSuppressed++; continue; }
      eligible.push({ id: c.id });
    }

    if (!eligible.length) {
      return new Response(JSON.stringify({
        error: 'No eligible contacts to ask',
        skipped: { cooldown: skippedCooldown, suppressed: skippedSuppressed, no_channel: skippedNoChannel },
      }), { status: 400 });
    }

    const { data: campaign, error: campErr } = await supabase
      .from('review_campaigns')
      .insert({
        business_id: auth.businessId,
        name: name?.trim() || `Reactivation ${new Date().toLocaleDateString('en-GB')}`,
        type: type ?? 'reactivation',
        total_contacts: eligible.length,
      })
      .select('id')
      .single();
    if (campErr || !campaign) {
      return new Response(JSON.stringify({ error: campErr?.message || 'Campaign create failed' }), { status: 500 });
    }

    const slots = scheduleSlots(settings as SendSettings, eligible.length);
    const rows = eligible.map((c, i) => ({
      business_id: auth.businessId,
      contact_id: c.id,
      campaign_id: campaign.id,
      status: 'queued',
      next_send_at: slots[i],
      click_token: randomToken(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('review_requests').insert(rows.slice(i, i + 500));
      if (error) {
        return new Response(JSON.stringify({ error: `Enqueue failed at batch ${i}: ${error.message}` }), { status: 500 });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      campaignId: campaign.id,
      queued: eligible.length,
      firstSendAt: slots[0],
      lastSendAt: slots[slots.length - 1],
      skipped: { cooldown: skippedCooldown, suppressed: skippedSuppressed, no_channel: skippedNoChannel },
    }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
