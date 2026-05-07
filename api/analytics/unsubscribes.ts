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
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(50, parseInt(url.searchParams.get('pageSize') || '25'));
  const offset = (page - 1) * pageSize;
  const bid = auth.businessId;

  // Get email conversations for this business
  const { data: convos } = await supabase
    .from('conversations')
    .select('id, contact_id')
    .eq('business_id', bid)
    .eq('channel', 'email');

  const convoIds = (convos || []).map(c => c.id);
  if (convoIds.length === 0) {
    return new Response(JSON.stringify({ rows: [], total: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get contacts for name lookup
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, email')
    .eq('business_id', bid);
  const contactMap = new Map((contacts || []).map(c => [c.id, c]));

  // Find messages with auto_unsubscribed metadata
  const { data: msgs, count } = await supabase
    .from('messages')
    .select('id, conversation_id, created_at, metadata', { count: 'exact' })
    .in('conversation_id', convoIds)
    .contains('metadata', { auto_unsubscribed: true })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  // Also find spam messages that had NO unsubscribe link (failed to unsubscribe)
  const { data: spamMsgs, count: spamCount } = await supabase
    .from('messages')
    .select('id, conversation_id, created_at, metadata', { count: 'exact' })
    .in('conversation_id', convoIds)
    .contains('metadata', { is_spam: true })
    .not('metadata', 'cs', '{"auto_unsubscribed":true}')
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  const rows = (msgs || []).map(m => {
    const convo = (convos || []).find(c => c.id === m.conversation_id);
    const contact = convo?.contact_id ? contactMap.get(convo.contact_id) : null;
    const meta = m.metadata as any;
    const results = meta?.unsubscribe_results || [];
    const allOk = results.length > 0 && results.every((r: any) => r.status >= 200 && r.status < 400);

    return {
      id: m.id,
      date: m.created_at,
      sender: meta?.sender_email || contact?.email || 'Unknown',
      senderName: meta?.sender_name || contact?.name || '',
      subject: meta?.subject || '',
      status: allOk ? 'unsubscribed' : results.length > 0 ? 'failed' : 'attempted',
      reason: allOk
        ? 'Successfully unsubscribed'
        : results.length > 0
          ? results.map((r: any) => `HTTP ${r.status}`).join(', ')
          : 'Unsubscribe attempted',
      results,
    };
  });

  const spamRows = (spamMsgs || []).map(m => {
    const convo = (convos || []).find(c => c.id === m.conversation_id);
    const contact = convo?.contact_id ? contactMap.get(convo.contact_id) : null;
    const meta = m.metadata as any;

    return {
      id: m.id,
      date: m.created_at,
      sender: meta?.sender_email || contact?.email || 'Unknown',
      senderName: meta?.sender_name || contact?.name || '',
      subject: meta?.subject || '',
      status: 'no_link' as const,
      reason: 'No unsubscribe link found in email',
      results: [],
    };
  });

  const allRows = [...rows, ...spamRows].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return new Response(JSON.stringify({
    rows: allRows.slice(0, pageSize),
    total: (count || 0) + (spamCount || 0),
    page,
    pageSize,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
