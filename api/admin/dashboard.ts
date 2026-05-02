import { supabaseAdmin } from '../../src/integrations/supabase/client.js'

async function requireAdmin(req: Request): Promise<{ email: string } | Response> {
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
  return { email: admin.email }
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req)
  if (auth instanceof Response) return auth

  const [
    { count: businessCount },
    { count: callCount },
    { count: userCount },
  ] = await Promise.all([
    supabaseAdmin.from('businesses').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('calls').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('team_members').select('*', { count: 'exact', head: true }),
  ])

  return Response.json({
    businesses: businessCount || 0,
    calls: callCount || 0,
    users: userCount || 0,
  })
}
