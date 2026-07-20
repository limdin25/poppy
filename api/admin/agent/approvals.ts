import { requireAdmin } from '../../lib/require-admin.js'
import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' }

// Pending approvals inbox: drafts the agent wants to send, awaiting Hugo's tap.
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req)
  if (auth instanceof Response) return auth

  const { data } = await supabaseAdmin.from('agent_approvals')
    .select('id, task_id, tool, args, summary, status, created_at')
    .eq('owner_email', auth.email)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50)

  return new Response(JSON.stringify({ approvals: data || [] }), { status: 200 })
}
