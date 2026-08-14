import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'
import {
  pushPropertyToPipeline,
  getBrrrSettings, saveBrrrSettings, type BrrrProperty, type BrrrSettings,
} from '../../lib/brrr.js'
import { calibrate, type CalibrationRow } from '../../lib/price-feedback.js'

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
    // Live deals first, in their own window, then a recent sample of what the
    // auditor withdrew. One 200-row fetch ordered by created_at would let a
    // night's rejects (127 of them on 2026-08-11) push every live deal off the
    // page, which is the opposite of what this screen is for. The withdrawn
    // ones are still worth showing: they are the evidence the second brain is
    // working, and where Hugo checks whether it is being too harsh.
    const [liveRes, withdrawnRes] = await Promise.all([
      supabaseAdmin
        .from('brrr_properties')
        .select('*')
        .neq('status', 'auditor_killed')
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('brrr_properties')
        .select('*')
        .eq('status', 'auditor_killed')
        .order('updated_at', { ascending: false })
        .limit(50),
    ])
    const error = liveRes.error || withdrawnRes.error
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const properties = [...(liveRes.data || []), ...(withdrawnRes.data || [])]

    const ids = (properties || []).map((p) => p.id)
    let callsByProperty: Record<string, unknown[]> = {}
    if (ids.length) {
      const { data: calls } = await supabaseAdmin
        .from('brrr_property_calls')
        .select('id, property_id, status, attempts, next_attempt_at, summary, qualification, transcript, recording_url, cost_usd, created_at, updated_at')
        .in('property_id', ids)
        .order('created_at', { ascending: false })
      callsByProperty = (calls || []).reduce((acc: Record<string, unknown[]>, c) => {
        (acc[c.property_id] = acc[c.property_id] || []).push(c)
        return acc
      }, {})
    }
    const settings = await getBrrrSettings()

    // How the engine is doing against the only ground truth this business
    // generates: the figures branches say out loud. Empty until Pedro logs
    // some, and it says so rather than showing a confident zero.
    const { data: feedback } = await supabaseAdmin
      .from('brrr_price_feedback')
      .select('said_price, asking_price, cmv, cmv_confidence, offer_max')
      .order('created_at', { ascending: false })
      .limit(500)
    const calibration = calibrate((feedback || []) as CalibrationRow[])

    return Response.json({
      properties: (properties || []).map((p) => ({ ...p, calls: callsByProperty[p.id] || [] })),
      settings,
      calibration,
    })
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
    const body = await req.json() as {
      action?: string; property_id?: string; settings?: Partial<BrrrSettings>; note?: string
    }

    if (body.action === 'save_settings') {
      const saved = await saveBrrrSettings(body.settings || {})
      return Response.json({ ok: true, settings: saved })
    }

    if (!body.property_id) return Response.json({ error: 'property_id required' }, { status: 400 })

    const { data: property, error } = await supabaseAdmin
      .from('brrr_properties')
      .select('*')
      .eq('id', body.property_id)
      .single()
    if (error || !property) return Response.json({ error: 'property not found' }, { status: 404 })

    // The 'call' action is gone. It queued an AI qualifier call, and the AI
    // qualifier was retired on 2026-08-09 (Hugo: "no more robot calls for the
    // properties"). Estate agents are rung by a human through the CRM dialer.
    if (body.action === 'call') {
      return Response.json({ error: 'AI property calling was retired. Estate agents are called by a human agent in the CRM dialer.' }, { status: 410 })
    }

    // Hugo's own instruction for this house, pinned above the machine's brief
    // wherever the property is shown. Kept in its own column: `notes` holds the
    // scraper's listing description and the nightly re-send would bury it.
    // Empty text clears the pin rather than storing an empty string.
    if (body.action === 'save_note') {
      const text = String(body.note ?? '').trim()
      const { error: noteErr } = await supabaseAdmin
        .from('brrr_properties')
        .update({ pinned_note: text || null, updated_at: new Date().toISOString() })
        .eq('id', property.id)
      if (noteErr) return Response.json({ error: noteErr.message }, { status: 500 })
      return Response.json({ ok: true, pinned_note: text || null })
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
