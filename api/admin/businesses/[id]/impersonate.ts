import { supabaseAdmin } from '../../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

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

  const { data: business, error } = await supabaseAdmin
    .from('businesses')
    .select('id, name, slug')
    .eq('id', id)
    .single()

  if (error || !business) return Response.json({ error: 'Business not found' }, { status: 404 })

  await supabaseAdmin.from('admin_audit_log').insert({
    admin_email: admin.email,
    action: 'impersonate',
    target_type: 'business',
    target_id: id,
    metadata: { business_name: business.name },
  })

  return Response.json({
    businessId: business.id,
    businessName: business.name,
    businessSlug: business.slug,
  })
}
