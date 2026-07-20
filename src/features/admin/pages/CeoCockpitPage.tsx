import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { PageHeader } from '@/core/ui/PageHeader'
import { SectionCard } from '@/core/ui/SectionCard'
import { Button } from '@/core/ui/Button'
import { Textarea } from '@/core/ui/Input'
import { EmptyState } from '@/core/ui/EmptyState'
import { Sparkles, Send, Clock, Check, X, ShieldCheck } from 'lucide-react'

interface TaskRow { id: string; title: string; status: string; created_at: string; updated_at: string }
interface EventRow { id: string; role: string; kind: string; summary: string | null; content: unknown; created_at: string }
interface Approval { id: string; task_id: string; tool: string; args: Record<string, unknown>; summary: string | null; status: string; created_at: string }
interface Wakeup { id: string; task_id: string; run_after: string; reason: string | null; status: string }
interface Heartbeat { last_beat_at: string | null; last_status: string | null; due_count: number; note: string | null }
interface Settings { auto_send: boolean; wa_account_id: string | null; email_account_id: string | null }

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-border/60 text-ink-muted',
  acting: 'bg-brand-50 text-brand-700',
  waiting_for_human: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
}
const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', acting: 'Working', waiting_for_human: 'Needs you', done: 'Done', failed: 'Failed',
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((b: { type?: string }) => b?.type === 'text').map((b: { text?: string }) => b.text || '').join(' ').trim()
  }
  return ''
}

function relativeFuture(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'now'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `in ${mins} min`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  return `in ${Math.round(hrs / 24)}d`
}

function ukDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export default function CeoCockpitPage() {
  const { session } = useAuth()
  const token = session?.access_token

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [wakeups, setWakeups] = useState<Wakeup[]>([])
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null)
  const [settings, setSettings] = useState<Settings>({ auto_send: false, wa_account_id: null, email_account_id: null })
  const [composer, setComposer] = useState('')
  const [busy, setBusy] = useState(false)
  const [, forceTick] = useState(0)
  const threadRef = useRef<HTMLDivElement>(null)

  const api = useCallback(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`/api/admin/${path}`, {
      method: opts?.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(opts?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  }, [token])

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const [t, a, s] = await Promise.all([
        api('agent/tasks'), api('agent/approvals'), api('agent/schedule'),
      ])
      setTasks(t.tasks || [])
      setApprovals(a.approvals || [])
      setHeartbeat(s.heartbeat || null)
      setWakeups(s.wakeups || [])
      if (selectedId) {
        const th = await api(`agent/thread?task_id=${selectedId}`)
        setEvents(th.events || [])
      } else {
        setEvents([])
      }
    } catch { /* transient — next tick retries */ }
  }, [token, selectedId, api])

  // Load settings once.
  useEffect(() => {
    if (!token) return
    api('agent/settings').then((s) => setSettings(s)).catch(() => {})
  }, [token, api])

  // Poll every 4s for live progress + re-render the "x seconds ago" labels.
  useEffect(() => {
    refresh()
    const a = setInterval(refresh, 4000)
    const b = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [refresh])

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [events])

  async function startOrReply() {
    const text = composer.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const r = await api('agent/message', { method: 'POST', body: { text, task_id: selectedId || undefined } })
      setComposer('')
      if (!selectedId && r.task_id) setSelectedId(r.task_id)
      await refresh()
    } catch (e) {
      alert(`Could not send: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setBusy(false)
    }
  }

  async function decide(approvalId: string, decision: 'approve' | 'reject') {
    setBusy(true)
    try {
      let reason: string | undefined
      if (decision === 'reject') reason = window.prompt('Why are you rejecting it? (optional, helps the agent)') || undefined
      await api('agent/approve', { method: 'POST', body: { approval_id: approvalId, decision, reason } })
      await refresh()
    } catch (e) {
      alert(`Could not ${decision}: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setBusy(false)
    }
  }

  async function toggleAutoSend() {
    const next = !settings.auto_send
    if (next && !window.confirm('Turn ON auto-send? The assistant will send WhatsApp and emails as you WITHOUT asking first.')) return
    try {
      const s = await api('agent/settings', { method: 'PUT', body: { auto_send: next } })
      setSettings(s)
    } catch (e) {
      alert(`Could not update: ${e instanceof Error ? e.message : 'error'}`)
    }
  }

  const beatMs = heartbeat?.last_beat_at ? Date.now() - new Date(heartbeat.last_beat_at).getTime() : null
  const beatHealthy = beatMs !== null && beatMs < 150000
  const taskTitle = (id: string) => tasks.find((t) => t.id === id)?.title || 'task'
  const selectedTask = tasks.find((t) => t.id === selectedId) || null

  return (
    <div>
      <PageHeader
        eyebrow="Margarita"
        title="CEO"
        description="Your private assistant. Hand it a task in plain words; it plans, works on the heartbeat, and reports back."
        actions={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-ink-muted">
              <span className={`h-2 w-2 rounded-full ${beatHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              {heartbeat?.last_beat_at ? `Heartbeat ${Math.round((beatMs || 0) / 1000)}s ago` : 'Heartbeat starting…'}
            </span>
            <Button variant={settings.auto_send ? 'danger' : 'secondary'} size="sm" onClick={toggleAutoSend}>
              <ShieldCheck size={14} />
              {settings.auto_send ? 'Auto-send ON' : 'Auto-send OFF'}
            </Button>
          </div>
        }
      />

      {approvals.length > 0 && (
        <SectionCard className="mb-5 border-amber-300" eyebrow="Needs your approval" title={`${approvals.length} draft${approvals.length > 1 ? 's' : ''} waiting to send`}>
          <div className="space-y-3">
            {approvals.map((a) => (
              <div key={a.id} className="flex flex-col gap-2 rounded-xl border border-border bg-elevated p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">{a.tool === 'send_whatsapp' ? 'WhatsApp' : 'Email'} · {taskTitle(a.task_id)}</p>
                  <p className="truncate text-[13px] text-ink">{a.summary || JSON.stringify(a.args)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(a.id, 'approve')}><Check size={14} /> Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(a.id, 'reject')}><X size={14} /> Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left: tasks + schedule */}
        <div className="space-y-5 lg:col-span-1">
          <SectionCard title="Tasks" action={<button className="text-brand hover:underline" onClick={() => { setSelectedId(null); setComposer('') }}>+ New</button>} bodyClassName="p-3">
            {tasks.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-ink-muted">No tasks yet. Start one on the right.</p>
            ) : (
              <div className="space-y-1">
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition ${selectedId === t.id ? 'bg-brand-50' : 'hover:bg-border/40'}`}
                  >
                    <span className="truncate text-[13px] text-ink">{t.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[t.status] || 'bg-border/60 text-ink-muted'}`}>{STATUS_LABEL[t.status] || t.status}</span>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard eyebrow="Peace of mind" title="Schedule & heartbeat">
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-elevated px-3 py-2 text-[12px]">
              <span className={`h-2 w-2 rounded-full ${beatHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-ink">{beatHealthy ? 'Alive' : 'Waiting'}</span>
              <span className="text-ink-muted">· runs every minute · {heartbeat?.last_status || 'idle'}</span>
            </div>
            {wakeups.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Nothing scheduled. The agent will add timers here when it plans a follow-up.</p>
            ) : (
              <ul className="space-y-2">
                {wakeups.map((w) => (
                  <li key={w.id} className="flex items-start gap-2 text-[13px]">
                    <Clock size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
                    <div className="min-w-0">
                      <p className="text-ink"><span className="font-medium">{relativeFuture(w.run_after)}</span> · {taskTitle(w.task_id)}</p>
                      <p className="truncate text-[12px] text-ink-muted">{w.reason || 'follow up'} · {ukDateTime(w.run_after)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Right: task panel */}
        <div className="lg:col-span-2">
          <SectionCard
            eyebrow={selectedTask ? STATUS_LABEL[selectedTask.status] || selectedTask.status : 'New task'}
            title={selectedTask ? selectedTask.title : 'What do you need done?'}
            bodyClassName="flex flex-col"
          >
            {selectedTask ? (
              <div ref={threadRef} className="mb-3 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                {events.map((e) => {
                  const isUserMsg = e.role === 'user' && e.kind === 'message'
                  const isAssistantMsg = e.role === 'assistant' && e.kind === 'message'
                  const text = textFromContent(e.content)
                  if (isUserMsg) {
                    return (
                      <div key={e.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-[13px] text-white">
                        {typeof e.content === 'string' ? e.content : text || e.summary}
                      </div>
                    )
                  }
                  if (isAssistantMsg) {
                    return (
                      <div key={e.id} className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-surface px-3.5 py-2 text-[13px] text-ink">
                        {text || e.summary}
                      </div>
                    )
                  }
                  // tool steps + system notes -> compact step-log line
                  return (
                    <div key={e.id} className="flex items-center gap-2 px-1 text-[12px] text-ink-muted">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-subtle/40" />
                      <span className="truncate">{e.summary || e.kind}</span>
                    </div>
                  )
                })}
                {events.length === 0 && <p className="py-6 text-center text-[13px] text-ink-muted">Working…</p>}
              </div>
            ) : (
              <EmptyState
                className="py-8"
                icon={<Sparkles size={22} />}
                title="Give Margarita a job"
                description='e.g. "Find the 3 cheapest Istanbul clinics for a CT scan and draft an email to each."'
              />
            )}

            <div className="mt-auto flex items-end gap-2 border-t border-border pt-3">
              <Textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startOrReply() } }}
                placeholder={selectedTask ? 'Reply or add detail… (Cmd/Ctrl+Enter to send)' : 'Type the task… (Cmd/Ctrl+Enter to send)'}
                className="min-h-[60px]"
              />
              <Button onClick={startOrReply} disabled={busy || !composer.trim()} className="shrink-0">
                <Send size={15} /> {selectedTask ? 'Send' : 'Start'}
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
