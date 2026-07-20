import { requireAdmin } from '../../lib/require-admin.js'
import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' }

// Owner sends a task (or a follow-up message to an existing task). Creates/updates
// the task, appends the message to the event log, and queues an immediate wakeup
// so the next heartbeat tick picks it up.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const auth = await requireAdmin(req)
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => ({}))) as { text?: string; task_id?: string }
  const text = (body.text || '').trim()
  if (!text) return new Response(JSON.stringify({ error: 'text required' }), { status: 400 })

  const nowIso = new Date().toISOString()
  let taskId = body.task_id

  if (taskId) {
    const { data: task } = await supabaseAdmin.from('agent_tasks').select('id, owner_email').eq('id', taskId).single()
    if (!task || task.owner_email !== auth.email) return new Response('Not found', { status: 404 })
    await supabaseAdmin.from('agent_tasks').update({ status: 'queued', updated_at: nowIso }).eq('id', taskId)
  } else {
    const title = text.split('\n')[0].slice(0, 80) || 'New task'
    const { data: task, error } = await supabaseAdmin.from('agent_tasks')
      .insert({ owner_email: auth.email, title, status: 'queued', channel: 'app' })
      .select('id').single()
    if (error || !task) return new Response(JSON.stringify({ error: error?.message || 'create failed' }), { status: 500 })
    taskId = task.id
  }

  await supabaseAdmin.from('agent_events').insert({ task_id: taskId, role: 'user', kind: 'message', content: text, summary: text.slice(0, 140) })
  await supabaseAdmin.from('agent_wakeups').insert({ task_id: taskId, owner_email: auth.email, run_after: nowIso, reason: 'new message from Hugo', status: 'pending' })

  return new Response(JSON.stringify({ ok: true, task_id: taskId }), { status: 200 })
}
