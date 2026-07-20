// Email unsubscribe link (appended to every review-request email).
// Suppresses the contact cross-channel — email AND phone.

import { createClient } from '@supabase/supabase-js';
import { addSuppression, logReviewEvent } from '../lib/review-guards.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const PAGE = (msg: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb;">
<div style="text-align:center;max-width:420px;padding:24px;"><h2 style="color:#111827;">${msg}</h2>
<p style="color:#6b7280;">You won't receive any more review requests from this business.</p></div></body></html>`;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response(PAGE('Link expired'), { headers: { 'Content-Type': 'text/html' } });

  const { data: request } = await supabase
    .from('review_requests')
    .select('id, business_id, contact_id')
    .eq('click_token', token)
    .maybeSingle();

  if (request) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('phone, email')
      .eq('id', request.contact_id)
      .maybeSingle();
    await addSuppression(request.business_id, {
      phone: contact?.phone ?? null,
      email: contact?.email ?? null,
      reason: 'manual',
      source: 'email_unsubscribe',
    });
    await logReviewEvent({
      businessId: request.business_id,
      requestId: request.id,
      contactId: request.contact_id,
      type: 'opted_out',
      channel: 'email',
    });
  }

  return new Response(PAGE("You've been unsubscribed"), { headers: { 'Content-Type': 'text/html' } });
}
