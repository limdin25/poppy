import { requireAdmin } from '../../lib/require-admin.js'
import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' }

// Read or update the owner's agent settings (the auto-send toggle + which
// connected Unipile accounts the agent sends WhatsApp/email from).
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAdmin(req)
  if (auth instanceof Response) return auth

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin.from('agent_settings')
      .select('auto_send, wa_account_id, email_account_id')
      .eq('owner_email', auth.email).maybeSingle()
    return new Response(JSON.stringify({
      auto_send: data?.auto_send ?? false,
      wa_account_id: data?.wa_account_id ?? null,
      email_account_id: data?.email_account_id ?? null,
    }), { status: 200 })
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as {
      auto_send?: boolean
      wa_account_id?: string | null
      email_account_id?: string | null
    }
    const update: Record<string, unknown> = { owner_email: auth.email, updated_at: new Date().toISOString() }
    if (typeof body.auto_send === 'boolean') update.auto_send = body.auto_send
    if (body.wa_account_id !== undefined) update.wa_account_id = body.wa_account_id
    if (body.email_account_id !== undefined) update.email_account_id = body.email_account_id

    const { data, error } = await supabaseAdmin.from('agent_settings')
      .upsert(update, { onConflict: 'owner_email' })
      .select('auto_send, wa_account_id, email_account_id').single()
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    return new Response(JSON.stringify(data), { status: 200 })
  }

  return new Response('Method not allowed', { status: 405 })
}
