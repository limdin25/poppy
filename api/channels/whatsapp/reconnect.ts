import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth.js';
import { generateReconnectLink } from '../../lib/channel-alerts.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * Generate a hosted RECONNECT link for a disconnected messaging channel.
 *
 * Unlike /connect (which creates a brand-new Unipile account and orphans the
 * old one — the duplicate-account trap), this uses Unipile's `type: "reconnect"`
 * against the channel's existing `unipile_account_id`, so the same number is
 * re-linked and no duplicate account is created.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as { channelId?: string };

    let query = supabase
      .from('channels')
      .select('id, unipile_account_id, type, status')
      .eq('business_id', auth.businessId)
      .in('type', ['whatsapp', 'instagram'])
      .not('unipile_account_id', 'is', null)
      .neq('status', 'connected')
      .order('disconnected_at', { ascending: false, nullsFirst: false })
      .limit(1);

    if (body.channelId) query = query.eq('id', body.channelId);

    const { data: ch } = await query.maybeSingle();

    if (!ch?.unipile_account_id) {
      return new Response(
        JSON.stringify({ error: 'No disconnected channel found to reconnect.' }),
        { status: 404 },
      );
    }

    const url = await generateReconnectLink(ch.unipile_account_id);
    if (!url) {
      return new Response(JSON.stringify({ error: 'Could not create a reconnect link. Please try again.' }), { status: 502 });
    }

    return new Response(JSON.stringify({ url }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
