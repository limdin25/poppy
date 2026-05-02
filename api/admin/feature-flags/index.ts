import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

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
      .from('feature_flags')
      .select('*, businesses(name)')
      .order('business_id')

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  if (req.method === 'PUT') {
    const { businessId, flagKey, enabled } = await req.json() as {
      businessId: string
      flagKey: string
      enabled: boolean
    }

    const { error } = await supabaseAdmin
      .from('feature_flags')
      .upsert(
        { business_id: businessId, flag_key: flagKey, enabled, updated_at: new Date().toISOString() },
        { onConflict: 'business_id,flag_key' }
      )

    if (error) return Response.json({ error: error.message }, { status: 500 })

    await supabaseAdmin.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'toggle_flag',
      target_type: 'feature_flag',
      metadata: { business_id: businessId, flag_key: flagKey, enabled },
    })

    return Response.json({ success: true })
  }

  return new Response('Method not allowed', { status: 405 })
}
