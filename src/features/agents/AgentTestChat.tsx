import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Trash2, Loader2, Plus, MessageSquare } from 'lucide-react'
import { cn } from '@/core/lib/cn'

type MsgType = 'message' | 'follow_up' | 'confirmation' | 'reminder' | 'owner_alert' | 'system_note'

interface TestMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  type: MsgType
  label?: string
  timestamp: string
}

interface TestSession {
  id: string
  name: string
  createdAt: string
  messages: TestMessage[]
}

interface AgentTestChatProps {
  agentId: string
  agentName: string
  agentType: string
  accessToken: string
  onClose: () => void
}

interface AutomationEvent {
  type: MsgType
  message: string
  label: string
  delaySec: number
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function storageKey(agentId: string) {
  return `elsie-test-${agentId}`
}

function loadSessions(agentId: string): TestSession[] {
  try {
    const raw = localStorage.getItem(storageKey(agentId))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveSessions(agentId: string, sessions: TestSession[]) {
  localStorage.setItem(storageKey(agentId), JSON.stringify(sessions))
}

function createSession(index: number): TestSession {
  return { id: uid(), name: `Chat ${index}`, createdAt: new Date().toISOString(), messages: [] }
}

function displayDelay(realSec: number): number {
  if (realSec <= 300) return realSec * 1000
  return 15000
}

const TYPE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  follow_up: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  confirmation: { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' },
  reminder: { bg: 'bg-violet-50', text: 'text-violet-800', border: 'border-violet-200' },
  owner_alert: { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
  system_note: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' },
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS', instagram: 'Instagram',
}

export function AgentTestChat({ agentId, agentName, agentType, accessToken, onClose }: AgentTestChatProps) {
  const [sessions, setSessions] = useState<TestSession[]>(() => {
    const existing = loadSessions(agentId)
    return existing.length > 0 ? existing : [createSession(1)]
  })
  const [activeId, setActiveId] = useState<string>(() => {
    const existing = loadSessions(agentId)
    return existing.length > 0 ? existing[0].id : sessions[0].id
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingLabel, setPendingLabel] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const active = sessions.find(s => s.id === activeId) || sessions[0]

  const persist = useCallback((updated: TestSession[]) => {
    setSessions(updated)
    saveSessions(agentId, updated)
  }, [agentId])

  useEffect(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, 50)
  }, [active?.messages.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeId])

  useEffect(() => {
    return () => { timersRef.current.forEach(clearTimeout) }
  }, [])

  function clearPendingTimers() {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setPendingLabel(null)
  }

  function addMessage(msg: TestMessage) {
    setSessions(prev => {
      const updated = prev.map(s =>
        s.id === activeId ? { ...s, messages: [...s.messages, msg] } : s
      )
      saveSessions(agentId, updated)
      return updated
    })
  }

  function clearSession(sessionId: string) {
    if (sessions.length <= 1) {
      const fresh = createSession(1)
      persist([fresh])
      setActiveId(fresh.id)
    } else {
      const updated = sessions.filter(s => s.id !== sessionId)
      persist(updated)
      if (activeId === sessionId) setActiveId(updated[0].id)
    }
    clearPendingTimers()
  }

  function addNewSession() {
    const next = createSession(sessions.length + 1)
    persist([...sessions, next])
    setActiveId(next.id)
    clearPendingTimers()
  }

  function scheduleAutomations(automations: AutomationEvent[]) {
    clearPendingTimers()

    const immediates = automations.filter(a => a.delaySec === 0)
    const delayed = automations.filter(a => a.delaySec > 0)

    let stagger = 800
    for (const auto of immediates) {
      const timer = setTimeout(() => {
        addMessage({
          id: uid(), role: 'system', content: auto.message,
          type: auto.type, label: auto.label, timestamp: new Date().toISOString(),
        })
      }, stagger)
      timersRef.current.push(timer)
      stagger += 800
    }

    const sorted = [...delayed].sort((a, b) => a.delaySec - b.delaySec)

    if (sorted.length > 0) {
      setPendingLabel(sorted[0].label)
    }

    for (let i = 0; i < sorted.length; i++) {
      const auto = sorted[i]
      const delayMs = displayDelay(auto.delaySec)

      const timer = setTimeout(() => {
        addMessage({
          id: uid(), role: 'system', content: auto.message,
          type: auto.type, label: auto.label, timestamp: new Date().toISOString(),
        })
        if (i + 1 < sorted.length) {
          setPendingLabel(sorted[i + 1].label)
        } else {
          setPendingLabel(null)
        }
      }, delayMs)
      timersRef.current.push(timer)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    clearPendingTimers()

    const userMsg: TestMessage = {
      id: uid(), role: 'user', content: text,
      type: 'message', timestamp: new Date().toISOString(),
    }

    addMessage(userMsg)
    setInput('')
    setLoading(true)

    try {
      const currentSession = sessions.find(s => s.id === activeId)
      const allMessages = [...(currentSession?.messages || []), userMsg]
      const apiMessages = allMessages
        .filter(m => m.type === 'message')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      const res = await fetch('/api/agent/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ agentId, messages: apiMessages }),
      })
      const data = await res.json()

      if (!res.ok) {
        addMessage({
          id: uid(), role: 'assistant', content: `Error: ${data.error || res.statusText}`,
          type: 'message', timestamp: new Date().toISOString(),
        })
        return
      }

      if (data.reply) {
        addMessage({
          id: uid(), role: 'assistant', content: data.reply,
          type: 'message', timestamp: new Date().toISOString(),
        })
      }

      if (data.automations?.length) {
        scheduleAutomations(data.automations)
      }
    } catch (err: any) {
      addMessage({
        id: uid(), role: 'assistant', content: `Network error: ${err.message}`,
        type: 'message', timestamp: new Date().toISOString(),
      })
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end sm:inset-auto sm:right-4 sm:top-16 sm:bottom-4">
      <div className="flex w-full flex-col bg-surface shadow-2xl ring-1 ring-ink/10 sm:w-[460px] sm:rounded-2xl">
        {/* Header */}
        <div className="border-b border-ink/10 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-semibold text-ink">{agentName}</h3>
              <span className="text-[11px] text-ink-muted">
                Test mode · {CHANNEL_LABEL[agentType] || agentType} rules
              </span>
            </div>
            <button onClick={onClose} className="rounded-md p-1.5 text-ink-subtle hover:bg-elevated transition">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Session tabs */}
        <div className="flex items-center gap-1 border-b border-ink/10 px-3 py-1.5 overflow-x-auto">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => { setActiveId(s.id); clearPendingTimers() }}
              className={cn(
                'group flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition',
                s.id === activeId ? 'bg-brand/10 text-brand' : 'text-ink-muted hover:bg-elevated hover:text-ink'
              )}
            >
              <MessageSquare size={11} />
              {s.name}
              <span
                onClick={(e) => { e.stopPropagation(); clearSession(s.id) }}
                className="ml-0.5 hidden rounded p-0.5 text-ink-subtle hover:bg-ink/10 hover:text-ink group-hover:inline-block"
              >
                <X size={10} />
              </span>
            </button>
          ))}
          <button
            onClick={addNewSession}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-ink-muted hover:bg-elevated hover:text-ink transition"
          >
            <Plus size={12} />
          </button>
          <div className="ml-auto">
            <button
              onClick={() => clearSession(activeId)}
              className="rounded-md p-1 text-ink-subtle hover:bg-red-50 hover:text-red-600 transition"
              title="Clear this chat"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 min-h-0">
          {(!active || active.messages.length === 0) && (
            <p className="text-center text-[13px] text-ink-muted py-8">
              Send a message to test your agent.<br />
              <span className="text-[11px]">Bookings, follow-ups, confirmations and reminders will trigger automatically.</span>
            </p>
          )}

