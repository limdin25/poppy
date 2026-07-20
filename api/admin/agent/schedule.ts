import { requireAdmin } from '../../lib/require-admin.js'
import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' }

// Visibility panel: the live heartbeat + every upcoming scheduled wake-up (timer),
// so Hugo can always see exactly what is scheduled and that the agent is alive.
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req)
  if (auth instanceof Response) return auth

  const { data: heartbeat } = await supabaseAdmin.from('agent_heartbeat')
    .select('last_beat_at, last_status, due_count, note').eq('id', 'singleton').maybeSingle()

  const { data: wakeups } = await supabaseAdmin.from('agent_wakeups')
    .select('id, task_id, run_after, reason, status')
    .eq('owner_email', auth.email)
    .eq('status', 'pending')
    .order('run_after', { ascending: true })
    .limit(50)

  return new Response(JSON.stringify({ heartbeat: heartbeat || null, wakeups: wakeups || [] }), { status: 200 })
}
