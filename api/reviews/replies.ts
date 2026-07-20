// Approve / edit / reject the held AI reply drafts (1-3★ reviews are never
// auto-posted). Approve posts to Google via Zernio.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { replyToReview } from '../../src/integrations/zernio/client.js';
import { logReviewEvent } from '../lib/review-guards.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { review_id, action, edited } = (await req.json()) as {
      review_id?: string;
      action?: 'approve' | 'reject';
      edited?: string;
    };
    if (!review_id || !action) {
      return new Response(JSON.stringify({ error: 'review_id and action are required' }), { status: 400 });
    }

    const { data: review } = await supabase
      .from('gbp_reviews')
      .select('id, business_id, zernio_review_id, ai_draft, ai_draft_status')
      .eq('id', review_id)
      .eq('business_id', auth.businessId)
      .maybeSingle();
    if (!review) return new Response(JSON.stringify({ error: 'Review not found' }), { status: 404 });
    if (review.ai_draft_status !== 'pending_approval') {
      return new Response(JSON.stringify({ error: `Draft is ${review.ai_draft_status}, not pending approval` }), { status: 400 });
    }

    if (action === 'reject') {
      await supabase.from('gbp_reviews').update({ ai_draft_status: 'rejected' }).eq('id', review.id);
      return new Response(JSON.stringify({ ok: true, status: 'rejected' }), { status: 200 });
    }

    const finalText = (edited?.trim() || review.ai_draft || '').trim();
    if (!finalText) return new Response(JSON.stringify({ error: 'Reply text is empty' }), { status: 400 });

    const { data: conn } = await supabase
      .from('gbp_connections')
      .select('zernio_account_id')
      .eq('business_id', auth.businessId)
      .maybeSingle();
    if (!conn?.zernio_account_id) {
      return new Response(JSON.stringify({ error: 'Google Business Profile not connected' }), { status: 400 });
    }

    const reviewIdOnly = (review.zernio_review_id as string).split('/').pop()!;
    await replyToReview(conn.zernio_account_id, reviewIdOnly, finalText);

    await supabase.from('gbp_reviews').update({
      ai_draft: finalText,
      ai_draft_status: 'posted',
      has_reply: true,
      reply_text: finalText,
      reply_posted_at: new Date().toISOString(),
    }).eq('id', review.id);
    await logReviewEvent({ businessId: auth.businessId, type: 'reply_posted', meta: { reviewId: review.id, auto: false } });

    return new Response(JSON.stringify({ ok: true, status: 'posted' }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
