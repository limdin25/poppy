import { requireAdmin } from '../../lib/require-admin.js'
import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' }

// Full event log (conversation + step-by-step actions) for one task.
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req)
  if (auth instanceof Response) return auth

  const url = new URL(req.url)
  const taskId = url.searchParams.get('task_id')
  if (!taskId) return new Response(JSON.stringify({ error: 'task_id required' }), { status: 400 })

  const { data: task } = await supabaseAdmin.from('agent_tasks')
    .select('id, title, status, owner_email, last_error, created_at, updated_at')
    .eq('id', taskId).single()
  if (!task || task.owner_email !== auth.email) return new Response('Not found', { status: 404 })

  const { data: events } = await supabaseAdmin.from('agent_events')
    .select('id, role, kind, summary, content, created_at')
    .eq('task_id', taskId)
    .order('seq', { ascending: true })

  return new Response(JSON.stringify({ task, events: events || [] }), { status: 200 })
}
