// The agent's tools. Tier 0 = auto-run (read/research/remember/schedule).
// Tier 2 = gated send: when auto_send is OFF (default) the tool DOES NOT send —
// it writes an approval row and waits for Hugo to tap Approve. When ON it sends.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolDef } from './agent-loop.js'
import { webSearch } from '../../src/integrations/tavily/client.js'
import { sendToChat, sendEmail } from '../../src/integrations/unipile/client.js'

export interface OwnerSettings {
  auto_send: boolean
  wa_account_id: string | null
  email_account_id: string | null
}

export interface ToolCtx {
  ownerEmail: string
  taskId: string
  settings: OwnerSettings
  supabase: SupabaseClient
}

/** Tool schemas given to Claude. Tier metadata is kept separately (below). */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'get_datetime',
    description: 'Get the current date and time (UK / Europe-London). Use this before scheduling anything so "tomorrow 9am" is correct.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information (prices, facts, opening times, research). Returns a short answer plus sources.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to look up.' } },
      required: ['query'],
    },
  },
  {
    name: 'save_memory',
    description: "Save a durable fact or preference about Hugo or how he likes things done, so you remember it in future tasks. Use sparingly for things worth keeping.",
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact/preference to remember.' },
        kind: { type: 'string', description: 'preference | fact | decision | how_to', enum: ['preference', 'fact', 'decision', 'how_to'] },
      },
      required: ['content'],
    },
  },
  {
    name: 'recall_memory',
    description: 'Recall durable facts/preferences you saved earlier. Optionally filter by a keyword.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optional keyword to filter memories.' } },
    },
  },
  {
    name: 'schedule_wakeup',
    description: "Schedule yourself to resume this task later (a follow-up/reminder). Use this whenever you are waiting on time or on someone — set when, then STOP your turn. The heartbeat will wake you at that time.",
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'What to do when you wake up (e.g. "chase the broker if no reply").' },
        minutes_from_now: { type: 'number', description: 'Wake up this many minutes from now.' },
        run_at: { type: 'string', description: 'OR an exact ISO 8601 time to wake up at.' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'read_data',
    description: 'Read rows from an allowed app table (conversations, messages, contacts, appointments, agent_memory, agent_tasks, businesses). Optional exact-match filter.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'One of: conversations, messages, contacts, appointments, agent_memory, agent_tasks, businesses.' },
        match: { type: 'object', description: 'Optional exact-match filter, e.g. { "status": "open" }.' },
        limit: { type: 'number', description: 'Max rows (default 20, max 50).' },
      },
      required: ['table'],
    },
  },
  {
    name: 'send_whatsapp',
    description: "Send a WhatsApp message AS Hugo. By default this is held for Hugo's approval before it actually sends — draft it carefully as the final message.",
    input_schema: {
      type: 'object',
      properties: {
        to_phone: { type: 'string', description: 'Recipient phone number in international format.' },
        message: { type: 'string', description: 'The exact message to send.' },
      },
      required: ['to_phone', 'message'],
    },
  },
  {
    name: 'send_email',
    description: "Send an email AS Hugo. By default this is held for Hugo's approval before it actually sends — draft it carefully as the final email.",
    input_schema: {
      type: 'object',
      properties: {
        to_email: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Email subject line.' },
        body: { type: 'string', description: 'The exact email body.' },
      },
      required: ['to_email', 'body'],
    },
  },
]

export const TOOL_TIER: Record<string, 0 | 2> = {
  get_datetime: 0,
  web_search: 0,
  save_memory: 0,
  recall_memory: 0,
  schedule_wakeup: 0,
  read_data: 0,
  send_whatsapp: 2,
  send_email: 2,
}

const READ_WHITELIST = ['conversations', 'messages', 'contacts', 'appointments', 'agent_memory', 'agent_tasks', 'businesses']

