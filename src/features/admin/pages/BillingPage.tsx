import { MetricCard } from '../components/MetricCard'
import { DataTable } from '../components/DataTable'
import { CreditCard, TrendingUp, Users, AlertTriangle } from 'lucide-react'
import { useAdminApi } from '../hooks/useAdminApi'

interface BillingData {
  mrr: number
  arr: number
  businesses: Array<{
    id: string
    name: string
    plan: string | null
    status: string | null
  }>
}

const PLAN_PRICES: Record<string, number> = { starter: 49, pro: 99, business: 199 }

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/10 text-success',
  suspended: 'bg-danger/10 text-danger',
  trial: 'bg-ink-subtle/10 text-ink-muted',
}

export default function BillingPage() {
  const { data, loading } = useAdminApi<BillingData>('billing', { mrr: 0, arr: 0, businesses: [] })

  const paying = data.businesses.filter((b) => b.plan && PLAN_PRICES[b.plan])
  const planCounts = data.businesses.reduce<Record<string, number>>((acc, b) => {
    const plan = b.plan || 'trial'
    acc[plan] = (acc[plan] || 0) + 1
    return acc
  }, {})

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Billing & Revenue</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Subscription and revenue overview</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="MRR" value={loading ? '...' : `£${data.mrr.toLocaleString()}`} icon={<CreditCard size={16} />} />
        <MetricCard label="ARR" value={loading ? '...' : `£${data.arr.toLocaleString()}`} trend="neutral" icon={<TrendingUp size={16} />} />
        <MetricCard label="Paying Customers" value={loading ? '...' : paying.length} change={`of ${data.businesses.length} total`} trend="neutral" icon={<Users size={16} />} />
        <MetricCard label="Total Businesses" value={loading ? '...' : data.businesses.length} icon={<AlertTriangle size={16} />} />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { plan: 'Starter (£49)', key: 'starter' },
          { plan: 'Professional (£99)', key: 'pro' },
          { plan: 'Business (£199)', key: 'business' },
        ].map((p) => {
          const count = planCounts[p.key] || 0
          const pct = data.businesses.length > 0 ? Math.round((count / data.businesses.length) * 100) : 0
          return (
            <div key={p.key} className="rounded-xl border border-border p-4">
              <p className="text-[12px] font-medium text-ink-muted">{p.plan}</p>
              <p className="mt-1 text-lg font-semibold text-ink">{count} clients</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      <h2 className="mt-6 text-[14px] font-semibold text-ink">All Businesses</h2>
      <div className="mt-3">
        <DataTable
          columns={[
            { key: 'business', header: 'Business', render: (b) => <span className="font-medium text-ink">{b.name}</span> },
            { key: 'plan', header: 'Plan', render: (b) => <span className="capitalize">{b.plan || 'trial'}</span> },
            {
              key: 'mrr',
              header: 'MRR',
              render: (b) => <span className="font-medium">£{PLAN_PRICES[b.plan || ''] || 0}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (b) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[b.status || 'active'] || STATUS_STYLES.active}`}>
                  {b.status || 'active'}
                </span>
              ),
            },
          ]}
          data={data.businesses}
          keyExtractor={(b) => b.id}
        />
      </div>
    </div>
  )
}
