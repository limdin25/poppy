import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return new Response('Unauthorized', { status: 401 });

  try {
    const { channelId } = await req.json() as { channelId?: string };
    if (!channelId) {
      return new Response(JSON.stringify({ error: 'channelId required' }), { status: 400 });
    }

    const { data: channel } = await supabase
      .from('channels')
      .select('id, business_id, unipile_account_id, type')
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

    if (channel.unipile_account_id) {
      try {
        await fetch(`https://${UNIPILE_DSN}/api/v1/accounts/${channel.unipile_account_id}`, {
          method: 'DELETE',
          headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' },
        });
      } catch {
        // Unipile deletion is best-effort
      }
    }

    await supabase.from('channels').delete().eq('id', channelId);

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
