import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

// Admin, AI Costs, Prices. The price list the database turns tokens into
// dollars with. GET lists it. PUT saves one row, or the dollar to pound rate.
// POST { action: 'reprice', from } prices every call from that date again, which
// is what to press after correcting a price.

const DAY = /^\d{4}-\d{2}-\d{2}$/
const PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter', 'xai', 'typesafe', 'assemblyai']

function price(value: unknown): number | null | undefined {
  if (value === null || value === '' || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : undefined
}

export default async function handler(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
  if (!user?.email) return new Response('Unauthorized', { status: 401 })
  const { data: admin } = await supabaseAdmin.from('admin_users').select('email').eq('email', user.email).single()
  if (!admin) return new Response('Forbidden', { status: 403 })

  if (req.method === 'GET') {
    const [{ data: prices, error }, { data: rate }] = await Promise.all([
      supabaseAdmin.from('ai_model_prices')
        .select('id, provider, model, match, input_per_mtok, output_per_mtok, cached_input_per_mtok, per_minute, effective_from, note, updated_at')
        .order('provider').order('model').order('effective_from'),
      supabaseAdmin.from('platform_settings').select('value').eq('key', 'usd_to_gbp').maybeSingle(),
    ])
    if (error) return Response.json({ error: 'The price list could not be loaded' }, { status: 500 })
    return Response.json({ prices: prices ?? [], usd_to_gbp: Number(rate?.value) || 0 })
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return Response.json({ error: 'Send JSON' }, { status: 400 })

    if (body.usd_to_gbp !== undefined) {
      const rate = Number(body.usd_to_gbp)
      if (!Number.isFinite(rate) || rate < 0.1 || rate > 2) return Response.json({ error: 'The rate looks wrong' }, { status: 400 })
      const { error } = await supabaseAdmin.from('platform_settings')
        .upsert({ key: 'usd_to_gbp', value: String(rate), updated_at: new Date().toISOString(), updated_by: user.email }, { onConflict: 'key' })
      if (error) return Response.json({ error: 'The rate could not be saved' }, { status: 500 })
      return Response.json({ ok: true })
    }

    const provider = String(body.provider ?? '')
    const model = String(body.model ?? '').trim()
    const match = body.match === 'prefix' ? 'prefix' : 'exact'
    const effective = String(body.effective_from ?? '2000-01-01')
    const input = price(body.input_per_mtok)
    const output = price(body.output_per_mtok)
    const cached = price(body.cached_input_per_mtok)
    const minute = price(body.per_minute)
    if (!PROVIDERS.includes(provider)) return Response.json({ error: 'Unknown provider' }, { status: 400 })
    if (!model || model.length > 120) return Response.json({ error: 'The model name is missing or too long' }, { status: 400 })
    if (!DAY.test(effective) || Number.isNaN(Date.parse(effective))) return Response.json({ error: 'The date must look like 2026-10-07' }, { status: 400 })
    if ([input, output, cached, minute].includes(undefined)) return Response.json({ error: 'A price must be a number from 0 to 10000' }, { status: 400 })

    const { error } = await supabaseAdmin.from('ai_model_prices').upsert({
      provider, model, match, effective_from: effective,
      input_per_mtok: input, output_per_mtok: output, cached_input_per_mtok: cached, per_minute: minute,
      note: typeof body.note === 'string' ? body.note.slice(0, 200) : `Set by ${user.email}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,model,effective_from' })
    if (error) return Response.json({ error: 'The price could not be saved' }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null) as { action?: string; from?: string } | null
    if (body?.action !== 'reprice') return Response.json({ error: 'Unknown action' }, { status: 400 })
    const from = body.from && DAY.test(body.from) ? body.from : '2026-10-01'
    const { data, error } = await supabaseAdmin.rpc('ai_reprice_usage', { p_from: `${from}T00:00:00Z` })
    if (error) return Response.json({ error: 'The calls could not be priced again' }, { status: 500 })
    return Response.json({ ok: true, repriced: data })
  }

  return new Response('Method not allowed', { status: 405 })
}
