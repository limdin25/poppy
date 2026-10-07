import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

// Admin, AI Costs. One round trip to ai_cost_overview, which does all the
// adding up inside the database. Days and hours are London time.

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 366
const MAX_HOURLY_DAYS = 31

const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000)

function list(value: string | null): string[] | null {
  const items = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50)
  if (items.some((s) => s.length > 120)) return null
  return items
}

export default async function handler(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
  if (!user?.email) return new Response('Unauthorized', { status: 401 })
  const { data: admin } = await supabaseAdmin.from('admin_users').select('email').eq('email', user.email).single()
  if (!admin) return new Response('Forbidden', { status: 403 })

  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const q = new URL(req.url).searchParams
  const today = londonToday()
  const from = q.get('from') || today
  const to = q.get('to') || from
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return Response.json({ error: 'from and to must be dates like 2026-10-07' }, { status: 400 })
  }
  if (to < from) return Response.json({ error: 'The end date is before the start date' }, { status: 400 })
  const days = dayNumber(to) - dayNumber(from) + 1
  if (days > MAX_DAYS) return Response.json({ error: `Pick a range of ${MAX_DAYS} days or fewer` }, { status: 400 })

  const providers = list(q.get('providers'))
  const models = list(q.get('models'))
  const features = list(q.get('features'))
  if (!providers || !models || !features) return Response.json({ error: 'A filter value is too long' }, { status: 400 })

  // Hour by hour over a long range is thousands of bars nobody can read.
  const wantsHours = q.get('bucket') === 'hour'
  const bucket = wantsHours && days <= MAX_HOURLY_DAYS ? 'hour' : 'day'

  const { data, error } = await supabaseAdmin.rpc('ai_cost_overview', {
    p_from: from, p_to: to, p_bucket: bucket,
    p_providers: providers.length ? providers : null,
    p_models: models.length ? models : null,
    p_features: features.length ? features : null,
    p_tz: 'Europe/London',
  })
  if (error) {
    console.error('[admin/ai/costs]', error.message)
    return Response.json({ error: 'The cost figures could not be loaded' }, { status: 500 })
  }
  return Response.json({ ...(data as Record<string, unknown>), from, to, bucket, bucket_forced: wantsHours && bucket === 'day' })
}
