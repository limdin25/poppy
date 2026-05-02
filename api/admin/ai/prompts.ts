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
      .from('businesses')
      .select('id, name, ai_system_prompt, greeting, tone')
      .order('name')

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  if (req.method === 'PUT') {
    const { businessId, prompt } = await req.json() as { businessId: string; prompt: string }

    const { data: current } = await supabaseAdmin
      .from('system_prompt_versions')
      .select('version')
      .eq('business_id', businessId)
      .order('version', { ascending: false })
      .limit(1)

    const nextVersion = (current?.[0]?.version || 0) + 1

    await supabaseAdmin.from('system_prompt_versions').insert({
      business_id: businessId,
      prompt_text: prompt,
      version: nextVersion,
      edited_by: admin.email,
    })

    const { error } = await supabaseAdmin
      .from('businesses')
      .update({ ai_system_prompt: prompt })
      .eq('id', businessId)

    if (error) return Response.json({ error: error.message }, { status: 500 })

    await supabaseAdmin.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'edit_prompt',
      target_type: 'business',
      target_id: businessId,
      metadata: { version: nextVersion },
    })

    return Response.json({ success: true, version: nextVersion })
  }

  return new Response('Method not allowed', { status: 405 })
}
