import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Phone, MessageCircle, MessageSquare, Camera, Mail, Pencil, MoreHorizontal, Copy, Pause, Play, Trash2, X, Loader2, Bot } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { PageHeader } from '@/core/ui/PageHeader'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useAgents } from './hooks/useAgents'
import type { Agent, AgentType } from '@/core/types/database'

const AGENT_TYPE_META: Record<AgentType, { icon: typeof Phone; label: string }> = {
  voice: { icon: Phone, label: 'Voice' },
  whatsapp: { icon: MessageCircle, label: 'WhatsApp' },
  sms: { icon: MessageSquare, label: 'SMS' },
  instagram: { icon: Camera, label: 'Instagram' },
  email: { icon: Mail, label: 'Email' },
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-emerald-500',
  draft: 'bg-amber-400',
  paused: 'bg-red-400',
}

export default function AgentsListPage() {
  const { businessId } = useAuth()
  const { data: agents, loading, refetch } = useAgents()
  const [showCreate, setShowCreate] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleDuplicate(agent: Agent) {
    setMenuOpenId(null)
    const { id: _id, created_at: _ca, updated_at: _ua, name, ...rest } = agent
    await supabase.from('agents').insert({
      ...rest,
      name: `Copy of ${name}`,
      sort_order: agents.length,
    })
    refetch()
  }

  async function handleTogglePause(agent: Agent) {
    setMenuOpenId(null)
    const newStatus = agent.status === 'paused' ? 'active' : 'paused'
    await supabase.from('agents').update({ status: newStatus }).eq('id', agent.id)
    refetch()
  }

  async function handleDelete(agent: Agent) {
    setMenuOpenId(null)
    if (!window.confirm(`Delete "${agent.name}"? This cannot be undone.`)) return
    await supabase.from('agents').delete().eq('id', agent.id)
    refetch()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 sm:px-6">
        <PageHeader
          eyebrow="AI Agent"
          title="AI Agent"
          description="Manage the AI agents that handle your calls and messages."
          actions={
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
            >
              <Plus size={15} />
              New Agent
            </button>
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
              <Bot size={22} className="text-ink-subtle" />
            </div>
            <p className="mt-3 text-[15px] font-semibold text-ink">No agents yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">Create your first AI agent to start handling calls and messages.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white transition hover:opacity-90"
            >
              <Plus size={14} />
              New Agent
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const meta = AGENT_TYPE_META[agent.agent_type]
              const Icon = meta.icon
              return (
                <div key={agent.id} className="relative rounded-xl border border-border bg-surface p-5 shadow-soft">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-elevated">
                        <Icon size={16} className="text-ink-subtle" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[15px] font-semibold text-ink">{agent.name}</h3>
                          <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[agent.status] ?? 'bg-gray-300')} />
                        </div>
                        <p className="text-[12px] text-ink-muted capitalize">{agent.status}</p>
                      </div>
                    </div>
                    <OverflowMenu
                      open={menuOpenId === agent.id}
                      onToggle={() => setMenuOpenId(menuOpenId === agent.id ? null : agent.id)}
                      onClose={() => setMenuOpenId(null)}
                      agent={agent}
                      onDuplicate={() => handleDuplicate(agent)}
                      onTogglePause={() => handleTogglePause(agent)}
                      onDelete={() => handleDelete(agent)}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                      <Icon size={11} />
                      {meta.label}
                    </span>
                    {agent.tone && (
                      <span className="rounded-md bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-muted capitalize">
                        {agent.tone}
                      </span>
                    )}
                    {agent.is_default && (
                      <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                        Default
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => navigate(`/agents/${agent.id}`)}
                    className="mt-4 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateAgentModal
          businessId={businessId!}
          agents={agents}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            refetch()
            navigate(`/agents/${id}`)
          }}
        />
      )}
    </div>
  )
}

/* ── Overflow menu ─────────────────────────────────────────────── */

function OverflowMenu({
  open,
  onToggle,
  onClose,
  agent,
  onDuplicate,
  onTogglePause,
  onDelete,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  agent: Agent
  onDuplicate: () => void
  onTogglePause: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={onToggle}
        className="rounded-md p-1 text-ink-subtle transition hover:bg-elevated hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-surface py-1 shadow-pop">
          <button onClick={onDuplicate} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-elevated">
            <Copy size={14} /> Duplicate
          </button>
          <button onClick={onTogglePause} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-elevated">
            {agent.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
            {agent.status === 'paused' ? 'Activate' : 'Pause'}
          </button>
          <button onClick={onDelete} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-danger hover:bg-elevated">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Create agent modal ────────────────────────────────────────── */

function CreateAgentModal({
  businessId,
  agents,
  onClose,
  onCreated,
}: {
  businessId: string
  agents: Agent[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [agentType, setAgentType] = useState<AgentType>('voice')
  const [copyFromId, setCopyFromId] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)

    let insertData: Record<string, unknown> = {
      business_id: businessId,
      name: name.trim(),
      agent_type: agentType,
      status: 'draft',
      sort_order: agents.length,
    }

    if (copyFromId) {
      const source = agents.find((a) => a.id === copyFromId)
      if (source) {
        insertData = {
          ...insertData,
          greeting: source.greeting,
          tone: source.tone,
          ai_system_prompt: source.ai_system_prompt,
          ai_model: source.ai_model,
          takeover_delay_seconds: source.takeover_delay_seconds,
          after_hours_delay_seconds: source.after_hours_delay_seconds,
          working_hours_start: source.working_hours_start,
          working_hours_end: source.working_hours_end,
          working_days: source.working_days,
        }
      }
    }

    const { data, error } = await supabase.from('agents').insert(insertData).select('id').single()
    setSaving(false)
    if (error || !data) return
    onCreated(data.id)
  }

  const typeOptions: AgentType[] = ['voice', 'whatsapp', 'sms', 'instagram', 'email']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">New Agent</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={18} /></button>
        </div>

        <div className="mt-4 space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-[13px] font-medium text-ink">Agent name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Receptionist"
              autoFocus
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>

          {/* Agent type */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink">Channel</label>
            <div className="grid grid-cols-5 gap-2">
              {typeOptions.map((type) => {
                const meta = AGENT_TYPE_META[type]
                const Icon = meta.icon
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAgentType(type)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border py-2.5 text-[11px] font-medium transition',
                      agentType === type
                        ? 'border-brand bg-brand/5 text-brand'
                        : 'border-border text-ink-muted hover:bg-elevated'
                    )}
                  >
                    <Icon size={18} />
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Copy from */}
          {agents.length > 0 && (
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink">Copy settings from</label>
              <select
                value={copyFromId}
                onChange={(e) => setCopyFromId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="">Start fresh</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="h-10 flex-1 rounded-lg border border-border text-[13px] font-medium text-ink-muted">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
