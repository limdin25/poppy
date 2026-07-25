// Publish one social_post_queue row to the client's connected FB/IG accounts.
// Shared by the immediate-publish route and the auto-post cron so both behave
// identically. Node runtime (renders the image with sharp). Steps: resolve the
// template + caption → render the review card → post to every connected account
// via Zernio → write the outcome back onto the queue row.

import type { SupabaseClient } from '@supabase/supabase-js';
import { renderAndUploadSocialCard, type SocialTemplateConfig } from './render-social-image.js';
import { createSocialPost, type SocialPlatform } from '../../src/integrations/zernio/client.js';
import { captionFor, type CaptionMode } from './social.js';

export interface QueueRow {
  id: string;
  business_id: string;
  review_id: string;
  template_id: string | null;
  post_type: 'feed' | 'story';
  caption: string | null;
}

export interface PublishResult {
  ok: boolean;
  results: Array<{ platform: string; ok: boolean; zernioPostId?: string; url?: string; error?: string }>;
  error?: string;
}

export async function publishQueueItem(supabase: SupabaseClient, row: QueueRow): Promise<PublishResult> {
  // Mark in-flight so the cron never double-claims it.
  await supabase.from('social_post_queue').update({ status: 'publishing' }).eq('id', row.id);

  const fail = async (error: string): Promise<PublishResult> => {
    await supabase.from('social_post_queue').update({ status: 'failed', error }).eq('id', row.id);
    return { ok: false, results: [], error };
  };

  const [{ data: settings }, { data: review }, { data: accounts }] = await Promise.all([
    supabase.from('social_settings')
      .select('caption_mode, custom_caption, active_feed_template_id, active_story_template_id')
      .eq('business_id', row.business_id).maybeSingle(),
    supabase.from('gbp_reviews')
      .select('id, rating, comment, reviewer_name, reply_text, review_created_at')
      .eq('id', row.review_id).maybeSingle(),
    supabase.from('social_connections')
      .select('platform, zernio_account_id')
      .eq('business_id', row.business_id).eq('status', 'connected'),
  ]);

  if (!review) return fail('Review not found');
  if (!accounts?.length) return fail('No connected Facebook/Instagram account');

  // Template: the row's own, else the active template for its type.
  const activeId = row.post_type === 'story' ? settings?.active_story_template_id : settings?.active_feed_template_id;
  const templateId = row.template_id ?? activeId;
  if (!templateId) return fail('No template selected — create one and set it active first');
  const { data: template } = await supabase
    .from('social_templates').select('*').eq('id', templateId).eq('business_id', row.business_id).maybeSingle();
  if (!template) return fail('Template not found');

  const caption = (row.caption ?? '').trim()
    || captionFor((settings?.caption_mode as CaptionMode) ?? 'custom', settings?.custom_caption, review);
  if (!caption) return fail('Empty caption — the review has no text to post');

  // Render the card onto the background.
  let imageUrl: string;
  try {
    const cfg: SocialTemplateConfig = {
      background_url: template.background_url,
      type: row.post_type,
      card_x: template.card_x, card_y: template.card_y, card_scale: template.card_scale,
      star_color: template.star_color, text_color: template.text_color,
      bg_color: template.bg_color, border_color: template.border_color,
      caption_length: template.caption_length,
    };
    imageUrl = await renderAndUploadSocialCard({
      template: cfg,
      review: { reviewerName: review.reviewer_name ?? 'A happy customer', comment: review.comment },
      businessId: row.business_id,
      key: row.id,
    });
  } catch (err) {
    return fail(`Image render failed: ${(err as Error).message}`);
  }

  // Post to every connected account.
  const contentType = row.post_type === 'story' ? ('story' as const) : undefined;
  const results: PublishResult['results'] = [];
  for (const acct of accounts) {
    try {
      const out = await createSocialPost({
        platform: acct.platform as SocialPlatform,
        accountId: acct.zernio_account_id,
        content: caption,
        imageUrl,
        contentType,
        requestId: `${row.id}:${acct.platform}`,
      });
      results.push({ platform: acct.platform, ok: true, zernioPostId: out.id, url: out.platformPostUrl });
    } catch (err) {
      results.push({ platform: acct.platform, ok: false, error: (err as Error).message });
    }
  }

  const anyOk = results.some((r) => r.ok);
  await supabase.from('social_post_queue').update({
    status: anyOk ? 'published' : 'failed',
    image_url: imageUrl,
    caption,
    results,
    published_at: anyOk ? new Date().toISOString() : null,
    error: anyOk ? null : (results.map((r) => r.error).filter(Boolean).join('; ') || 'Publish failed'),
  }).eq('id', row.id);

  return { ok: anyOk, results, error: anyOk ? undefined : 'All platforms failed' };
}
