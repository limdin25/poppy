import { supabaseAdmin } from '../../src/integrations/supabase/client.js'
import { runAgentLoop, type AMessage } from '../lib/agent-loop.js'
import { TOOL_DEFS, executeTool, type OwnerSettings } from '../lib/agent-tools.js'

// Edge runtime to match the rest of the app's functions (all the existing crons
// + my admin APIs are edge and bundle this import style correctly). Heartbeat is
// the loop: each tick claims ONE due wakeup, advances the task a bounded amount,
// persists, and yields. Progress is saved per step, so if a tick is cut short the
// reaper re-queues the wakeup and the next tick resumes. Runs every minute.
export const config = { runtime: 'edge' }

const MODEL = 'claude-sonnet-4-6'
const MAX_STEPS = 4
const EVENT_SOFT_CAP = 80 // pause a runaway task and ask the owner

interface EventRow { role: string; kind: string; content: unknown; summary: string | null }

async function getAnthropicKey(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  const { data } = await supabaseAdmin.from('platform_settings').select('value').eq('key', 'anthropic_api_key').single()
  return data?.value || ''
}

function ukNow(): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' }).format(new Date())
}

function buildMessages(events: EventRow[]): AMessage[] {
  return events.map((e) => ({ role: e.role === 'assistant' ? 'assistant' : 'user', content: e.content } as AMessage))
}

async function beat(status: string, dueCount: number, note?: string): Promise<void> {
  await supabaseAdmin.from('agent_heartbeat').update({
    last_beat_at: new Date().toISOString(),
    last_status: status,
    due_count: dueCount,
    note: note ?? null,
  }).eq('id', 'singleton')
}

function systemPrompt(ownerEmail: string, memories: string[]): string {
  const mem = memories.length ? `\n\nWhat you already know about Hugo:\n- ${memories.join('\n- ')}` : ''
  return `You are Margarita, Hugo's private executive assistant, working autonomously on one task at a time.
Right now it is ${ukNow()} (UK time). The owner is ${ownerEmail}.

How you work:
- Think, then use your tools to actually do the work. Keep going until the task is done or you are waiting on someone/something.
- When you are waiting (for a reply, or for a time like "tomorrow 9am"), call schedule_wakeup with a clear reason, then STOP your turn. The heartbeat will wake you then.
- When the task is fully done, give a short, clear final reply to Hugo and stop (do not schedule a wakeup).
- Be concise and practical. Hugo is a busy, non-technical business owner. No filler, no em dashes.

Safety:
- send_whatsapp and send_email go out AS Hugo. By default they are held for his approval before sending, so write each one as the final, ready-to-send message.
- Only save_memory for durable preferences/facts worth keeping long term.${mem}`
}

