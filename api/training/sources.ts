import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const agentIdParam = url.searchParams.get('agent_id');

    let query = supabase
      .from('knowledge_sources')
      .select('id, name, type, url, status, summary, created_at, updated_at')
      .eq('business_id', businessId);

    if (agentIdParam) {
      query = query.eq('agent_id', agentIdParam);
    }

    const { data: sources, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ sources: sources ?? [] }), { status: 200 });
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ error: 'id is required' }), { status: 400 });
    }

    const { error } = await supabase
      .from('knowledge_sources')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
