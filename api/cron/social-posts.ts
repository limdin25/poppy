// Auto-post cron (every 5 min, Node runtime — renders images with sharp).
// For each business with auto-posting ON: for each post type enabled in today's
// schedule, publish at most one post per day. Prefers a manually-queued review;
// otherwise auto-enqueues the next eligible 5-star review. Publishing goes to
// every connected FB/IG account via the shared publish helper.

import { createClient } from '@supabase/supabase-js';
import { enabledTypesToday, localDateKey, MIN_POST_TEXT, type PostType } from '../lib/social.js';
import { publishQueueItem, type QueueRow } from '../lib/social-publish.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MAX_PUBLISHES = 8;          // per run — each render+post is ~1-2s
const FAILED_RETRY_HOURS = 3;     // re-attempt a failed row after this cooldown
const STALE_PUBLISHING_MIN = 15;  // reclaim rows stuck 'publishing' (crash/timeout)

/** Pick the next publishable row: a queued one, or a failed one past its cooldown. */
async function pickQueued(businessId: string, type: PostType): Promise<QueueRow | null> {
  const retryCutoff = new Date(Date.now() - FAILED_RETRY_HOURS * 3600_000).toISOString();
  const { data } = await supabase
    .from('social_post_queue')
    .select('id, business_id, review_id, template_id, post_type, caption')
    .eq('business_id', businessId)
    .eq('post_type', type)
    .or(`status.eq.queued,and(status.eq.failed,updated_at.lt.${retryCutoff})`)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as QueueRow) ?? null;
}

/** Enqueue the next eligible 5-star review (with enough text) not already used. */
async function autoEnqueue(businessId: string, type: PostType): Promise<QueueRow | null> {
  const { data: existing } = await supabase
    .from('social_post_queue').select('review_id').eq('business_id', businessId);
  const used = new Set((existing ?? []).map((r) => r.review_id));

  const { data: candidates } = await supabase
    .from('gbp_reviews')
    .select('id, comment')
    .eq('business_id', businessId)
    .eq('rating', 5)
    .order('review_created_at', { ascending: false })
    .limit(50);

  const pick = (candidates ?? []).find((c) => (c.comment?.length ?? 0) >= MIN_POST_TEXT && !used.has(c.id));
  if (!pick) return null;

  const { data: ins } = await supabase
    .from('social_post_queue')
    .insert({ business_id: businessId, review_id: pick.id, post_type: type, status: 'queued' })
    .select('id, business_id, review_id, template_id, post_type, caption')
    .single();
  return (ins as QueueRow) ?? null;
}

export default async function handler(
  req: { method?: string; headers: Record<string, string | string[] | undefined> },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): Promise<void> {
  const raw = req.headers['authorization'];
  const auth = Array.isArray(raw) ? raw[0] : raw;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const now = new Date();
  const today = localDateKey(now);

  // Reclaim rows stuck 'publishing' (a prior lambda crashed/timed out mid-post)
  // so they surface as 'failed' and become eligible for the retry cooldown.
  const staleCutoff = new Date(now.getTime() - STALE_PUBLISHING_MIN * 60_000).toISOString();
  await supabase.from('social_post_queue')
    .update({ status: 'failed', error: 'Timed out while publishing — will retry' })
    .eq('status', 'publishing')
    .lt('updated_at', staleCutoff);

  const [{ data: settingsRows }, { data: conns }] = await Promise.all([
    supabase.from('social_settings')
      .select('business_id, schedule')
      .eq('auto_enabled', true),
    supabase.from('social_connections')
      .select('business_id')
      .eq('status', 'connected'),
  ]);
  const connected = new Set((conns ?? []).map((c) => c.business_id));

  let published = 0;
  const summary: Array<{ business_id: string; type: string; ok: boolean; error?: string }> = [];

  for (const s of settingsRows ?? []) {
    if (published >= MAX_PUBLISHES) break;
    if (!connected.has(s.business_id)) continue;
    const types = enabledTypesToday(s.schedule as Record<string, { story: boolean; feed: boolean }>, now);
    if (!types.length) continue;

    for (const type of types) {
      if (published >= MAX_PUBLISHES) break;

      // One auto-post per type per day.
      const { data: last } = await supabase
        .from('social_post_queue')
        .select('published_at')
        .eq('business_id', s.business_id)
        .eq('post_type', type)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.published_at && localDateKey(new Date(last.published_at)) === today) continue;

      const row = (await pickQueued(s.business_id, type)) ?? (await autoEnqueue(s.business_id, type));
      if (!row) continue;

      try {
        const r = await publishQueueItem(supabase, row);
        summary.push({ business_id: s.business_id, type, ok: r.ok, error: r.error });
        if (r.ok) published++;
      } catch (err) {
        summary.push({ business_id: s.business_id, type, ok: false, error: (err as Error).message });
      }
    }
  }

  res.status(200).json({ ok: true, published, summary });
}