export default async function handler(req: Request): Promise<Response> {
  // Auth: same pattern as api/cron/followups.ts
  const cronSecret = process.env.CRON_SECRET
  const toolSecret = process.env.TOOL_SECRET
  const authHeader = req.headers.get('authorization') || ''
  const headerTool = req.headers.get('x-tool-secret') || ''
  const isAuthed = (cronSecret && authHeader === `Bearer ${cronSecret}`) || (toolSecret && headerTool === toolSecret)
  if (!isAuthed) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  // Reaper: re-queue wakeups stuck 'processing' for >5 min (a tick died mid-run).
  const staleIso = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  await supabaseAdmin.from('agent_wakeups').update({ status: 'pending', claimed_at: null })
    .eq('status', 'processing').lt('claimed_at', staleIso)

  // Claim one due wakeup atomically (FOR UPDATE SKIP LOCKED via RPC).
  const { data: wk } = await supabaseAdmin.rpc('claim_due_wakeup')
  const wakeup = wk as { id: string; task_id: string; reason: string | null; attempts: number; max_attempts: number } | null
  if (!wakeup) {
    await beat('idle', 0)
    return new Response(JSON.stringify({ ok: true, worked: false }), { status: 200 })
  }

  try {
    const { data: task } = await supabaseAdmin.from('agent_tasks').select('*').eq('id', wakeup.task_id).single()
    if (!task || task.status === 'done' || task.status === 'failed') {
      await supabaseAdmin.from('agent_wakeups').update({ status: 'done' }).eq('id', wakeup.id)
      await beat('idle', 1)
      return new Response(JSON.stringify({ ok: true, worked: false, reason: 'task closed' }), { status: 200 })
    }

    const ownerEmail: string = task.owner_email
    await supabaseAdmin.from('agent_tasks').update({ status: 'acting', updated_at: new Date().toISOString() }).eq('id', task.id)

    // Rehydrate the conversation from the event log.
    const { data: evRows } = await supabaseAdmin.from('agent_events')
      .select('role, kind, content, summary').eq('task_id', task.id).order('seq', { ascending: true })
    const events = (evRows || []) as EventRow[]

    // Runaway guard.
    if (events.length > EVENT_SOFT_CAP) {
      await supabaseAdmin.from('agent_events').insert({
        task_id: task.id, role: 'assistant', kind: 'message',
        content: 'This task has run many steps. Pausing for your guidance — tell me how to proceed.',
        summary: '⏸️ paused (long task) — needs your guidance',
      })
      await supabaseAdmin.from('agent_tasks').update({ status: 'waiting_for_human', updated_at: new Date().toISOString() }).eq('id', task.id)
      await supabaseAdmin.from('agent_wakeups').update({ status: 'done' }).eq('id', wakeup.id)
      await beat('worked', 1)
      return new Response(JSON.stringify({ ok: true, worked: true, paused: true }), { status: 200 })
    }

    const messages = buildMessages(events)
    // If we are resuming from a timed self-wakeup, the last turn is the assistant's —
    // add a user nudge so the model has something to respond to.
    if (messages.length === 0 || messages[messages.length - 1].role === 'assistant') {
      const nudge = `[heartbeat ${ukNow()}] ${wakeup.reason || 'Continue the task.'} If you are still waiting on time or someone, call schedule_wakeup and then stop.`
      await supabaseAdmin.from('agent_events').insert({ task_id: task.id, role: 'user', kind: 'note', content: nudge, summary: '⏰ heartbeat resume' })
      messages.push({ role: 'user', content: nudge })
    }

    // Settings + memory.
    const { data: settingsRow } = await supabaseAdmin.from('agent_settings').select('auto_send, wa_account_id, email_account_id').eq('owner_email', ownerEmail).maybeSingle()
    const settings: OwnerSettings = {
      auto_send: settingsRow?.auto_send ?? false,
      wa_account_id: settingsRow?.wa_account_id ?? null,
      email_account_id: settingsRow?.email_account_id ?? null,
    }
    const { data: memRows } = await supabaseAdmin.from('agent_memory').select('content').eq('owner_email', ownerEmail).order('created_at', { ascending: false }).limit(8)
    const memories = (memRows || []).map((m: { content: string }) => m.content)

    const apiKey = await getAnthropicKey()
    if (!apiKey) throw new Error('No ANTHROPIC_API_KEY configured')

    const result = await runAgentLoop({
      apiKey,
      model: MODEL,
      system: systemPrompt(ownerEmail, memories),
      messages,
      tools: TOOL_DEFS,
      maxSteps: MAX_STEPS,
      execTool: (name, args) => executeTool(name, args, { ownerEmail, taskId: task.id, settings, supabase: supabaseAdmin }),
      onEvent: async (e) => {
        await supabaseAdmin.from('agent_events').insert({ task_id: task.id, role: e.role, kind: e.kind, content: e.content as object, summary: e.summary })
      },
    })

    // Decide the task's next state.
    const nowIso = new Date().toISOString()
    const { count: pendingApprovals } = await supabaseAdmin.from('agent_approvals').select('id', { count: 'exact', head: true }).eq('task_id', task.id).eq('status', 'pending')
    const { count: futureWakeups } = await supabaseAdmin.from('agent_wakeups').select('id', { count: 'exact', head: true }).eq('task_id', task.id).eq('status', 'pending').gt('run_after', nowIso)

    let status = 'done'
    if (pendingApprovals && pendingApprovals > 0) status = 'waiting_for_human'
    else if (futureWakeups && futureWakeups > 0) status = 'acting'
    else if (result.hitCap) {
      status = 'acting'
      await supabaseAdmin.from('agent_wakeups').insert({ task_id: task.id, owner_email: ownerEmail, run_after: nowIso, reason: 'continue (hit step cap)', status: 'pending' })
    }
    await supabaseAdmin.from('agent_tasks').update({ status, last_error: null, updated_at: nowIso }).eq('id', task.id)
    await supabaseAdmin.from('agent_wakeups').update({ status: 'done' }).eq('id', wakeup.id)
    await beat('worked', 1)
    return new Response(JSON.stringify({ ok: true, worked: true, status, steps: result.steps }), { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'tick failed'
    console.error('[agent/tick] error:', msg)
    // Retry with backoff, or fail after max attempts.
    if (wakeup.attempts < wakeup.max_attempts) {
      const backoffMin = Math.min(60, Math.pow(2, wakeup.attempts)) // 1,2,4,8,16,32,60
      await supabaseAdmin.from('agent_wakeups').update({
        status: 'pending', claimed_at: null, last_error: msg,
        run_after: new Date(Date.now() + backoffMin * 60000).toISOString(),
      }).eq('id', wakeup.id)
    } else {
      await supabaseAdmin.from('agent_wakeups').update({ status: 'failed', last_error: msg }).eq('id', wakeup.id)
      await supabaseAdmin.from('agent_tasks').update({ status: 'failed', last_error: msg }).eq('id', wakeup.task_id)
    }
    await beat('error', 1, msg.slice(0, 200))
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 200 })
  }
}
