// Read / rename the signed-in client's business (dashboard header inline edit).
// businesses has no client UPDATE policy, so writes go through this service-role
// route, scoped to the caller's own business (impersonation-aware via requireAuth).

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { REVIEW_PLANS } from '../lib/review-plans.js';

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
      .from('businesses')
      .select('id, name, address, google_place_id')
      .eq('id', auth.businessId)
      .maybeSingle();
    return new Response(JSON.stringify({ business: data ?? null }), { status: 200 });
  }

  if (req.method !== 'PATCH') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const { name, address, plan } = (await req.json()) as { name?: string; address?: string; plan?: string };
    const patch: Record<string, string> = {};
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) return new Response(JSON.stringify({ error: 'Business name cannot be empty' }), { status: 400 });
      patch.name = trimmed.slice(0, 120);
    }
    if (typeof address === 'string') patch.address = address.trim().slice(0, 200);
    if (typeof plan === 'string') {
      if (!REVIEW_PLANS.some((p) => p.key === plan)) return new Response(JSON.stringify({ error: 'Unknown plan' }), { status: 400 });
      patch.plan = plan;
    }
    if (!Object.keys(patch).length) return new Response(JSON.stringify({ error: 'Nothing to update' }), { status: 400 });

    const { data, error } = await supabase
      .from('businesses')
      .update(patch)
      .eq('id', auth.businessId)
      .select('id, name, address, google_place_id')
      .single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ business: data }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
