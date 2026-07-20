// Twilio delivery-status callback for review-request SMS (StatusCallback param
// is set on every send). Keeps dashboard numbers honest: delivered vs failed.

import { createClient } from '@supabase/supabase-js';
import { validateTwilioSignature, logReviewEvent } from '../lib/review-guards.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { params[k] = String(v); });

  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
  const valid = await validateTwilioSignature({
    url: `${appUrl}/api/webhooks/twilio-reviews-status`,
    params,
    signature: req.headers.get('x-twilio-signature'),
  });
  if (!valid) return new Response('Invalid signature', { status: 403 });

  const sid = params.MessageSid;
  const status = params.MessageStatus; // queued|sent|delivered|undelivered|failed
  if (!sid || !status) return new Response('ok', { status: 200 });

  const { data: request } = await supabase
    .from('review_requests')
    .select('id, business_id, contact_id, status, followups_sent')
    .eq('twilio_sid', sid)
    .maybeSingle();
  if (!request) return new Response('ok', { status: 200 });

  if (status === 'delivered') {
    await supabase
      .from('review_requests')
      .update({ delivered_at: new Date().toISOString() })
      .eq('id', request.id);
    await logReviewEvent({
      businessId: request.business_id,
      requestId: request.id,
      contactId: request.contact_id,
      type: 'delivered',
      channel: 'sms',
    });
  } else if (status === 'failed' || status === 'undelivered') {
    const error = `Twilio ${status}${params.ErrorCode ? ` (${params.ErrorCode})` : ''}`;
    // Only the initial send failing kills the row; a failed follow-up keeps
    // whatever state the funnel already reached.
    await supabase
      .from('review_requests')
      .update({
        error,
        ...(request.followups_sent === 0 ? { status: 'failed', next_send_at: null } : {}),
      })
      .eq('id', request.id);
    await logReviewEvent({
      businessId: request.business_id,
      requestId: request.id,
      contactId: request.contact_id,
      type: 'failed',
      channel: 'sms',
      meta: { error },
    });
  }

  return new Response('ok', { status: 200 });
}
