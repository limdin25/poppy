import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

async function requireAdmin(req: Request): Promise<{ email: string } | Response> {
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
  return { email: admin.email }
}

function cleanCoverage(coverage: unknown): string[] {
  if (!Array.isArray(coverage)) return []
  return coverage
    .map((c) => String(c).trim().toUpperCase())
    .filter(Boolean)
}

export default async function handler(req: Request) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('brrr_builders')
      .select('*')
      .order('name')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  if (req.method === 'POST') {
    const body = await req.json() as {
      name?: string; phone?: string; email?: string; coverage?: string[]; notes?: string
    }
    if (!body.name?.trim()) return Response.json({ error: 'name required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('brrr_builders')
      .insert({
        name: body.name.trim(),
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        coverage: cleanCoverage(body.coverage),
        notes: body.notes?.trim() || null,
      })
      .select('*')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })

    await supabaseAdmin.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'create_builder',
      target_type: 'brrr_builder',
      metadata: { id: data.id, name: data.name },
    })
    return Response.json(data)
  }

  if (req.method === 'PUT') {
    const body = await req.json() as {
      id?: string; name?: string; phone?: string; email?: string; coverage?: string[]; notes?: string; active?: boolean
    }
    if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) update.name = body.name.trim()
    if (body.phone !== undefined) update.phone = body.phone?.trim() || null
    if (body.email !== undefined) update.email = body.email?.trim() || null
    if (body.coverage !== undefined) update.coverage = cleanCoverage(body.coverage)
    if (body.notes !== undefined) update.notes = body.notes?.trim() || null
    if (body.active !== undefined) update.active = body.active

    const { data, error } = await supabaseAdmin
      .from('brrr_builders')
      .update(update)
      .eq('id', body.id)
      .select('*')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  if (req.method === 'DELETE') {
    const { id } = await req.json() as { id?: string }
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })

    const { error } = await supabaseAdmin.from('brrr_builders').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    await supabaseAdmin.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'delete_builder',
      target_type: 'brrr_builder',
      metadata: { id },
    })
    return Response.json({ ok: true })
  }

  return new Response('Method not allowed', { status: 405 })
}
