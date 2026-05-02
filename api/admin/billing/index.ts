import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

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

  const { data: businesses } = await supabaseAdmin
    .from('businesses')
    .select('id, name, plan, status, stripe_customer_id, stripe_subscription_id')

  const planPrices: Record<string, number> = { starter: 49, pro: 99, business: 199 }
  let mrr = 0
  for (const b of businesses || []) {
    if (b.status === 'active' && b.plan && planPrices[b.plan]) {
      mrr += planPrices[b.plan]
    }
  }

  return Response.json({
    mrr,
    arr: mrr * 12,
    businesses: businesses || [],
  })
}
