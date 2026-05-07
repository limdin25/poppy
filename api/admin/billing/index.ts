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

  const [businessesRes, periodsRes] = await Promise.all([
    supabaseAdmin
      .from('businesses')
      .select('id, name, currency, billing_active, activation_credit_paid, stripe_customer_id'),
    supabaseAdmin
      .from('billing_periods')
      .select('business_id, booking_count, total_amount, cap_reached, status, currency, paid_at')
      .eq('status', 'active'),
  ])

  const businesses = businessesRes.data || []
  const activePeriods = periodsRes.data || []

  const periodMap = new Map<string, typeof activePeriods[0]>()
  for (const p of activePeriods) {
    periodMap.set(p.business_id, p)
  }

  let totalRevenue = 0
  let activeCustomers = 0
  let customersAtCap = 0
  let failedPayments = 0
  let activationCount = 0

  const customerRows = businesses.map((b: any) => {
    const period = periodMap.get(b.id)
    const amount = period ? parseFloat(period.total_amount) || 0 : 0
    const bookings = period?.booking_count || 0
    const capReached = period?.cap_reached || false
    const status = period?.status || (b.billing_active ? 'active' : 'new')

    if (b.billing_active) activeCustomers++
    if (b.activation_credit_paid) activationCount++
    if (capReached) customersAtCap++
    if (status === 'failed') failedPayments++
    totalRevenue += amount

    return {
      id: b.id,
      name: b.name,
      currency: b.currency || 'GBP',
      bookings,
      this_month: amount,
      cap_reached: capReached,
      status: b.billing_active ? (status === 'failed' ? 'failed' : period?.paid_at ? 'paid' : 'active') : (bookings > 0 ? 'free' : 'new'),
      last_payment: period?.paid_at || null,
      stripe_customer_id: b.stripe_customer_id,
    }
  })

  const avgRevenue = activeCustomers > 0 ? totalRevenue / activeCustomers : 0

  return Response.json({
    total_revenue: totalRevenue,
    active_customers: activeCustomers,
    avg_revenue: avgRevenue,
    customers_at_cap: customersAtCap,
    failed_payments: failedPayments,
    activation_rate: businesses.length > 0 ? activationCount / businesses.length : 0,
    customers: customerRows,
  })
}
