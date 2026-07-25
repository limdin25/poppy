// Publish one queued social post NOW (client's "Publish" button). Node runtime
// (renders the image with sharp). Impersonation-aware so an admin viewing a
// client can publish on their behalf. Delegates to the shared publish helper.

import { createClient } from '@supabase/supabase-js';
import { publishQueueItem, type QueueRow } from '../../lib/social-publish.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function resolveAuth(headers: Record<string, string | string[] | undefined>): Promise<{ businessId: string } | null> {
  const raw = headers['authorization'];
  const authHeader = Array.isArray(raw) ? raw[0] : raw;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7));
  if (!user) return null;

  const impRaw = headers['x-impersonate-business'];
  const impersonateId = Array.isArray(impRaw) ? impRaw[0] : impRaw;
  if (impersonateId) {
    const { data: admin } = await supabase.from('admin_users').select('email').eq('email', user.email ?? '').maybeSingle();
    if (!admin) return null;
    const { data: target } = await supabase.from('businesses').select('id').eq('id', impersonateId).maybeSingle();
    return target ? { businessId: impersonateId } : null;
  }

  const { data: member } = await supabase.from('team_members').select('business_id').eq('user_id', user.id).limit(1).single();
  return member ? { businessId: member.business_id } : null;
}

export default async function handler(
  req: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): Promise<void> {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await resolveAuth(req.headers);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as { id?: string };
    if (!body.id) { res.status(400).json({ error: 'id required' }); return; }

    const { data: row } = await supabase
      .from('social_post_queue')
      .select('id, business_id, review_id, template_id, post_type, caption')
      .eq('id', body.id)
      .eq('business_id', auth.businessId)
      .maybeSingle();
    if (!row) { res.status(404).json({ error: 'Queue item not found' }); return; }

    const result = await publishQueueItem(supabase, row as QueueRow);
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
