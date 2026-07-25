// Upload a custom background or overlay-element image for the template editor.
// Returns a public URL the editor stores on the template (background_url or an
// overlay element). Mirrors api/reviews/image-template.ts's upload approach.

import { requireAuth } from '../../lib/auth.js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const kind = String(form.get('kind') ?? 'background'); // background | element
    if (!file) return new Response(JSON.stringify({ error: 'file is required' }), { status: 400 });
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      return new Response(JSON.stringify({ error: 'Image must be PNG, JPEG or WebP' }), { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Image must be under 8MB' }), { status: 400 });
    }

    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `social/${kind === 'element' ? 'elements' : 'backgrounds'}/${auth.businessId}/${Date.now()}.${ext}`;
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

    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/review-assets/${path}`;
    return new Response(JSON.stringify({ url }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
