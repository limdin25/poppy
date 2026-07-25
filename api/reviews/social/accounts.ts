// Connected FB/IG accounts for the signed-in client's Connections card.
// GET → list. DELETE ?id= → disconnect (mark disconnected; posting stops).

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
      .from('social_connections')
      .select('id, platform, zernio_account_id, account_name, username, avatar_url, status, connected_at')
      .eq('business_id', auth.businessId)
      .eq('status', 'connected')
      .order('connected_at', { ascending: false });
    return new Response(JSON.stringify({ accounts: data ?? [] }), { status: 200 });
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
    const { error } = await supabase
      .from('social_connections')
      .update({ status: 'disconnected' })
      .eq('id', id)
      .eq('business_id', auth.businessId);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
