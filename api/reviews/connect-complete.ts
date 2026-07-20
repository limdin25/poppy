// Finish the GBP connection after Zernio redirects back with
// ?connected=googlebusiness&profileId=…&accountId=…. The frontend posts those
// here; we verify the profile belongs to THIS business, pull the location
// details (place id + public review URL), seed the reviews cache, and make
// sure our Zernio webhook subscription exists.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import {
  getLocationDetails,
  listReviews,
  listWebhookSettings,
  createWebhookSetting,
} from '../../src/integrations/zernio/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

async function ensureZernioWebhook(): Promise<void> {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
  if (!secret) return;
  const url = `${appUrl}/api/webhooks/zernio`;
  try {
    const settings = (await listWebhookSettings()) as { webhooks?: Array<{ url: string }> } | Array<{ url: string }>;
    const list = Array.isArray(settings) ? settings : settings.webhooks ?? [];
    if (list.some((w) => w.url === url)) return;
    await createWebhookSetting({
      name: 'HeyElsie Reviews',
      url,
      secret,
      events: ['review.new', 'review.updated', 'account.disconnected'],
    });
  } catch (err) {
    console.error('[zernio] ensure webhook failed:', (err as Error).message);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { profileId, accountId } = (await req.json()) as { profileId?: string; accountId?: string };
    if (!profileId || !accountId) {
      return new Response(JSON.stringify({ error: 'profileId and accountId are required' }), { status: 400 });
    }

    // The redirect params must match the Zernio profile we created for THIS business.
    const { data: conn } = await supabase
      .from('gbp_connections')
      .select('zernio_profile_id')
      .eq('business_id', auth.businessId)
      .maybeSingle();
    if (!conn || conn.zernio_profile_id !== profileId) {
      return new Response(JSON.stringify({ error: 'Connection mismatch — restart the Google connect step' }), { status: 400 });
    }

    const details = await getLocationDetails(accountId);
    const loc = details.location;

    // Seed the reviews cache with the latest page + rating stats.
    let avgRating: number | null = null;
    let totalReviews: number | null = null;
    try {
      const page = await listReviews(accountId);
      avgRating = page.averageRating ?? null;
      totalReviews = page.totalReviewCount ?? null;
      if (page.reviews?.length) {
        await supabase.from('gbp_reviews').upsert(
          page.reviews.map((r) => ({
            business_id: auth.businessId,
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
    } catch (err) {
      console.error('[zernio] seed reviews failed:', (err as Error).message);
    }

    await supabase
      .from('gbp_connections')
      .update({
        zernio_account_id: accountId,
        location_name: (details as { title?: string }).title ?? loc?.name ?? null,
        place_id: loc?.placeId ?? null,
        review_url: loc?.reviewUrl ?? null,
        maps_url: loc?.mapsUri ?? null,
        avg_rating: avgRating,
        total_reviews: totalReviews,
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .eq('business_id', auth.businessId);

    if (loc?.placeId) {
      await supabase
        .from('businesses')
        .update({ google_place_id: loc.placeId })
        .eq('id', auth.businessId)
        .is('google_place_id', null);
    }

    await ensureZernioWebhook();

    // Queue a sender-number request for the admin team (numbers are bought
    // manually by an admin when a client lands — never auto-purchased).
    const { data: settings } = await supabase
      .from('review_settings')
      .select('sms_from_number')
      .eq('business_id', auth.businessId)
      .maybeSingle();
    if (!settings?.sms_from_number) {
      const { data: pending } = await supabase
        .from('review_number_requests')
        .select('id')
        .eq('business_id', auth.businessId)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();
      if (!pending) {
        await supabase.from('review_number_requests').insert({
          business_id: auth.businessId,
          note: 'Auto-created at GBP connect — assign a UK long code so SMS requests can send',
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      reviewUrl: loc?.reviewUrl ?? null,
      avgRating,
      totalReviews,
      locationName: (details as { title?: string }).title ?? loc?.name ?? null,
    }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
