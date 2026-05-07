import { supabaseAdmin } from '../../../src/integrations/supabase/client.js';

async function requireAdmin(req: Request): Promise<{ email: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });
  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt);
  if (!user?.email) return new Response('Unauthorized', { status: 401 });
  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single();
  if (!admin) return new Response('Forbidden', { status: 403 });
  return { email: admin.email };
}

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString();
  const to = url.searchParams.get('to') || new Date().toISOString();
  const businessId = url.searchParams.get('business_id') || null;

  const [businesses, calls, conversations, messages, contacts] = await Promise.all([
    supabaseAdmin.from('businesses').select('id, name', { count: 'exact' }).then(r => ({
      count: r.count || 0,
      list: r.data || [],
    })),

    (() => {
      let q = supabaseAdmin.from('calls').select('status, duration_seconds, business_id').gte('created_at', from).lte('created_at', to);
      if (businessId) q = q.eq('business_id', businessId);
      return q.then(r => {
        const rows = r.data || [];
        return {
          total: rows.length,
          answered: rows.filter(c => c.status === 'completed').length,
          missed: rows.filter(c => c.status === 'missed').length,
          totalDuration: rows.reduce((s, c) => s + (c.duration_seconds || 0), 0),
        };
      });
    })(),

    (() => {
      let q = supabaseAdmin.from('conversations').select('id, channel', { count: 'exact' }).gte('created_at', from).lte('created_at', to);
      if (businessId) q = q.eq('business_id', businessId);
      return q.then(r => ({
        total: r.count || 0,
        byChannel: countBy(r.data || [], 'channel'),
      }));
    })(),

    (() => {
      let q = supabaseAdmin.from('messages').select('direction, sender', { count: 'exact' }).gte('created_at', from).lte('created_at', to);
      return q.then(r => {
        const rows = r.data || [];
        return {
          total: r.count || 0,
          inbound: rows.filter(m => m.direction === 'inbound').length,
          outbound: rows.filter(m => m.direction === 'outbound').length,
          bySender: countBy(rows, 'sender'),
        };
      });
    })(),

    (() => {
      let q = supabaseAdmin.from('contacts').select('*', { count: 'exact', head: true }).gte('created_at', from).lte('created_at', to);
      if (businessId) q = q.eq('business_id', businessId);
      return q.then(r => ({ newContacts: r.count || 0 }));
    })(),
  ]);

  return new Response(JSON.stringify({
    businesses: { total: businesses.count, list: businesses.list.map(b => ({ id: b.id, name: b.name })) },
    calls,
    conversations,
    messages,
    contacts,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function countBy(arr: any[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of arr) {
    const v = item[key] || 'unknown';
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}
