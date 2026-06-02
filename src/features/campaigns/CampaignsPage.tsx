import { useCallback, useEffect, useState } from 'react'
import { Megaphone, Plus, Send, Loader2, X, CheckCircle2, Users } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import type { Campaign } from '@/core/types/database'

const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-elevated text-ink-muted',
  sending: 'bg-amber-50 text-amber-600',
  sent: 'bg-emerald-50 text-emerald-600',
  failed: 'bg-red-50 text-red-600',
}

export default function CampaignsPage() {
  const { session } = useAuth()
  const token = session?.access_token
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [sending, setSending] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/campaigns', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setCampaigns(data.campaigns || [])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  async function sendCampaign(id: string) {
    if (!token) return
    if (!window.confirm('Send this campaign now to all recipients?')) return
    setSending(id)
    try {
      const res = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ campaignId: id }),
      })
      const data = await res.json()
      if (data.error) alert(data.error)
      await load()
    } finally {
      setSending(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Campaigns</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Send a WhatsApp message to a group of customers at once.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition hover:bg-brand-600"
        >
          <Plus size={14} />
          New Campaign
        </button>
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-ink-muted" /></div>
        ) : campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <Megaphone size={28} className="mx-auto text-ink-subtle" />
            <p className="mt-3 text-[14px] font-medium text-ink">No campaigns yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">Create one to reach your customers on WhatsApp.</p>
          </div>
        ) : (
          campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elevated">
                <Megaphone size={18} className="text-ink-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[14px] font-medium text-ink">{c.name}</p>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', STATUS_CHIP[c.status])}>
                    {c.status}
                  </span>
                </div>
                <p className="truncate text-[12px] text-ink-muted">{c.message_template}</p>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-[12px] text-ink-muted">
                <Users size={13} />
                {c.status === 'sent' ? `${c.sent_count}/${c.recipient_count} sent` : `${c.recipient_count} recipients`}
              </div>
              {c.status === 'draft' ? (
                <button
                  onClick={() => sendCampaign(c.id)}
                  disabled={sending === c.id || c.recipient_count === 0}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
                >
                  {sending === c.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Send
                </button>
              ) : c.status === 'sent' ? (
                <CheckCircle2 size={18} className="text-emerald-500" />
              ) : null}
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <CreateCampaignModal
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

const LEAD_OPTIONS: Array<{ key: 'hot' | 'warm' | 'cold'; label: string }> = [
  { key: 'hot', label: 'Hot leads' },
  { key: 'warm', label: 'Warm leads' },
  { key: 'cold', label: 'Cold leads' },
]

function CreateCampaignModal({ token, onClose, onCreated }: { token?: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  function toggle(key: string) {
    setStatuses((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setErr('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/campaigns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          message_template: message,
          audience_filter: statuses.length > 0 ? { lead_status: statuses } : {},
        }),
      })
      const data = await res.json()
      if (data.error) { setErr(data.error); return }
      onCreated()
    } catch (ex: any) {
      setErr(ex.message || 'Failed to create campaign')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">New Campaign</h2>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink"><X size={16} /></button>
        </div>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>}

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Campaign name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Spring offer"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Message</label>
            <textarea
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Hi {name}, we've got 20% off this week…"
              className="mt-1 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <p className="mt-1 text-[11px] text-ink-subtle">Use {'{name}'} to insert each customer's first name.</p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Audience</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {LEAD_OPTIONS.map((o) => (
                <button
                  type="button"
                  key={o.key}
                  onClick={() => toggle(o.key)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-[12px] font-medium transition',
                    statuses.includes(o.key)
                      ? 'border-brand bg-brand-50 text-brand-700'
                      : 'border-border text-ink-muted hover:text-ink'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-subtle">
              {statuses.length === 0 ? 'No filter = all WhatsApp contacts.' : 'Only the selected lead types will receive it.'}
            </p>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand py-2 text-[13px] font-medium text-white hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create Campaign'}
          </button>
        </form>
      </div>
    </div>
  )
}
