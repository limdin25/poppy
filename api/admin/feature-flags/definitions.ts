import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export default async function handler(req: Request) {
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

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('feature_flag_definitions')
      .select('*')
      .order('created_at')

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  if (req.method === 'POST') {
    const body = await req.json()
    const { data, error } = await supabaseAdmin
      .from('feature_flag_definitions')
      .insert(body)
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  return new Response('Method not allowed', { status: 405 })
}
