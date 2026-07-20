import { supabaseAdmin } from '../../src/integrations/supabase/client.js'

/**
 * Owner-only gate for the CEO cockpit. Reuses the existing admin_users allow-list
 * (same as api/admin/dashboard.ts). If an OWNER_EMAIL env var is set, the caller
 * must ALSO match it exactly — so even a second admin can't see Hugo's cockpit.
 * Returns the verified email, or a Response to short-circuit the handler.
 */
export async function requireAdmin(req: Request): Promise<{ email: string } | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
  if (!user?.email) return new Response('Unauthorized', { status: 401 })

  const ownerEmail = process.env.OWNER_EMAIL
  if (ownerEmail && user.email.toLowerCase() !== ownerEmail.toLowerCase()) {
    return new Response('Forbidden', { status: 403 })
  }

  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single()

  if (!admin) return new Response('Forbidden', { status: 403 })
  return { email: admin.email }
}

/**
 * Plain admin_users gate for edge handlers — any allow-listed admin passes,
 * no OWNER_EMAIL restriction (that lock is specific to the CEO cockpit).
 * Used by the /super reviews admin routes.
 */
export async function requireAdminAny(req: Request): Promise<{ email: string } | Response> {
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

/**
 * Same admin_users gate for Node-runtime (req,res) handlers. No OWNER_EMAIL
 * restriction — any allow-listed admin passes (matches api/admin/dashboard.ts).
 */
export async function requireAdminNode(
  req: { headers: Record<string, string | string[] | undefined> },
): Promise<{ email: string } | { status: number; error: string }> {
  const raw = req.headers['authorization']
  const header = Array.isArray(raw) ? raw[0] : raw
  if (!header) return { status: 401, error: 'Unauthorized' }

  const jwt = header.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
  if (!user?.email) return { status: 401, error: 'Unauthorized' }

  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single()

  if (!admin) return { status: 403, error: 'Forbidden' }
  return { email: admin.email }
}
