import { requireAdmin } from '../../lib/require-admin.js'
import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' }

// List the owner's tasks for the cockpit left rail.
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req)
  if (auth instanceof Response) return auth

  const { data } = await supabaseAdmin.from('agent_tasks')
    .select('id, title, status, created_at, updated_at')
    .eq('owner_email', auth.email)
    .order('updated_at', { ascending: false })
    .limit(100)

  return new Response(JSON.stringify({ tasks: data || [] }), { status: 200 })
}
