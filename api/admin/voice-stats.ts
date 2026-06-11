import { supabaseAdmin } from '../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

/**
 * Voice A/B scoreboard for the BRRR qualifier: per-voice call counts and
 * outcome rates so Hugo can see whether British "Elsie" or French "Amélie"
 * gets further with estate agents.
 */
export default async function handler(req: Request) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
  if (!user?.email) return new Response('Unauthorized', { status: 401 })

  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single()
  if (!admin) return new Response('Forbidden', { status: 403 })

  const { data: rows, error } = await supabaseAdmin
    .from('brrr_property_calls')
    .select('voice, status, qualification, cost_usd')
    .not('voice', 'is', null)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const stats: Record<string, {
    voice: string
    dials: number
    completed: number
    qualified: number
    callback: number
    no_answer: number
    total_cost: number
  }> = {}

  for (const r of rows || []) {
    const v = r.voice as string
    if (!stats[v]) stats[v] = { voice: v, dials: 0, completed: 0, qualified: 0, callback: 0, no_answer: 0, total_cost: 0 }
    const s = stats[v]
    s.dials++
    if (r.status === 'completed') s.completed++
    if (r.status === 'no_answer') s.no_answer++
    const outcome = ((r.qualification || {}) as Record<string, unknown>).outcome
    if (outcome === 'qualified') s.qualified++
    if (outcome === 'callback') s.callback++
    if (typeof r.cost_usd === 'number') s.total_cost += r.cost_usd
  }

  return Response.json(Object.values(stats))
}
