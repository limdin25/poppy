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
    const { data: settings } = await supabaseAdmin
      .from('platform_settings')
      .select('key, value')
      .in('key', ['ai_model', 'ai_provider', 'openai_api_key', 'grok_api_key'])

    const map: Record<string, string> = {}
    for (const s of settings || []) {
      map[s.key] = s.value
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY || ''
    const maskedAnthropic = anthropicKey
      ? anthropicKey.slice(0, 10) + '...' + anthropicKey.slice(-4)
      : 'Not set'

    return Response.json({
      ai_model: map.ai_model || 'claude-sonnet-4-6',
      ai_provider: map.ai_provider || 'anthropic',
      anthropic_key_display: maskedAnthropic,
      openai_api_key: map.openai_api_key || '',
      grok_api_key: map.grok_api_key || '',
    })
  }

  if (req.method === 'PUT') {
    const body = await req.json() as Record<string, string>
    const allowed = ['ai_model', 'ai_provider', 'openai_api_key', 'grok_api_key']

    for (const key of allowed) {
      if (body[key] !== undefined) {
        await supabaseAdmin
          .from('platform_settings')
          .upsert({ key, value: body[key], updated_at: new Date().toISOString(), updated_by: admin.email })
      }
    }

    await supabaseAdmin.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'update_ai_settings',
      target_type: 'platform',
      target_id: 'ai_settings',
      metadata: { keys_updated: Object.keys(body).filter(k => allowed.includes(k)) },
    })

    return Response.json({ success: true })
  }

  return new Response('Method not allowed', { status: 405 })
}
