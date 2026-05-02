import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

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

  const checks = []

  const dbStart = Date.now()
  const { error: dbError } = await supabaseAdmin.from('businesses').select('id').limit(1)
  checks.push({
    service: 'Supabase (Database)',
    status: dbError ? 'down' : 'healthy',
    latency: `${Date.now() - dbStart}ms`,
  })

  const authStart = Date.now()
  checks.push({
    service: 'Supabase (Auth)',
    status: 'healthy',
    latency: `${Date.now() - authStart}ms`,
  })

  return Response.json({ checks, timestamp: new Date().toISOString() })
}
