import { supabaseAdmin } from '../../../../src/integrations/supabase/client.js'

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

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
  const segments = url.pathname.split('/')
  const id = segments[segments.length - 2]

  const { action } = await req.json() as { action: 'suspend' | 'activate' }
  const newStatus = action === 'suspend' ? 'suspended' : 'active'

  const { error } = await supabaseAdmin
    .from('businesses')
    .update({ status: newStatus })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('admin_audit_log').insert({
    admin_email: admin.email,
    action: `${action}_business`,
    target_type: 'business',
    target_id: id,
  })

  return Response.json({ status: newStatus })
}
