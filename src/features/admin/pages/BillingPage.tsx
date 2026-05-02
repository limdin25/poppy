import { MetricCard } from '../components/MetricCard'
import { DataTable } from '../components/DataTable'
import { CreditCard, TrendingUp, Users, AlertTriangle } from 'lucide-react'

interface Subscription {
  id: string
  business: string
  plan: string
  mrr: string
  status: 'active' | 'past_due' | 'cancelled'
  since: string
}

const MOCK_SUBS: Subscription[] = [
  { id: '1', business: 'Smith & Sons Plumbing', plan: 'Professional', mrr: '£99', status: 'active', since: '2026-03-22' },
  { id: '2', business: 'D&M Electrical Services', plan: 'Professional', mrr: '£99', status: 'active', since: '2026-03-25' },
  { id: '3', business: 'Brighton Heating Co', plan: 'Starter', mrr: '£49', status: 'active', since: '2026-04-08' },
  { id: '4', business: "Sarah's Hair Salon", plan: 'Trial', mrr: '£0', status: 'active', since: '2026-04-28' },
  { id: '5', business: 'ABC Plumbing', plan: 'Starter', mrr: '£49', status: 'past_due', since: '2026-02-15' },
  { id: '6', business: 'QuickFix Repairs', plan: 'Trial', mrr: '£0', status: 'cancelled', since: '2026-04-15' },
]

const STATUS_STYLES = {
  active: 'bg-success/10 text-success',
  past_due: 'bg-warning/10 text-warning',
  cancelled: 'bg-danger/10 text-danger',
}

export default function BillingPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Billing & Revenue</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Subscription and revenue overview</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="MRR" value="£4,230" change="+8.2% this month" trend="up" icon={<CreditCard size={16} />} />
        <MetricCard label="ARR" value="£50,760" change="Projected" trend="neutral" icon={<TrendingUp size={16} />} />
        <MetricCard label="Paying Customers" value={31} change="of 47 total" trend="neutral" icon={<Users size={16} />} />
        <MetricCard label="Churn Rate" value="4.2%" change="-0.8% vs last month" trend="up" icon={<AlertTriangle size={16} />} />
      </div>

      {/* Plan distribution */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { plan: 'Starter (£49)', count: 12, pct: '26%' },
          { plan: 'Professional (£99)', count: 15, pct: '32%' },
          { plan: 'Business (£199)', count: 4, pct: '8%' },
        ].map((p) => (
          <div key={p.plan} className="rounded-xl border border-border p-4">
            <p className="text-[12px] font-medium text-ink-muted">{p.plan}</p>
            <p className="mt-1 text-lg font-semibold text-ink">{p.count} clients</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
              <div className="h-full rounded-full bg-brand" style={{ width: p.pct }} />
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-6 text-[14px] font-semibold text-ink">Subscriptions</h2>
      <div className="mt-3">
        <DataTable
          columns={[
            { key: 'business', header: 'Business', render: (s) => <span className="font-medium text-ink">{s.business}</span> },
            { key: 'plan', header: 'Plan', render: (s) => s.plan },
            { key: 'mrr', header: 'MRR', render: (s) => <span className="font-medium">{s.mrr}</span> },
            {
              key: 'status',
              header: 'Status',
              render: (s) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[s.status]}`}>
                  {s.status.replace('_', ' ')}
                </span>
              ),
            },
            { key: 'since', header: 'Since', render: (s) => <span className="text-ink-muted">{s.since}</span> },
          ]}
          data={MOCK_SUBS}
          keyExtractor={(s) => s.id}
        />
      </div>
    </div>
  )
}
