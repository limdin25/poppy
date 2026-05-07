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
  const from = url.searchParams.get('from') || new Date(Date.now() - 7 * 86400000).toISOString();
  const to = url.searchParams.get('to') || new Date().toISOString();
  const businessId = url.searchParams.get('business_id') || null;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(50, parseInt(url.searchParams.get('pageSize') || '25'));
  const offset = (page - 1) * pageSize;

  // Get conversations (with optional business filter)
  let convoQuery = supabaseAdmin
    .from('conversations')
    .select('id, channel, contact_id, business_id');
  if (businessId) convoQuery = convoQuery.eq('business_id', businessId);
  const { data: convos } = await convoQuery;
  const convoMap = new Map((convos || []).map(c => [c.id, c]));
  const convoIds = [...convoMap.keys()];

  if (convoIds.length === 0) {
    return new Response(JSON.stringify({ rows: [], total: 0, page, pageSize }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get businesses for name lookup
  const { data: businesses } = await supabaseAdmin
    .from('businesses')
    .select('id, name');
  const bizMap = new Map((businesses || []).map(b => [b.id, b.name]));

  // Get contacts
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, name, phone, email');
  const contactMap = new Map((contacts || []).map(c => [c.id, c]));

  const { data: msgs, count } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, direction, sender, content_type, body, status, created_at', { count: 'exact' })
    .in('conversation_id', convoIds)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  const rows = (msgs || []).map(m => {
    const convo = convoMap.get(m.conversation_id);
    const contact = convo?.contact_id ? contactMap.get(convo.contact_id) : null;
    return {
      id: m.id,
      date: m.created_at,
      businessName: convo?.business_id ? bizMap.get(convo.business_id) || 'Unknown' : 'Unknown',
      contactName: contact?.name || contact?.phone || contact?.email || 'Unknown',
      channel: convo?.channel || 'unknown',
      direction: m.direction,
      sender: m.sender,
      contentType: m.content_type,
      status: m.status,
      body: m.body ? m.body.slice(0, 120) : null,
    };
  });

  return new Response(JSON.stringify({
    rows,
    total: count || 0,
    page,
    pageSize,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
