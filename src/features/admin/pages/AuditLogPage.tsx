import { useState } from 'react'
import { ScrollText, Search } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { DataTable } from '../components/DataTable'
import { useAdminApi } from '../hooks/useAdminApi'

interface AuditEntry {
  id: string
  admin_email: string
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const ACTION_STYLES: Record<string, string> = {
  impersonate: 'bg-violet-500/10 text-violet-600',
  edit_prompt: 'bg-brand/10 text-brand',
  edit_business: 'bg-brand/10 text-brand',
  suspend_business: 'bg-danger/10 text-danger',
  activate_business: 'bg-success/10 text-success',
  override_plan: 'bg-warning/10 text-warning',
  toggle_flag: 'bg-success/10 text-success',
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AuditLogPage() {
  const [search, setSearch] = useState('')
  const { data: entries } = useAdminApi<AuditEntry[]>('audit-log', [])

  const filtered = entries.filter(
    (e) =>
      e.action.toLowerCase().includes(search.toLowerCase()) ||
      (e.target_id || '').toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(e.metadata || {}).toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center gap-2">
        <ScrollText size={18} className="text-ink-muted" />
        <h1 className="text-xl font-semibold text-ink">Audit Log</h1>
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">Complete history of admin actions</p>

      <div className="relative mt-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search actions..."
          className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="mt-4">
        <DataTable
          columns={[
            {
              key: 'action',
              header: 'Action',
              render: (e) => (
                <span className={cn('inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium', ACTION_STYLES[e.action] || 'bg-elevated text-ink-muted')}>
                  {e.action.replace(/_/g, ' ')}
                </span>
              ),
            },
            {
              key: 'target',
              header: 'Target',
              render: (e) => (
                <div>
                  <p className="font-medium text-ink">{e.target_id?.slice(0, 12) || '—'}</p>
                  <p className="text-[11px] capitalize text-ink-muted">{e.target_type?.replace(/_/g, ' ') || '—'}</p>
                </div>
              ),
            },
            {
              key: 'details',
              header: 'Details',
              render: (e) => {
                const meta = e.metadata
                if (!meta) return <span className="text-ink-muted">—</span>
                const summary = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(', ')
                return <span className="text-ink-muted">{summary.slice(0, 80)}</span>
              },
            },
            {
              key: 'admin',
              header: 'Admin',
              render: (e) => <span className="text-ink-muted">{e.admin_email}</span>,
            },
            {
              key: 'time',
              header: 'Time',
              render: (e) => <span className="whitespace-nowrap text-ink-muted">{formatTimestamp(e.created_at)}</span>,
            },
          ]}
          data={filtered}
          keyExtractor={(e) => e.id}
          emptyMessage="No audit entries match your search"
        />
      </div>
    </div>
  )
}
