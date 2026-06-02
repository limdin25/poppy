import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Flame, ThermometerSun, Snowflake, MessageCircle, Loader2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useLeads } from '@/core/hooks/useLeads'
import type { Contact, LeadStatus } from '@/core/types/database'

const STATUS_META: Record<Exclude<LeadStatus, 'new'>, { label: string; icon: typeof Flame; chip: string; dot: string }> = {
  hot: { label: 'Hot', icon: Flame, chip: 'bg-red-50 text-red-600', dot: 'bg-red-500' },
  warm: { label: 'Warm', icon: ThermometerSun, chip: 'bg-amber-50 text-amber-600', dot: 'bg-amber-500' },
  cold: { label: 'Cold', icon: Snowflake, chip: 'bg-blue-50 text-blue-600', dot: 'bg-blue-500' },
}

const FILTERS: Array<{ key: 'all' | 'hot' | 'warm' | 'cold'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' },
]

function initials(c: Contact): string {
  const n = (c.name || c.phone || c.email || '?').trim()
  return n.slice(0, 2).toUpperCase()
}

function LeadRow({ c }: { c: Contact }) {
  const status = (c.lead_status === 'new' || !c.lead_status ? 'cold' : c.lead_status) as Exclude<LeadStatus, 'new'>
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-soft">
      <div className="relative">
        {c.avatar_url ? (
          <img src={c.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-[12px] font-semibold text-ink-muted">
            {initials(c)}
          </div>
        )}
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface', meta.dot)} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-medium text-ink">{c.name || c.phone || c.email || 'Unknown'}</p>
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.chip)}>
            <Icon size={11} />
            {meta.label}
          </span>
        </div>
        <p className="truncate text-[12px] text-ink-muted">
          {c.lead_reason || c.phone || c.email || '—'}
        </p>
      </div>

      {typeof c.lead_score === 'number' && (
        <div className="hidden sm:block text-right">
          <p className="text-[15px] font-semibold text-ink">{c.lead_score}</p>
          <p className="text-[10px] uppercase tracking-wide text-ink-subtle">score</p>
        </div>
      )}

      <Link
        to="/inbox"
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-ink-muted transition hover:border-brand/30 hover:text-brand"
      >
        <MessageCircle size={13} />
        Chat
      </Link>
    </div>
  )
}

export default function LeadsPage() {
  const { data: leads, loading } = useLeads()
  const [filter, setFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')

  const counts = useMemo(() => {
    return {
      hot: leads.filter(l => l.lead_status === 'hot').length,
      warm: leads.filter(l => l.lead_status === 'warm').length,
      cold: leads.filter(l => l.lead_status === 'cold').length,
    }
  }, [leads])

  const filtered = filter === 'all' ? leads : leads.filter(l => l.lead_status === filter)

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold text-ink">Leads</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Elsie scores every customer who messages you by how ready they are to buy.
        </p>
      </div>

      {/* Summary */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        {(['hot', 'warm', 'cold'] as const).map(s => {
          const meta = STATUS_META[s]
          const Icon = meta.icon
          return (
            <div key={s} className="rounded-xl border border-border bg-surface p-4 shadow-soft">
              <div className="flex items-center gap-2">
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', meta.chip)}>
                  <Icon size={14} />
                </span>
                <span className="text-[12px] font-medium text-ink-muted">{meta.label}</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-ink">{counts[s]}</p>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="mt-5 flex gap-1.5">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
              filter === f.key ? 'bg-brand text-white' : 'bg-elevated text-ink-muted hover:text-ink'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-ink-muted" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <Flame size={28} className="mx-auto text-ink-subtle" />
            <p className="mt-3 text-[14px] font-medium text-ink">No leads yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              As customers message your WhatsApp, Elsie will classify them here.
            </p>
          </div>
        ) : (
          filtered.map(c => <LeadRow key={c.id} c={c} />)
        )}
      </div>
    </div>
  )
}
