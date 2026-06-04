import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * Soft connect/disconnect a channel without deleting it — used for the Voice
 * number, where "Remove" should stop routing but keep the Twilio number so it
 * can be reconnected for free. (WhatsApp/email use /api/channels/disconnect,
 * which fully removes the Unipile account + row.)
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const { channelId, status } = await req.json() as { channelId?: string; status?: string };
    if (!channelId || (status !== 'connected' && status !== 'disconnected')) {
      return new Response(JSON.stringify({ error: 'channelId and status (connected|disconnected) required' }), { status: 400 });
    }

    const { data: channel } = await supabase
      .from('channels')
      .select('id, business_id')
      .eq('id', channelId)
      .single();
    if (!channel) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), { status: 404 });
    }

    const { data: member } = await supabase
      .from('team_members')
      .select('id')
      .eq('business_id', channel.business_id)
      .eq('user_id', user.id)
      .single();
    if (!member) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 });
    }

    await supabase
      .from('channels')
      .update({
        status,
        ...(status === 'connected' ? { connected_at: new Date().toISOString() } : {}),
      })
      .eq('id', channelId);

    return new Response(JSON.stringify({ ok: true, status }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