          {active?.messages.map((msg) => {
            if (msg.type === 'system_note') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-center">
                    {msg.label && (
                      <span className="block text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">
                        {msg.label}
                      </span>
                    )}
                    <p className="text-[12px] text-gray-600">{msg.content}</p>
                  </div>
                </div>
              )
            }

            if (msg.type !== 'message') {
              const style = TYPE_STYLES[msg.type] || TYPE_STYLES.system_note
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className={cn('max-w-[85%] rounded-xl border px-3 py-2', style.bg, style.border)}>
                    {msg.label && (
                      <span className={cn('block text-[10px] font-semibold uppercase tracking-wide mb-0.5', style.text)}>
                        {msg.label}
                      </span>
                    )}
                    <p className={cn('text-[13px] leading-relaxed', style.text)}>{msg.content}</p>
                  </div>
                </div>
              )
            }

            return (
              <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-brand text-white rounded-br-md'
                    : 'bg-elevated text-ink rounded-bl-md'
                )}>
                  {msg.content}
                </div>
              </div>
            )
          })}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-elevated px-3.5 py-2.5 text-ink-muted">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[12px]">Thinking...</span>
              </div>
            </div>
          )}

          {pendingLabel && !loading && (
            <div className="flex justify-center">
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5">
                <Loader2 size={12} className="animate-spin text-amber-600" />
                <span className="text-[11px] font-medium text-amber-700">Waiting: {pendingLabel}</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-ink/10 px-3 py-3">
          <form onSubmit={(e) => { e.preventDefault(); handleSend() }} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message as the customer..."
              disabled={loading}
              className="flex-1 rounded-xl border border-ink/15 bg-elevated px-3.5 py-2 text-[13px] text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition hover:bg-brand-600 disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
