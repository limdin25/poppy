import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'PUT') return new Response('Method not allowed', { status: 405 })

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

  const { user_id, email, password } = await req.json() as {
    user_id: string
    email?: string
    password?: string
  }

  if (!user_id) {
    return Response.json({ error: 'user_id required' }, { status: 400 })
  }

  const updates: Record<string, string> = {}
  if (email) updates.email = email
  if (password) updates.password = password

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, updates)

  if (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }

  if (email) {
    await supabaseAdmin
      .from('team_members')
      .update({ email })
      .eq('user_id', user_id)
  }

  await supabaseAdmin.from('admin_audit_log').insert({
    admin_email: admin.email,
    action: 'update_user',
    target_type: 'user',
    target_id: user_id,
    metadata: { fields_updated: Object.keys(updates) },
  })

  return Response.json({ success: true })
}
