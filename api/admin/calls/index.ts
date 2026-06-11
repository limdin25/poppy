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

  const url = new URL(req.url)
  const limit = parseInt(url.searchParams.get('limit') || '50')
  const offset = parseInt(url.searchParams.get('offset') || '0')
  const businessId = url.searchParams.get('business_id')

  let query = supabaseAdmin
    .from('calls')
    .select('*, businesses(name), contacts(phone)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (businessId) query = query.eq('business_id', businessId)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // BRRR property-qualifier calls live in their own table (no business row) —
  // merge them in so the monitor shows every call the platform makes.
  const { data: brrrCalls } = await supabaseAdmin
    .from('brrr_property_calls')
    .select('id, property_id, status, attempts, next_attempt_at, retell_call_id, transcript, recording_url, summary, qualification, cost_usd, voice, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  let brrrRows: Record<string, unknown>[] = []
  if (brrrCalls?.length) {
    const propertyIds = [...new Set(brrrCalls.map((c) => c.property_id))]
    const { data: properties } = await supabaseAdmin
      .from('brrr_properties')
      .select('id, address, listing_url, agent_name, agent_phone, status')
      .in('id', propertyIds)
    const byId = new Map((properties || []).map((p) => [p.id, p]))

    brrrRows = brrrCalls.map((c) => {
      const p = byId.get(c.property_id)
      return {
        id: c.id,
        source: 'brrr_property',
        status: c.status, // pending | dialing | completed | failed | no_answer
        attempts: c.attempts,
        next_attempt_at: c.next_attempt_at,
        retell_call_id: c.retell_call_id,
        transcript: c.transcript,
        recording_url: c.recording_url,
        ai_summary: c.summary,
        qualification: c.qualification,
        cost_usd: c.cost_usd,
        voice: c.voice,
        created_at: c.created_at,
        updated_at: c.updated_at,
        property_address: p?.address || null,
        listing_url: p?.listing_url || null,
        agent_name: p?.agent_name || null,
        agent_phone: p?.agent_phone || null,
        property_status: p?.status || null,
      }
    })
  }

  // BRRR rows are reused across retries — sort them by latest activity so a
  // just-finished attempt 2 surfaces above older one-shot calls.
  const sortKey = (r: Record<string, unknown>) =>
    String((r.source === 'brrr_property' ? r.updated_at : null) || r.created_at || '')
  const businessRows = (data || []).map((c: Record<string, unknown>) => ({ ...c, source: 'business' }))
  const merged = [...businessRows, ...brrrRows].sort((a, b) => sortKey(b).localeCompare(sortKey(a)))

  return Response.json(merged.slice(0, limit))
}
