import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'
import { pushPropertyToPipeline, toE164, type BrrrProperty } from '../../lib/brrr.js'

export const config = { runtime: 'edge' };

async function requireAdmin(req: Request): Promise<Response | null> {
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
  return null
}

export default async function handler(req: Request) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  if (req.method === 'GET') {
    const { data: properties, error } = await supabaseAdmin
      .from('brrr_properties')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    const ids = (properties || []).map((p) => p.id)
    let callsByProperty: Record<string, unknown[]> = {}
    if (ids.length) {
      const { data: calls } = await supabaseAdmin
        .from('brrr_property_calls')
        .select('id, property_id, status, attempts, summary, qualification, transcript, created_at, updated_at')
        .in('property_id', ids)
        .order('created_at', { ascending: false })
      callsByProperty = (calls || []).reduce((acc: Record<string, unknown[]>, c) => {
        (acc[c.property_id] = acc[c.property_id] || []).push(c)
        return acc
      }, {})
    }
    return Response.json((properties || []).map((p) => ({ ...p, calls: callsByProperty[p.id] || [] })))
  }

  if (req.method === 'PATCH') {
    const body = await req.json() as { id?: string; status?: string; notes?: string }
    if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.status !== undefined) update.status = body.status
    if (body.notes !== undefined) update.notes = body.notes
    const { data, error } = await supabaseAdmin
      .from('brrr_properties')
      .update(update)
      .eq('id', body.id)
      .select('id, status, notes')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  if (req.method === 'POST') {
    const body = await req.json() as { action?: string; property_id?: string }
    if (!body.property_id) return Response.json({ error: 'property_id required' }, { status: 400 })

    const { data: property, error } = await supabaseAdmin
      .from('brrr_properties')
      .select('*')
      .eq('id', body.property_id)
      .single()
    if (error || !property) return Response.json({ error: 'property not found' }, { status: 404 })

    if (body.action === 'call') {
      if (!toE164(property.agent_phone)) {
        return Response.json({ error: 'No agent phone number on this property' }, { status: 400 })
      }
      // One live (pending/dialing) call per property at a time
      const { data: open } = await supabaseAdmin
        .from('brrr_property_calls')
        .select('id')
        .eq('property_id', property.id)
        .in('status', ['pending', 'dialing'])
        .limit(1)
        .maybeSingle()
      if (open) return Response.json({ error: 'A call is already queued for this property' }, { status: 409 })

      const { data: call, error: qErr } = await supabaseAdmin
        .from('brrr_property_calls')
        .insert({ property_id: property.id, status: 'pending', next_attempt_at: new Date().toISOString() })
        .select('id')
        .single()
      if (qErr) return Response.json({ error: qErr.message }, { status: 500 })

      await supabaseAdmin
        .from('brrr_properties')
        .update({ status: 'call_queued', updated_at: new Date().toISOString() })
        .eq('id', property.id)
      return Response.json({ ok: true, call_id: call.id })
    }

    if (body.action === 'push_to_pipeline') {
      const result = await pushPropertyToPipeline(property as BrrrProperty, (property.qualification || {}))
      if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
      await supabaseAdmin
        .from('brrr_properties')
        .update({ status: 'qualified', updated_at: new Date().toISOString() })
        .eq('id', property.id)
      return Response.json({ ok: true, deal_id: result.dealId })
    }

    return Response.json({ error: 'unknown action' }, { status: 400 })
  }

  return new Response('Method not allowed', { status: 405 })
}