function ukTime(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

/** Actually send via Unipile. Reused by the auto-send path AND by approve.ts. */
export async function executeSend(
  tool: string,
  args: Record<string, unknown>,
  settings: OwnerSettings,
  _supabase: SupabaseClient,
): Promise<{ ok: boolean; detail: string }> {
  try {
    if (tool === 'send_whatsapp') {
      if (!settings.wa_account_id) return { ok: false, detail: 'No WhatsApp sending account set in CEO settings.' }
      await sendToChat(settings.wa_account_id, String(args.to_phone || ''), String(args.message || ''))
      return { ok: true, detail: 'sent' }
    }
    if (tool === 'send_email') {
      if (!settings.email_account_id) return { ok: false, detail: 'No email sending account set in CEO settings.' }
      await sendEmail(settings.email_account_id, String(args.to_email || ''), String(args.subject || ''), String(args.body || ''))
      return { ok: true, detail: 'sent' }
    }
    return { ok: false, detail: `unknown send tool ${tool}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'send failed' }
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<{ result: unknown; summary: string }> {
  const { supabase, ownerEmail, taskId, settings } = ctx

  switch (name) {
    case 'get_datetime': {
      const now = new Date()
      return { result: { iso_utc: now.toISOString(), uk_time: ukTime(now) }, summary: '🕐 checked the time' }
    }

    case 'web_search': {
      const query = String(args.query || '').trim()
      if (!query) return { result: { error: 'query required' }, summary: 'web_search: no query' }
      const r = (await webSearch(query, 3)) as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> }
      const sources = (r.results || []).map((s) => ({ title: s.title, url: s.url, snippet: (s.content || '').slice(0, 300) }))
      return { result: { answer: r.answer ?? null, sources }, summary: `🔎 searched: "${query.slice(0, 60)}"` }
    }

    case 'save_memory': {
      const content = String(args.content || '').trim()
      if (!content) return { result: { error: 'content required' }, summary: 'save_memory: empty' }
      await supabase.from('agent_memory').insert({ owner_email: ownerEmail, kind: String(args.kind || 'fact'), content })
      return { result: { saved: true }, summary: `🧠 remembered: ${content.slice(0, 60)}` }
    }

    case 'recall_memory': {
      const { data } = await supabase
        .from('agent_memory')
        .select('kind, content, created_at')
        .eq('owner_email', ownerEmail)
        .order('created_at', { ascending: false })
        .limit(30)
      let rows = (data || []) as Array<{ kind: string; content: string; created_at: string }>
      const query = String(args.query || '').toLowerCase().trim()
      if (query) rows = rows.filter((m) => String(m.content || '').toLowerCase().includes(query))
      return { result: { memories: rows }, summary: `🧠 recalled ${rows.length} note(s)` }
    }

    case 'schedule_wakeup': {
      const reason = String(args.reason || 'follow up').slice(0, 500)
      let runAfter: Date
      if (args.run_at) {
        runAfter = new Date(String(args.run_at))
      } else {
        const mins = Number(args.minutes_from_now)
        runAfter = new Date(Date.now() + (Number.isFinite(mins) && mins > 0 ? mins : 60) * 60000)
      }
      if (isNaN(runAfter.getTime())) runAfter = new Date(Date.now() + 3600000)
      await supabase.from('agent_wakeups').insert({
        task_id: taskId,
        owner_email: ownerEmail,
        run_after: runAfter.toISOString(),
        reason,
        status: 'pending',
      })
      return { result: { scheduled_for: runAfter.toISOString() }, summary: `⏰ will resume ${ukTime(runAfter)} — ${reason.slice(0, 60)}` }
    }

    case 'read_data': {
      const table = String(args.table || '')
      if (!READ_WHITELIST.includes(table)) {
        return { result: { error: `table not allowed. allowed: ${READ_WHITELIST.join(', ')}` }, summary: `read_data: blocked ${table}` }
      }
      const limit = Math.min(Number(args.limit) || 20, 50)
      let q = supabase.from(table).select('*').limit(limit)
      if (args.match && typeof args.match === 'object') q = q.match(args.match as Record<string, unknown>)
      const { data, error } = await q
      if (error) return { result: { error: error.message }, summary: `read_data: error on ${table}` }
      return { result: { rows: data || [] }, summary: `📂 read ${(data || []).length} row(s) from ${table}` }
    }

    case 'send_whatsapp':
    case 'send_email': {
      const recipient = name === 'send_whatsapp' ? String(args.to_phone || '') : String(args.to_email || '')
      const summaryText = name === 'send_whatsapp'
        ? `WhatsApp to ${recipient}: ${String(args.message || '').slice(0, 80)}`
        : `Email to ${recipient} — ${String(args.subject || '').slice(0, 60)}`
      if (settings.auto_send) {
        const out = await executeSend(name, args, settings, supabase)
        return {
          result: out,
          summary: out.ok ? `✅ sent ${name === 'send_whatsapp' ? 'WhatsApp' : 'email'} to ${recipient}` : `⚠️ send failed: ${out.detail}`,
        }
      }
      await supabase.from('agent_approvals').insert({
        task_id: taskId,
        owner_email: ownerEmail,
        tool: name,
        args,
        summary: summaryText,
        status: 'pending',
        idempotency_key: globalThis.crypto.randomUUID(),
      })
      return {
        result: { queued_for_approval: true, note: 'Drafted and queued. It will NOT send until Hugo taps Approve in the cockpit.' },
        summary: `⏸️ awaiting approval — ${summaryText}`,
      }
    }

    default:
      return { result: { error: `unknown tool ${name}` }, summary: `unknown tool ${name}` }
  }
}
