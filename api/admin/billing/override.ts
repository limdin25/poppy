import { supabaseAdmin } from '../../../src/integrations/supabase/client'

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

  const { businessId, plan } = await req.json() as { businessId: string; plan: string }

  const { error } = await supabaseAdmin
    .from('businesses')
    .update({ plan })
    .eq('id', businessId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('admin_audit_log').insert({
    admin_email: admin.email,
    action: 'override_plan',
    target_type: 'business',
    target_id: businessId,
    metadata: { new_plan: plan },
  })

  return Response.json({ success: true })
}
