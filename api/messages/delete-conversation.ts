import { requireAuth } from '../lib/auth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const { conversationId } = await req.json() as { conversationId?: string };
  if (!conversationId) {
    return new Response(JSON.stringify({ error: 'conversationId required' }), { status: 400 });
  }

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, business_id')
    .eq('id', conversationId)
    .eq('business_id', auth.businessId)
    .single();

  if (!conv) {
    return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
  }

  const { data: appts } = await supabase
    .from('appointments')
    .select('id')
    .eq('conversation_id', conversationId);

  const apptIds = (appts || []).map((a: { id: string }) => a.id);

  if (apptIds.length > 0) {
    await supabase.from('appointment_notifications').delete().in('appointment_id', apptIds);
  }

  await supabase.from('follow_up_queue').delete().eq('conversation_id', conversationId);
  await supabase.from('calls').delete().eq('conversation_id', conversationId);
  await supabase.from('ai_takeover_queue').delete().eq('conversation_id', conversationId);
  await supabase.from('appointments').delete().eq('conversation_id', conversationId);
  await supabase.from('messages').delete().eq('conversation_id', conversationId);
  await supabase.from('conversations').delete().eq('id', conversationId);

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
