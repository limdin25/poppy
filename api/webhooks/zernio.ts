// Zernio webhook — real-time Google review events (Pub/Sub-backed, no polling).
// review.new: cache the review, stop-on-review match against active requests,
// draft an AI reply (auto-post 4-5★ if enabled, hold 1-3★ for approval),
// optionally repurpose 5★ as a GBP post, fire client Zapier webhooks.

import { createClient } from '@supabase/supabase-js';
import { verifyZernioSignature, replyToReview, createGbpPost } from '../../src/integrations/zernio/client.js';
import { callLLM } from '../lib/llm.js';
import { logReviewEvent, fireReviewWebhooks } from '../lib/review-guards.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

interface ZernioReviewEvent {
  id: string;
  event: 'review.new' | 'review.updated' | string;
  review?: {
    id: string;            // full Google review resource name
    platform: string;
    rating: number;
    text?: string;
    reviewer?: { id?: string | null; name?: string; profileImage?: string | null };
    createdAt?: string;
    hasReply?: boolean;
    reply?: { text?: string; createdAt?: string } | null;
  };
  account?: { id: string; accountId?: string; platform?: string; username?: string };
}

function firstName(full: string | null | undefined): string | null {
  const t = full?.trim().split(/\s+/)[0];
  return t ? t.toLowerCase() : null;
}

