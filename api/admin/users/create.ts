import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

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

  const { email, password, name, business_name, billing_active, is_admin, voice_enabled } = await req.json() as {
    email: string
    password: string
    name?: string
    business_name?: string
    billing_active?: boolean
    is_admin?: boolean
    voice_enabled?: boolean
  }

  if (!email || !password) {
    return Response.json({ error: 'Email and password required' }, { status: 400 })
  }

  const { data: newUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name || '' },
  })

  if (authErr) {
    return Response.json({ error: authErr.message }, { status: 400 })
  }

  const bName = business_name || `${name || email}'s Business`
  const isBillingActive = billing_active === true
  const { data: business, error: bizErr } = await supabaseAdmin
    .from('businesses')
    .insert({
      name: bName,
      owner_id: newUser.user.id,
      billing_active: isBillingActive,
      currency: 'GBP',
    })
    .select('id')
    .single()

  if (bizErr) {
    return Response.json({ error: bizErr.message }, { status: 500 })
  }

  await supabaseAdmin.from('team_members').insert({
    user_id: newUser.user.id,
    business_id: business.id,
    email,
    name: name || null,
    role: 'owner',
  })

  // Create an initial billing period so simulated usage is tracked
  const today = new Date().toISOString().split('T')[0]
  const periodEnd = new Date()
  periodEnd.setDate(periodEnd.getDate() + 30)

  await supabaseAdmin.from('billing_periods').insert({
    business_id: business.id,
    period_start: today,
    period_end: periodEnd.toISOString().split('T')[0],
    currency: 'GBP',
    cap_amount: 189,
  })

  // Grant super-admin access (email present in admin_users = super-admin)
  const makeAdmin = is_admin === true
  if (makeAdmin) {
    await supabaseAdmin
      .from('admin_users')
      .upsert({ email, name: name || null }, { onConflict: 'email' })
  }

  // Provision voice/calls for this business (else it stays WhatsApp-only)
  const enableVoice = voice_enabled === true
  if (enableVoice) {
    await supabaseAdmin
      .from('feature_flags')
      .upsert(
        { business_id: business.id, flag_key: 'voice_ai', enabled: true },
        { onConflict: 'business_id,flag_key' },
      )
  }

  await supabaseAdmin.from('admin_audit_log').insert({
    admin_email: admin.email,
    action: isBillingActive ? 'create_paid_user' : 'create_free_user',
    target_type: 'user',
    target_id: newUser.user.id,
    metadata: { email, business_name: bName, is_admin: makeAdmin, voice_enabled: enableVoice },
  })

  return Response.json({
    success: true,
    user_id: newUser.user.id,
    business_id: business.id,
  })
}
