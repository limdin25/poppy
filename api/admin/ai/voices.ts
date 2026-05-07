import { supabaseAdmin } from '../../../src/integrations/supabase/client.js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

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

  const { data: businesses, error: bizErr } = await supabaseAdmin
    .from('businesses')
    .select('id, name');

  if (bizErr) return Response.json({ error: bizErr.message }, { status: 500 });

  const { data: voiceChannels } = await supabaseAdmin
    .from('channels')
    .select('business_id, config')
    .eq('type', 'voice');

  const voiceMap = new Map(
    (voiceChannels || []).map(c => [c.business_id, c.config])
  );

  const result = (businesses || []).map(b => ({
    id: b.id,
    name: b.name,
    voiceConfig: voiceMap.get(b.id) || null,
  }));

  return Response.json(result);
}