async function draftReply(businessId: string, review: { rating: number; text?: string; reviewer?: { name?: string } }): Promise<string> {
  const { data: settings } = await supabase
    .from('review_settings')
    .select('business_display_name')
    .eq('business_id', businessId)
    .maybeSingle();
  const { data: biz } = await supabase.from('businesses').select('name').eq('id', businessId).single();
  const bizName = settings?.business_display_name || biz?.name || 'our business';
  const reviewer = review.reviewer?.name?.split(/\s+/)[0] || 'there';

  const system = `You write short owner replies to Google reviews for ${bizName}, a UK service business. UK English. Warm, specific, professional. 1-3 sentences. Address the reviewer by first name. Reference something specific from their review when possible. Never offer incentives, discounts or refunds. For 1-3 star reviews: apologise sincerely, take responsibility without excuses, and invite them to contact the business directly to put it right. Output ONLY the reply text.`;
  const user = `Review from ${reviewer} — ${review.rating} stars:\n"${review.text || '(no comment left)'}"`;

  const reply = await callLLM('claude-sonnet-4-6', system, [{ role: 'user', content: user }], 300);
  return reply.trim();
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) return new Response('Webhook not configured', { status: 500 });

  const signature = req.headers.get('x-zernio-signature') || req.headers.get('x-late-signature');
  const valid = await verifyZernioSignature(rawBody, signature, secret);
  if (!valid) return new Response('Invalid signature', { status: 403 });

  let payload: ZernioReviewEvent;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad payload', { status: 400 });
  }

  if (payload.event !== 'review.new' && payload.event !== 'review.updated') {
    return new Response(JSON.stringify({ ok: true, ignored: payload.event }), { status: 200 });
  }
  const review = payload.review;
  const zernioAccountId = payload.account?.id;
  if (!review?.id || !zernioAccountId) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  const { data: conn } = await supabase
    .from('gbp_connections')
    .select('business_id, zernio_account_id, review_url')
    .eq('zernio_account_id', zernioAccountId)
    .maybeSingle();
  if (!conn) return new Response(JSON.stringify({ ok: true, unknownAccount: true }), { status: 200 });
  const businessId = conn.business_id as string;

  // Idempotent upsert (webhooks are at-least-once).
  const { data: existing } = await supabase
    .from('gbp_reviews')
    .select('id, ai_draft_status, matched_request_id')
    .eq('business_id', businessId)
    .eq('zernio_review_id', review.id)
    .maybeSingle();

  const base = {
    business_id: businessId,
    zernio_review_id: review.id,
    rating: review.rating,
    comment: review.text ?? null,
    reviewer_name: review.reviewer?.name ?? null,
    reviewer_photo: review.reviewer?.profileImage ?? null,
    review_created_at: review.createdAt ?? new Date().toISOString(),
    review_updated_at: new Date().toISOString(),
    has_reply: !!review.hasReply,
    reply_text: review.reply?.text ?? null,
  };

  if (existing) {
    await supabase.from('gbp_reviews').update(base).eq('id', existing.id);
    return new Response(JSON.stringify({ ok: true, updated: true }), { status: 200 });
  }

  const { data: inserted } = await supabase
    .from('gbp_reviews')
    .insert(base)
    .select('id')
    .single();
  const reviewRowId = inserted?.id as string;

  // ── Stop-on-review: match reviewer first name against active requests ──
  let matchedRequest: { id: string; contact_id: string; campaign_id: string | null } | null = null;
  const fn = firstName(review.reviewer?.name);
  if (fn) {
    const { data: active } = await supabase
      .from('review_requests')
      .select('id, contact_id, campaign_id, contacts(name)')
      .eq('business_id', businessId)
      .in('status', ['queued', 'in_progress'])
      .gte('created_at', new Date(Date.now() - 45 * 86400 * 1000).toISOString());
    matchedRequest = (active ?? []).find((r) => {
      const contact = r.contacts as unknown as { name?: string } | null;
      return firstName(contact?.name) === fn;
    }) as typeof matchedRequest;
  }

  if (matchedRequest) {
    await supabase
      .from('review_requests')
      .update({ status: 'reviewed', reviewed_at: new Date().toISOString(), next_send_at: null })
      .eq('id', matchedRequest.id);
    await supabase.from('gbp_reviews').update({ matched_request_id: matchedRequest.id }).eq('id', reviewRowId);
    if (matchedRequest.campaign_id) {
      const { data: camp } = await supabase
        .from('review_campaigns')
        .select('reviewed_count')
        .eq('id', matchedRequest.campaign_id)
        .single();
      await supabase
        .from('review_campaigns')
        .update({ reviewed_count: (camp?.reviewed_count ?? 0) + 1 })
        .eq('id', matchedRequest.campaign_id);
    }
    await logReviewEvent({
      businessId,
      requestId: matchedRequest.id,
      contactId: matchedRequest.contact_id,
      type: 'reviewed',
      meta: { rating: review.rating },
    });
  }

  // ── AI reply: auto-post 4-5★ (if enabled), hold 1-3★ for approval ──
  const { data: settings } = await supabase
    .from('review_settings')
    .select('auto_reply_positive, auto_post_five_star')
    .eq('business_id', businessId)
    .maybeSingle();

  if (!review.hasReply) {
    try {
      const draft = await draftReply(businessId, review);
      if (draft) {
        if (review.rating >= 4 && settings?.auto_reply_positive) {
          const reviewIdOnly = review.id.split('/').pop()!;
          await replyToReview(conn.zernio_account_id as string, reviewIdOnly, draft);
          await supabase
            .from('gbp_reviews')
            .update({ ai_draft: draft, ai_draft_status: 'posted', has_reply: true, reply_text: draft, reply_posted_at: new Date().toISOString() })
            .eq('id', reviewRowId);
          await logReviewEvent({ businessId, type: 'reply_posted', meta: { rating: review.rating, auto: true } });
        } else {
          await supabase
            .from('gbp_reviews')
            .update({ ai_draft: draft, ai_draft_status: 'pending_approval' })
            .eq('id', reviewRowId);
        }
      }
    } catch (err) {
      console.error('[zernio webhook] reply draft failed:', (err as Error).message);
    }
  }

  // ── Repurpose 5★ reviews as GBP posts (opt-in) ──
  if (review.rating === 5 && settings?.auto_post_five_star && review.text && review.text.length >= 30) {
    try {
      const content = `⭐⭐⭐⭐⭐ "${review.text.slice(0, 1200)}" — ${review.reviewer?.name?.split(/\s+/)[0] || 'a happy customer'}`;
      await createGbpPost({
        accountId: conn.zernio_account_id as string,
        content,
        requestId: reviewRowId,
      });
      await supabase
        .from('gbp_reviews')
        .update({ social_posted_at: new Date().toISOString() })
        .eq('id', reviewRowId);
      await logReviewEvent({ businessId, type: 'gbp_post_created', meta: { reviewId: review.id } });
    } catch (err) {
      console.error('[zernio webhook] GBP post failed:', (err as Error).message);
    }
  }

  await supabase
    .from('gbp_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('business_id', businessId);

  await fireReviewWebhooks(businessId, 'review.received', {
    rating: review.rating,
    text: review.text ?? null,
    reviewer: review.reviewer?.name ?? null,
    createdAt: review.createdAt ?? null,
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
