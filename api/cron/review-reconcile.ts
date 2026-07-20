// Nightly reconcile: pull the latest reviews page per connected business from
// Zernio (webhooks are primary; this catches anything missed), refresh rating
// stats, and run stop-on-review matching for still-active requests.

import { createClient } from '@supabase/supabase-js';
import { listReviews } from '../../src/integrations/zernio/client.js';
import { logReviewEvent } from '../lib/review-guards.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

function firstName(full: string | null | undefined): string | null {
  const t = full?.trim().split(/\s+/)[0];
  return t ? t.toLowerCase() : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { data: conns } = await supabase
    .from('gbp_connections')
    .select('business_id, zernio_account_id')
    .eq('status', 'connected')
    .not('zernio_account_id', 'is', null);

  let synced = 0;
  let matched = 0;

  for (const conn of conns ?? []) {
    try {
      const page = await listReviews(conn.zernio_account_id as string);
      if (page.reviews?.length) {
        await supabase.from('gbp_reviews').upsert(
          page.reviews.map((r) => ({
            business_id: conn.business_id,
            zernio_review_id: r.name,
            rating: r.rating,
            comment: r.comment ?? null,
            reviewer_name: r.reviewer?.displayName ?? null,
            reviewer_photo: r.reviewer?.profilePhotoUrl ?? null,
            review_created_at: r.createTime,
            review_updated_at: r.updateTime,
            has_reply: !!r.reviewReply,
            reply_text: r.reviewReply?.comment ?? null,
          })),
          { onConflict: 'business_id,zernio_review_id', ignoreDuplicates: false },
        );
      }
      await supabase.from('gbp_connections').update({
        avg_rating: page.averageRating ?? null,
        total_reviews: page.totalReviewCount ?? null,
        last_synced_at: new Date().toISOString(),
      }).eq('business_id', conn.business_id);
      synced++;

      // Stop-on-review catch-up: match unmatched recent reviews to active requests.
      const { data: unmatchedReviews } = await supabase
        .from('gbp_reviews')
        .select('id, reviewer_name, rating, review_created_at')
        .eq('business_id', conn.business_id)
        .is('matched_request_id', null)
        .gte('review_created_at', new Date(Date.now() - 45 * 86400_000).toISOString());
      if (!unmatchedReviews?.length) continue;

      const { data: active } = await supabase
        .from('review_requests')
        .select('id, contact_id, contacts(name)')
        .eq('business_id', conn.business_id)
        .in('status', ['queued', 'in_progress']);
      if (!active?.length) continue;

      for (const rev of unmatchedReviews) {
        const fn = firstName(rev.reviewer_name);
        if (!fn) continue;
        const hit = active.find((a) => firstName((a.contacts as unknown as { name?: string } | null)?.name) === fn);
        if (!hit) continue;
        await supabase.from('review_requests').update({
          status: 'reviewed', reviewed_at: rev.review_created_at ?? new Date().toISOString(), next_send_at: null,
        }).eq('id', hit.id);
        await supabase.from('gbp_reviews').update({ matched_request_id: hit.id }).eq('id', rev.id);
        await logReviewEvent({
          businessId: conn.business_id, requestId: hit.id, contactId: hit.contact_id,
          type: 'reviewed', meta: { rating: rev.rating, via: 'reconcile' },
        });
        matched++;
      }
    } catch (err) {
      console.error('[review-reconcile]', conn.business_id, (err as Error).message);
    }
  }

  return new Response(JSON.stringify({ ok: true, synced, matched }), { status: 200 });
}
