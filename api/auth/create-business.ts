import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { name, address, phone, website, googlePlaceId, industry } = await req.json() as {
      name?: string;
      address?: string;
      phone?: string;
      website?: string;
      googlePlaceId?: string;
      industry?: string;
    };

    if (!name) {
      return new Response(JSON.stringify({ error: 'name is required' }), { status: 400 });
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      + '-' + Date.now().toString(36);

    const { data, error } = await supabase.from('businesses').insert({
      owner_id: '00000000-0000-0000-0000-000000000000',
      name,
      slug,
      address: address || null,
      phone: phone || null,
      website: website || null,
      google_place_id: googlePlaceId || null,
      industry: industry || null,
    }).select('id').single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, businessId: data.id }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
