import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Eye } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { StatusBadge } from '../components/StatusBadge'
import { useAdminApi } from '../hooks/useAdminApi'

interface Business {
  id: string
  name: string
  plan: string | null
  status: string | null
  created_at: string
  updated_at: string
  team_members: Array<{ email: string; role: string }>
}

const PLAN_STYLES: Record<string, string> = {
  trial: 'bg-ink-subtle/10 text-ink-muted',
  starter: 'bg-brand/10 text-brand',
  pro: 'bg-success/10 text-success',
  enterprise: 'bg-violet-500/10 text-violet-600',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function BusinessesPage() {
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const { data: businesses, loading } = useAdminApi<Business[]>('businesses', [])

  const filtered = businesses.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.team_members?.some((t) => t.email.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Businesses</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {loading ? '...' : `${businesses.length} total clients`}
          </p>
        </div>
      </div>

      <div className="relative mt-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search businesses..."
          className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="mt-4">
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Business',
              render: (b) => (
                <div>
                  <p className="font-medium text-ink">{b.name}</p>
                  <p className="text-[11px] text-ink-muted">{b.team_members?.[0]?.email || '—'}</p>
                </div>
              ),
            },
            {
              key: 'plan',
              header: 'Plan',
              render: (b) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${PLAN_STYLES[b.plan || 'trial'] || PLAN_STYLES.trial}`}>
                  {b.plan || 'trial'}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (b) => <StatusBadge status={b.status || 'active'} />,
            },
            {
              key: 'lastActive',
              header: 'Last Active',
              render: (b) => <span className="text-ink-muted">{timeAgo(b.updated_at)}</span>,
            },
            {
              key: 'actions',
              header: '',
              render: (b) => (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/admin/businesses/${b.id}`)
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-brand hover:bg-brand/5"
                >
                  <Eye size={12} />
                  View
                </button>
              ),
              className: 'w-20',
            },
          ]}
          data={filtered}
          keyExtractor={(b) => b.id}
          onRowClick={(b) => navigate(`/admin/businesses/${b.id}`)}
          emptyMessage="No businesses match your search"
        />
      </div>
    </div>
  )
}
