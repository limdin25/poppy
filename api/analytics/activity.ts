import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const from = url.searchParams.get('from') || new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') || new Date().toISOString();
  const channel = url.searchParams.get('channel') || null;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25')));
  const sort = url.searchParams.get('sort') || 'date';
  const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
  const search = url.searchParams.get('search') || '';

  const bid = auth.businessId;
  const offset = (page - 1) * pageSize;

  // Get conversations for this business (with optional channel filter)
  let convoQuery = supabase
    .from('conversations')
    .select('id, channel, contact_id')
    .eq('business_id', bid);
  if (channel) convoQuery = convoQuery.eq('channel', channel);
  const { data: convos } = await convoQuery;
  const convoMap = new Map((convos || []).map(c => [c.id, c]));
  const convoIds = [...convoMap.keys()];

  if (convoIds.length === 0) {
    return new Response(JSON.stringify({ rows: [], total: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get contacts for name lookup
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, phone, email')
    .eq('business_id', bid);
  const contactMap = new Map((contacts || []).map(c => [c.id, c]));

  // Build messages query
  const sortCol = sort === 'date' ? 'created_at' : 'created_at';
  const ascending = dir === 'asc';

  let msgQuery = supabase
    .from('messages')
    .select('id, conversation_id, direction, sender, content_type, body, status, created_at, metadata', { count: 'exact' })
    .in('conversation_id', convoIds)
    .gte('created_at', from)
    .lte('created_at', to)
    .order(sortCol, { ascending })
    .range(offset, offset + pageSize - 1);

  const { data: msgs, count } = await msgQuery;

  const rows = (msgs || []).map(m => {
    const convo = convoMap.get(m.conversation_id);
    const contact = convo?.contact_id ? contactMap.get(convo.contact_id) : null;
    const contactName = contact?.name || contact?.phone || contact?.email || 'Unknown';
    return {
      id: m.id,
      date: m.created_at,
      contactName,
      channel: convo?.channel || 'unknown',
      direction: m.direction,
      sender: m.sender,
      contentType: m.content_type,
      status: m.status,
      body: m.body ? m.body.slice(0, 120) : null,
    };
  });

  // Client-side search filter (for contact name)
  const filtered = search
    ? rows.filter(r => r.contactName.toLowerCase().includes(search.toLowerCase()) || (r.body || '').toLowerCase().includes(search.toLowerCase()))
    : rows;

  return new Response(JSON.stringify({
    rows: filtered,
    total: count || 0,
    page,
    pageSize,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
