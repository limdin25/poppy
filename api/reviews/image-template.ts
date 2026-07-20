// Upload / fetch the client's personalized-image template (their team photo).
// The engine renders "Hi {FirstName}!" onto it at send time.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const DEFAULT_URL = () => `${process.env.SUPABASE_URL}/storage/v1/object/public/review-assets/defaults/team-template.png`;

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('review_image_templates')
      .select('*')
      .eq('business_id', auth.businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return new Response(JSON.stringify({
      template: data ?? null,
      defaultUrl: DEFAULT_URL(),
    }), { status: 200 });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return new Response(JSON.stringify({ error: 'file is required' }), { status: 400 });
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      return new Response(JSON.stringify({ error: 'Image must be PNG, JPEG or WebP' }), { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Image must be under 8MB' }), { status: 400 });
    }

    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `templates/${auth.businessId}/${Date.now()}.${ext}`;
    const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/review-assets/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': file.type,
        'x-upsert': 'true',
      },
      body: await file.arrayBuffer(),
    });
    if (!up.ok) return new Response(JSON.stringify({ error: `Upload failed: ${await up.text()}` }), { status: 500 });

    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/review-assets/${path}`;

    const nameX = parseFloat(String(form.get('name_x') ?? '0.5'));
    const nameY = parseFloat(String(form.get('name_y') ?? '0.82'));
    const fontSize = parseInt(String(form.get('font_size') ?? '72'), 10);
    const fontColor = String(form.get('font_color') ?? '#ffffff');
    const greeting = String(form.get('greeting_prefix') ?? 'Hi');

    await supabase
      .from('review_image_templates')
      .update({ is_active: false })
      .eq('business_id', auth.businessId)
      .eq('is_active', true);

    const { data, error } = await supabase
      .from('review_image_templates')
      .insert({
        business_id: auth.businessId,
        storage_path: path,
        public_url: publicUrl,
        name_x: isFinite(nameX) ? Math.min(1, Math.max(0, nameX)) : 0.5,
        name_y: isFinite(nameY) ? Math.min(1, Math.max(0, nameY)) : 0.82,
        font_size: isFinite(fontSize) ? Math.min(200, Math.max(24, fontSize)) : 72,
        font_color: /^#[0-9a-fA-F]{6}$/.test(fontColor) ? fontColor : '#ffffff',
        greeting_prefix: greeting.slice(0, 12) || 'Hi',
        is_active: true,
      })
      .select('*')
      .single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    return new Response(JSON.stringify({ template: data }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
