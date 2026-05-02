import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Eye } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { StatusBadge } from '../components/StatusBadge'

interface Business {
  id: string
  name: string
  ownerEmail: string
  plan: 'trial' | 'starter' | 'pro' | 'enterprise'
  status: 'active' | 'suspended' | 'trial' | 'churned'
  totalCalls: number
  createdAt: string
  lastActive: string
}

const MOCK_BUSINESSES: Business[] = [
  { id: '1', name: 'Smith & Sons Plumbing', ownerEmail: 'john@smithsons.co.uk', plan: 'pro', status: 'active', totalCalls: 234, createdAt: '2026-03-15', lastActive: '2 hours ago' },
  { id: '2', name: 'Brighton Heating Co', ownerEmail: 'sarah@brightonheating.com', plan: 'starter', status: 'active', totalCalls: 89, createdAt: '2026-04-01', lastActive: '1 day ago' },
  { id: '3', name: "Sarah's Hair Salon", ownerEmail: 'sarah@hairsalon.co.uk', plan: 'trial', status: 'trial', totalCalls: 12, createdAt: '2026-04-28', lastActive: '3 hours ago' },
  { id: '4', name: 'D&M Electrical Services', ownerEmail: 'dave@dmelectrical.co.uk', plan: 'pro', status: 'active', totalCalls: 156, createdAt: '2026-03-20', lastActive: '30 min ago' },
  { id: '5', name: 'ABC Plumbing', ownerEmail: 'alice@abcplumbing.co.uk', plan: 'starter', status: 'suspended', totalCalls: 45, createdAt: '2026-02-10', lastActive: '2 weeks ago' },
  { id: '6', name: 'QuickFix Repairs', ownerEmail: 'tom@quickfix.co.uk', plan: 'trial', status: 'churned', totalCalls: 3, createdAt: '2026-04-15', lastActive: '5 days ago' },
]

const PLAN_STYLES = {
  trial: 'bg-ink-subtle/10 text-ink-muted',
  starter: 'bg-brand/10 text-brand',
  pro: 'bg-success/10 text-success',
  enterprise: 'bg-violet-500/10 text-violet-600',
}

export default function BusinessesPage() {
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const filtered = MOCK_BUSINESSES.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.ownerEmail.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Businesses</h1>
          <p className="mt-1 text-[13px] text-ink-muted">{MOCK_BUSINESSES.length} total clients</p>
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
                  <p className="text-[11px] text-ink-muted">{b.ownerEmail}</p>
                </div>
              ),
            },
            {
              key: 'plan',
              header: 'Plan',
              render: (b) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${PLAN_STYLES[b.plan]}`}>
                  {b.plan}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (b) => <StatusBadge status={b.status} />,
            },
            {
              key: 'calls',
              header: 'Calls',
              render: (b) => b.totalCalls,
            },
            {
              key: 'lastActive',
              header: 'Last Active',
              render: (b) => <span className="text-ink-muted">{b.lastActive}</span>,
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
