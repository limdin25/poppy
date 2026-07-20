// The short review link: /r/{token} rewrites here. Records the click (which
// smart-stops follow-ups, mirroring Review Harvest) then bounces the customer
// straight to the Google "write a review" page.

import { createClient } from '@supabase/supabase-js';
import { logReviewEvent } from '../lib/review-guards.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const fallback = 'https://heyelsie.com';
  if (!token) return Response.redirect(fallback, 302);

  const { data: request } = await supabase
    .from('review_requests')
    .select('id, business_id, contact_id, clicked_at')
    .eq('click_token', token)
    .maybeSingle();
  if (!request) return Response.redirect(fallback, 302);

  const { data: conn } = await supabase
    .from('gbp_connections')
    .select('review_url')
    .eq('business_id', request.business_id)
    .maybeSingle();

  if (!request.clicked_at) {
    await supabase
      .from('review_requests')
      .update({ clicked_at: new Date().toISOString() })
      .eq('id', request.id);
    await logReviewEvent({
      businessId: request.business_id,
      requestId: request.id,
      contactId: request.contact_id,
      type: 'clicked',
    });
  }

  return Response.redirect(conn?.review_url || fallback, 302);
}
