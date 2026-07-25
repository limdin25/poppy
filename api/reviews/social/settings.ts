// GET / PUT the per-business social settings: caption source (comment | reply |
// custom + custom text), the master auto-post switch, the 7-day story/feed
// schedule, and the active feed/story templates.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const EDITABLE = [
  'caption_mode', 'custom_caption', 'auto_enabled', 'schedule',
  'active_feed_template_id', 'active_story_template_id',
] as const;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

async function ensureRow(businessId: string) {
  const { data } = await supabase.from('social_settings').select('*').eq('business_id', businessId).maybeSingle();
  if (data) return data;
  const { data: created } = await supabase
    .from('social_settings').insert({ business_id: businessId }).select('*').single();
  return created;
}

/** Normalise an incoming schedule to exactly 7 day keys with boolean story/feed. */
function cleanSchedule(input: unknown): Record<string, { story: boolean; feed: boolean }> | null {
  if (!input || typeof input !== 'object') return null;
  const src = input as Record<string, { story?: unknown; feed?: unknown }>;
  const out: Record<string, { story: boolean; feed: boolean }> = {};
  for (const d of DAYS) {
    out[d] = { story: src[d]?.story === true, feed: src[d]?.feed === true };
  }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  if (req.method === 'GET') {
    const row = await ensureRow(auth.businessId);
    return new Response(JSON.stringify({ settings: row }), { status: 200 });
  }

  if (req.method !== 'PUT') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    await ensureRow(auth.businessId);

    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (!(key in body)) continue;
      if (key === 'caption_mode') {
        if (!['comment', 'reply', 'custom'].includes(String(body[key]))) {
          return new Response(JSON.stringify({ error: 'invalid caption_mode' }), { status: 400 });
        }
        patch[key] = body[key];
      } else if (key === 'schedule') {
        const s = cleanSchedule(body[key]);
        if (!s) return new Response(JSON.stringify({ error: 'invalid schedule' }), { status: 400 });
        patch[key] = s;
      } else {
        patch[key] = body[key];
      }
    }
    if (!Object.keys(patch).length) return new Response(JSON.stringify({ error: 'Nothing to update' }), { status: 400 });

    // A referenced template must belong to this business AND match the slot type.
    for (const k of ['active_feed_template_id', 'active_story_template_id'] as const) {
      if (patch[k]) {
        const wantType = k === 'active_story_template_id' ? 'story' : 'feed';
        const { data: tpl } = await supabase
          .from('social_templates').select('id, type').eq('id', patch[k]).eq('business_id', auth.businessId).maybeSingle();
        if (!tpl) return new Response(JSON.stringify({ error: 'template not found' }), { status: 400 });
        if (tpl.type !== wantType) return new Response(JSON.stringify({ error: `That template is a ${tpl.type} template, not ${wantType}` }), { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from('social_settings').update(patch).eq('business_id', auth.businessId).select('*').single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ settings: data }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
