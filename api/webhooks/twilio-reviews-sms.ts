// Inbound SMS webhook for the per-client review sender numbers.
// Twilio "A MESSAGE COMES IN" points here (wired at number purchase).
// Signature-validated FAIL CLOSED. STOP handling comes before everything else.

import { createClient } from '@supabase/supabase-js';
import {
  validateTwilioSignature,
  isStopMessage,
  addSuppression,
  logReviewEvent,
  normalizePhone,
} from '../lib/review-guards.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

function twiml(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { params[k] = String(v); });

  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
  const valid = await validateTwilioSignature({
    url: `${appUrl}/api/webhooks/twilio-reviews-sms`,
    params,
    signature: req.headers.get('x-twilio-signature'),
  });
  if (!valid) return new Response('Invalid signature', { status: 403 });

  const from = normalizePhone(params.From);
  const to = normalizePhone(params.To);
  const body = params.Body || '';
  if (!from || !to) return twiml();

  // Which client does this sender number belong to?
  const { data: settings } = await supabase
    .from('review_settings')
    .select('business_id')
    .eq('sms_from_number', to)
    .maybeSingle();
  if (!settings) return twiml();

  const businessId = settings.business_id as string;

  // Find the contact (for event attribution)
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, email')
    .eq('business_id', businessId)
    .eq('phone', from)
    .maybeSingle();

  if (isStopMessage(body)) {
    await addSuppression(businessId, {
      phone: from,
      email: contact?.email ?? null,
      reason: 'stop_keyword',
      source: 'sms_webhook',
    });
    await logReviewEvent({
      businessId,
      contactId: contact?.id ?? null,
      type: 'opted_out',
      channel: 'sms',
      meta: { body },
    });
    return twiml("You've been unsubscribed and won't receive any more messages.");
  }

  // Any other reply — log it so it shows on the client's dashboard thread.
  await logReviewEvent({
    businessId,
    contactId: contact?.id ?? null,
    type: 'reply_received',
    channel: 'sms',
    meta: { body: body.slice(0, 1000), from },
  });
  return twiml();
}
