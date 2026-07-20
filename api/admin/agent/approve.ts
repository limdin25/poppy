import { requireAdmin } from '../../lib/require-admin.js'
import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'
import { executeSend, type OwnerSettings } from '../../lib/agent-tools.js'

export const config = { runtime: 'edge' }

// Hugo decides on a gated draft. Approve -> send it now (with optional edits) and
// let the agent resume to confirm. Reject -> tell the agent why so it re-plans.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const auth = await requireAdmin(req)
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => ({}))) as {
    approval_id?: string
    decision?: 'approve' | 'reject'
    edited_args?: Record<string, unknown>
    reason?: string
  }
  if (!body.approval_id || !body.decision) return new Response(JSON.stringify({ error: 'approval_id and decision required' }), { status: 400 })

  const { data: appr } = await supabaseAdmin.from('agent_approvals').select('*').eq('id', body.approval_id).single()
  if (!appr || appr.owner_email !== auth.email) return new Response('Not found', { status: 404 })
  if (appr.status !== 'pending') return new Response(JSON.stringify({ error: 'already decided' }), { status: 409 })

  const nowIso = new Date().toISOString()
  const recipient = appr.tool === 'send_whatsapp' ? String((appr.args as Record<string, unknown>).to_phone || '') : String((appr.args as Record<string, unknown>).to_email || '')

  if (body.decision === 'reject') {
    await supabaseAdmin.from('agent_approvals').update({ status: 'rejected', decided_by: auth.email, decided_at: nowIso }).eq('id', appr.id)
    const note = `[system] Hugo rejected the draft ${appr.tool} to ${recipient}.${body.reason ? ` Reason: ${body.reason}.` : ''} Adjust the approach or move on.`
    await supabaseAdmin.from('agent_events').insert({ task_id: appr.task_id, role: 'user', kind: 'note', content: note, summary: `🚫 rejected — ${appr.summary || ''}`.slice(0, 140) })
    await supabaseAdmin.from('agent_wakeups').insert({ task_id: appr.task_id, owner_email: auth.email, run_after: nowIso, reason: 'draft rejected', status: 'pending' })
    return new Response(JSON.stringify({ ok: true, status: 'rejected' }), { status: 200 })
  }

  // Approve: send now (using edits if provided).
  const args = body.edited_args || (appr.args as Record<string, unknown>)
  const { data: settingsRow } = await supabaseAdmin.from('agent_settings').select('auto_send, wa_account_id, email_account_id').eq('owner_email', auth.email).maybeSingle()
  const settings: OwnerSettings = {
    auto_send: settingsRow?.auto_send ?? false,
    wa_account_id: settingsRow?.wa_account_id ?? null,
    email_account_id: settingsRow?.email_account_id ?? null,
  }
  const out = await executeSend(appr.tool, args, settings, supabaseAdmin)

  await supabaseAdmin.from('agent_approvals').update({
    status: out.ok ? 'executed' : 'failed',
    decided_by: auth.email,
    decided_at: nowIso,
    edited_args: body.edited_args ?? null,
  }).eq('id', appr.id)

  const note = out.ok
    ? `[system] Your approved ${appr.tool} to ${recipient} has been sent.`
    : `[system] The approved ${appr.tool} to ${recipient} FAILED to send: ${out.detail}. Decide what to do.`
  await supabaseAdmin.from('agent_events').insert({ task_id: appr.task_id, role: 'user', kind: 'note', content: note, summary: out.ok ? `✅ sent (approved) — ${recipient}` : `⚠️ send failed — ${out.detail}`.slice(0, 140) })
  await supabaseAdmin.from('agent_wakeups').insert({ task_id: appr.task_id, owner_email: auth.email, run_after: nowIso, reason: 'approved send done', status: 'pending' })

  return new Response(JSON.stringify({ ok: out.ok, status: out.ok ? 'executed' : 'failed', detail: out.detail }), { status: 200 })
}
