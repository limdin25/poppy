import { useCallback, useEffect, useMemo, useState } from 'react'
import { Megaphone, Plus, Send, Users, Loader2 } from 'lucide-react'
import { PageHeader } from '@/core/ui/PageHeader'
import { StatCard } from '@/core/ui/StatCard'
import { DataTable, type Column } from '@/core/ui/DataTable'
import { StatusPill, type PillTone } from '@/core/ui/StatusPill'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/integrations/supabase/browser'
import type { Campaign, CampaignStatus, LeadStatus } from '@/core/types/database'

/**
 * Campaigns — wired to the real `campaigns` table + /api/campaigns/* routes.
 * Outbound WhatsApp broadcasts to re-engage leads. Keeps the waslo visual
 * (header + stat cards + table). WhatsApp-only, no credits/unlock anywhere.
 */

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
}

const STATUS_TONE: Record<CampaignStatus, PillTone> = {
  draft: 'neutral',
  sending: 'active',
  sent: 'success',
  failed: 'danger',
}

const AUDIENCE_OPTIONS: { value: LeadStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All WhatsApp contacts' },
  { value: 'hot', label: 'Hot leads' },
  { value: 'warm', label: 'Warm leads' },
  { value: 'cold', label: 'Cold leads' },
  { value: 'new', label: 'New contacts' },
]

/** Human-readable summary of a campaign's audience filter. */
function audienceSummary(filter: Record<string, unknown>): string {
  const statuses = Array.isArray(filter?.lead_status) ? (filter.lead_status as string[]) : []
  if (statuses.length === 0) return 'All WhatsApp contacts'
  const label = AUDIENCE_OPTIONS.find((o) => o.value === statuses[0])?.label
  return label ?? `${statuses.join(', ')} leads`
}

export default function CampaignsPage() {
  const { businessId, session } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New-campaign modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('')
  const [audience, setAudience] = useState<LeadStatus | 'all'>('all')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Per-row send state
  const [sendingId, setSendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('campaigns')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setCampaigns((data as Campaign[]) ?? [])
    setLoading(false)
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    const active = campaigns.filter((c) => c.status === 'sending').length
    const sent = campaigns.reduce((n, c) => n + (c.sent_count || 0), 0)
    const reached = campaigns.reduce((n, c) => n + (c.recipient_count || 0), 0)
    return { active, sent, reached }
  }, [campaigns])

  function resetModal() {
    setName('')
    setTemplate('')
    setAudience('all')
    setCreateError(null)
  }

  async function handleCreate() {
    if (!session?.access_token) return
    if (!name.trim() || !template.trim()) {
      setCreateError('Name and message are required.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const audience_filter = audience === 'all' ? {} : { lead_status: [audience] }
      const res = await fetch('/api/campaigns/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: name.trim(), message_template: template.trim(), audience_filter }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create campaign')
      setModalOpen(false)
      resetModal()
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create campaign')
    } finally {
      setCreating(false)
    }
  }

  async function handleSend(id: string) {
    if (!session?.access_token) return
    setSendingId(id)
    setError(null)
    try {
      const res = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ campaignId: id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to send campaign')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send campaign')
    } finally {
      setSendingId(null)
    }
  }

  const columns: Column<Campaign>[] = [
    {
      key: 'name',
      header: 'Campaign',
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{c.name}</p>
          <p className="truncate text-[12px] text-ink-subtle">{audienceSummary(c.audience_filter)}</p>
        </div>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      render: () => (
        <StatusPill tone="neutral" uppercase={false}>
          <span className="h-1.5 w-1.5 rounded-full bg-whatsapp" />
          WhatsApp
        </StatusPill>
      ),
    },
    {
      key: 'recipients',
      header: 'Recipients',
      align: 'right',
      render: (c) => (
        <span className="inline-flex items-center gap-1 text-ink-muted">
          <Users size={13} className="text-ink-subtle" />
          {c.recipient_count}
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Sent / Recipients',
      render: (c) => (
        <span className="whitespace-nowrap text-[12.5px] tabular-nums text-ink-muted">
          <span className="font-medium text-ink">{c.sent_count}</span>{' '}
          <span className="text-ink-subtle">/</span> {c.recipient_count}
          {c.failed_count > 0 && (
            <span className="ml-2 text-red-500">{c.failed_count} failed</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <StatusPill tone={STATUS_TONE[c.status]} uppercase={false}>
          {STATUS_LABEL[c.status]}
        </StatusPill>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => {
        const canSend = c.status === 'draft' || c.status === 'failed'
        if (!canSend) return null
        const busy = sendingId === c.id
        return (
          <button
            onClick={() => handleSend(c.id)}
            disabled={busy || c.recipient_count === 0}
            title={c.recipient_count === 0 ? 'No recipients to send to' : 'Send now'}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-ink transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {busy ? 'Sending…' : 'Send'}
          </button>
        )
      },
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Work"
        title="Campaigns"
        description="Re-engage past customers and warm up quiet leads with WhatsApp broadcasts — Elsie handles every reply."
        actions={
          <button
            onClick={() => {
              resetModal()
              setModalOpen(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          >
            <Plus size={15} /> New campaign
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<Megaphone />} label="Active campaigns" value={stats.active} sub="Sending right now" />
        <StatCard icon={<Send />} label="Messages sent" value={stats.sent.toLocaleString()} sub="Across all campaigns" />
        <StatCard icon={<Users />} label="Recipients reached" value={stats.reached.toLocaleString()} sub="Total audience targeted" />
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-600">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-surface py-16 text-[13px] text-ink-muted shadow-soft">
          <Loader2 size={16} className="mr-2 animate-spin" /> Loading campaigns…
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={campaigns}
          keyExtractor={(c) => c.id}
          emptyMessage="No campaigns yet — create one to re-engage your leads."
        />
      )}

      <p className="px-1 text-[12px] leading-relaxed text-ink-subtle">
        Campaigns send over WhatsApp with automatic throttling to protect your number, and every recipient is
        checked against opt-outs before sending — anyone tagged unsubscribed is removed for you.
      </p>

      <Dialog open={modalOpen} onClose={() => !creating && setModalOpen(false)} width="md">
        <DialogHeader>New campaign</DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Campaign name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring deep-clean offer"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Audience</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as LeadStatus | 'all')}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              {AUDIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Message</label>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={5}
              placeholder="Hi {name}, we're running 20% off deep cleans this month — reply YES to book."
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <p className="text-[11px] text-ink-subtle">
              Use <code className="rounded bg-elevated px-1">{'{name}'}</code> to personalise with each contact's first name.
            </p>
          </div>

          {createError && <p className="text-[12.5px] text-red-600">{createError}</p>}
        </DialogBody>
        <DialogFooter>
          <button
            onClick={() => setModalOpen(false)}
            disabled={creating}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            {creating ? 'Creating…' : 'Create campaign'}
          </button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
