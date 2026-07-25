// Social image templates CRUD. GET → list. POST (JSON) → create or update a
// template (background URL + card position/size + colors + caption length +
// overlay elements). DELETE ?id= → remove. Custom background/element image
// UPLOADS go through ./upload (returns a URL the editor stores here).

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth.js';
import { isAllowedBackground } from '../../lib/social.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp01 = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
};
const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d);

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('social_templates')
      .select('*')
      .eq('business_id', auth.businessId)
      .order('created_at', { ascending: false });
    return new Response(JSON.stringify({ templates: data ?? [] }), { status: 200 });
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
    const { error } = await supabase.from('social_templates').delete().eq('id', id).eq('business_id', auth.businessId);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const b = (await req.json()) as Record<string, unknown>;
    if (!b.background_url || typeof b.background_url !== 'string') {
      return new Response(JSON.stringify({ error: 'background_url is required' }), { status: 400 });
    }
    // Only preset specs or allowlisted image hosts — blocks server-side SSRF.
    if (!isAllowedBackground(b.background_url)) {
      return new Response(JSON.stringify({ error: 'Background must be a preset or an uploaded image' }), { status: 400 });
    }
    const elements = Array.isArray(b.overlay_elements) ? b.overlay_elements.slice(0, 8) : [];
    const row = {
      business_id: auth.businessId,
      name: (typeof b.name === 'string' && b.name.trim()) ? b.name.trim().slice(0, 80) : 'Untitled template',
      type: b.type === 'story' ? 'story' : 'feed',
      background_url: b.background_url,
      background_kind: b.background_kind === 'upload' ? 'upload' : 'preset',
      card_x: clamp01(b.card_x, 0.5),
      card_y: clamp01(b.card_y, 0.5),
      card_scale: Math.min(0.92, Math.max(0.4, Number(b.card_scale) || 0.8)),
      star_color: hex(b.star_color, '#ffd700'),
      text_color: hex(b.text_color, '#000000'),
      bg_color: hex(b.bg_color, '#ffffff'),
      border_color: hex(b.border_color, '#000000'),
      caption_length: ['short', 'medium', 'long'].includes(String(b.caption_length)) ? String(b.caption_length) : 'medium',
      overlay_elements: elements,
    };

    if (typeof b.id === 'string' && b.id) {
      // Update — scoped to this business.
      const { data, error } = await supabase
        .from('social_templates')
        .update(row)
        .eq('id', b.id)
        .eq('business_id', auth.businessId)
        .select('*')
        .maybeSingle();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      if (!data) return new Response(JSON.stringify({ error: 'template not found' }), { status: 404 });
      return new Response(JSON.stringify({ template: data }), { status: 200 });
    }

    const { data, error } = await supabase.from('social_templates').insert(row).select('*').single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ template: data }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
