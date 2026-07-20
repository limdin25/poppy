// Sender-number purchases — ADMIN ONLY, deliberately manual (Hugo's rule:
// numbers are bought by an admin when a new client lands, never automatically).
// GET: pending queue. POST buy: search GB numbers → purchase → wire the
// inbound-SMS webhook → assign to the client.

import { createClient } from '@supabase/supabase-js';
import { requireAdminAny } from '../../lib/require-admin.js';
import { searchNumbers, provisionNumber, setNumberSmsUrl } from '../../../src/integrations/twilio/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const admin = await requireAdminAny(req);
  if (admin instanceof Response) return admin;

  if (req.method === 'GET') {
    const { data: requests } = await supabase
      .from('review_number_requests')
      .select('id, business_id, status, note, purchased_number, created_at, actioned_by, actioned_at')
      .order('created_at', { ascending: false })
      .limit(100);
    const ids = [...new Set((requests ?? []).map((r) => r.business_id))];
    const { data: businesses } = ids.length
      ? await supabase.from('businesses').select('id, name').in('id', ids)
      : { data: [] as Array<{ id: string; name: string }> };
    const nameById = new Map((businesses ?? []).map((b) => [b.id, b.name]));
    return new Response(JSON.stringify({
      requests: (requests ?? []).map((r) => ({ ...r, business_name: nameById.get(r.business_id) ?? r.business_id })),
    }), { status: 200 });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const { request_id, action } = (await req.json()) as { request_id?: string; action?: 'buy' | 'dismiss' };
    if (!request_id || !action) {
      return new Response(JSON.stringify({ error: 'request_id and action required' }), { status: 400 });
    }
    const { data: request } = await supabase
      .from('review_number_requests')
      .select('id, business_id, status')
      .eq('id', request_id)
      .maybeSingle();
    if (!request) return new Response(JSON.stringify({ error: 'Request not found' }), { status: 404 });
    if (request.status !== 'pending') {
      return new Response(JSON.stringify({ error: `Request already ${request.status}` }), { status: 400 });
    }

    if (action === 'dismiss') {
      await supabase.from('review_number_requests').update({
        status: 'dismissed', actioned_by: admin.email, actioned_at: new Date().toISOString(),
      }).eq('id', request.id);
      return new Response(JSON.stringify({ ok: true, status: 'dismissed' }), { status: 200 });
    }

    // Buy a UK mobile long code (long codes get native STOP handling; UK
    // alphanumeric senders can't receive replies, so they're not an option).
    const available = await searchNumbers('GB');
    const smsCapable = available.find((n) => (n as { capabilities?: { SMS?: boolean; sms?: boolean } }).capabilities?.SMS !== false);
    if (!smsCapable) {
      return new Response(JSON.stringify({ error: 'No GB numbers available from Twilio right now' }), { status: 502 });
    }

    const purchased = await provisionNumber(smsCapable.phone_number);
    const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
    await setNumberSmsUrl(purchased.sid, `${appUrl}/api/webhooks/twilio-reviews-sms`);

    await supabase.from('review_settings')
      .update({ sms_from_number: purchased.phone_number })
      .eq('business_id', request.business_id);
    await supabase.from('review_number_requests').update({
      status: 'purchased',
      purchased_number: purchased.phone_number,
      purchased_sid: purchased.sid,
      actioned_by: admin.email,
      actioned_at: new Date().toISOString(),
    }).eq('id', request.id);

    await supabase.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'reviews_number_purchased',
      target_type: 'business',
      target_id: request.business_id,
      metadata: { number: purchased.phone_number, sid: purchased.sid },
    });

    return new Response(JSON.stringify({ ok: true, number: purchased.phone_number }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
