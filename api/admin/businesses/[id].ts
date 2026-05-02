import { supabaseAdmin } from '../../../src/integrations/supabase/client'

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

  const url = new URL(req.url)
  const id = url.pathname.split('/').pop()

  if (req.method === 'GET') {
    const { data: business, error } = await supabaseAdmin
      .from('businesses')
      .select('*, team_members(*), services(*), faqs(*), channels(*), calls(id, status, created_at)')
      .eq('id', id)
      .single()

    if (error) return Response.json({ error: error.message }, { status: 404 })
    return Response.json(business)
  }

  if (req.method === 'PATCH') {
    const body = await req.json()
    const { data, error } = await supabaseAdmin
      .from('businesses')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })

    await supabaseAdmin.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'edit_business',
      target_type: 'business',
      target_id: id,
      metadata: { fields: Object.keys(body) },
    })

    return Response.json(data)
  }

  return new Response('Method not allowed', { status: 405 })
}
