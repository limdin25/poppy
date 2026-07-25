// The social post queue. GET → queued/published items (with review data).
// POST → add a review to the queue, or bump its priority. DELETE ?id= → remove.
// Actual publishing happens in ./publish (immediate) or the auto-post cron.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('social_post_queue')
      .select('id, review_id, template_id, post_type, caption, image_url, status, scheduled_for, published_at, results, error, priority, created_at, review:gbp_reviews(id, rating, comment, reviewer_name, review_created_at)')
      .eq('business_id', auth.businessId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    return new Response(JSON.stringify({ queue: data ?? [] }), { status: 200 });
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
    const { error } = await supabase.from('social_post_queue').delete().eq('id', id).eq('business_id', auth.businessId);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const body = (await req.json()) as { action?: string; id?: string; review_id?: string; post_type?: string; template_id?: string };
    const action = body.action ?? 'add';

    if (action === 'bump') {
      if (!body.id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const { data: cur } = await supabase
        .from('social_post_queue').select('priority').eq('id', body.id).eq('business_id', auth.businessId).maybeSingle();
      if (!cur) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      const { error } = await supabase
        .from('social_post_queue').update({ priority: (cur.priority ?? 0) + 1 }).eq('id', body.id).eq('business_id', auth.businessId);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // add
    if (!body.review_id) return new Response(JSON.stringify({ error: 'review_id required' }), { status: 400 });
    const { data: review } = await supabase
      .from('gbp_reviews').select('id').eq('id', body.review_id).eq('business_id', auth.businessId).maybeSingle();
    if (!review) return new Response(JSON.stringify({ error: 'review not found' }), { status: 404 });

    const post_type = body.post_type === 'story' ? 'story' : 'feed';
    const { data, error } = await supabase
      .from('social_post_queue')
      .upsert({
        business_id: auth.businessId,
        review_id: body.review_id,
        template_id: body.template_id ?? null,
        post_type,
        status: 'queued',
      }, { onConflict: 'business_id,review_id' })
      .select('id')
      .single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true, id: data.id }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
