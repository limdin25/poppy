import { MetricCard } from '../components/MetricCard'
import { DataTable } from '../components/DataTable'
import { CreditCard, TrendingUp, Users, AlertTriangle, CheckCircle, BarChart3 } from 'lucide-react'
import { AdminError } from '../components/AdminError'
import { useAdminApi } from '../hooks/useAdminApi'

interface CustomerRow {
  id: string
  name: string
  currency: string
  bookings: number
  this_month: number
  cap_reached: boolean
  status: string
  last_payment: string | null
  stripe_customer_id: string | null
}

interface BillingData {
  total_revenue: number
  active_customers: number
  avg_revenue: number
  customers_at_cap: number
  failed_payments: number
  activation_rate: number
  customers: CustomerRow[]
}

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: '\u00a3', USD: '$', EUR: '\u20ac' }

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-brand-50 text-brand-700',
  paid: 'bg-success/10 text-success',
  failed: 'bg-danger/10 text-danger',
  free: 'bg-emerald-50 text-emerald-600',
  new: 'bg-ink-subtle/10 text-ink-muted',
}

export default function BillingPage() {
  const { data, loading, error } = useAdminApi<BillingData>('billing', {
    total_revenue: 0,
    active_customers: 0,
    avg_revenue: 0,
    customers_at_cap: 0,
    failed_payments: 0,
    activation_rate: 0,
    customers: [],
  })

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Billing & Revenue</h1>
      {error && <AdminError error={error} />}
      <p className="mt-1 text-[13px] text-ink-muted">Usage-based billing overview — per-booking pricing with monthly cap</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Revenue (this month)"
          value={loading ? '...' : `\u00a3${data.total_revenue.toFixed(0)}`}
          icon={<CreditCard size={16} />}
        />
        <MetricCard
          label="Active Customers"
          value={loading ? '...' : data.active_customers}
          icon={<Users size={16} />}
        />
        <MetricCard
          label="Avg Rev / Customer"
          value={loading ? '...' : `\u00a3${data.avg_revenue.toFixed(0)}`}
          icon={<TrendingUp size={16} />}
        />
        <MetricCard
          label="Customers at Cap"
          value={loading ? '...' : data.customers_at_cap}
          icon={<CheckCircle size={16} />}
        />
        <MetricCard
          label="Failed Payments"
          value={loading ? '...' : data.failed_payments}
          icon={<AlertTriangle size={16} />}
          trend={data.failed_payments > 0 ? 'down' : 'neutral'}
        />
        <MetricCard
          label="Activation Rate"
          value={loading ? '...' : `${(data.activation_rate * 100).toFixed(0)}%`}
          icon={<BarChart3 size={16} />}
        />
      </div>

      <h2 className="mt-6 text-[14px] font-semibold text-ink">All Customers</h2>
      <div className="mt-3">
        <DataTable
          columns={[
            {
              key: 'business',
              header: 'Business',
              render: (c) => <span className="font-medium text-ink">{c.name}</span>,
            },
            {
              key: 'currency',
              header: 'Currency',
              render: (c) => <span className="text-ink-muted">{c.currency}</span>,
            },
            {
              key: 'bookings',
              header: 'Bookings',
              render: (c) => <span>{c.bookings}</span>,
            },
            {
              key: 'this_month',
              header: 'This Month',
              render: (c) => (
                <span className="font-medium">
                  {CURRENCY_SYMBOLS[c.currency] || '\u00a3'}{c.this_month.toFixed(2)}
                </span>
              ),
            },
            {
              key: 'cap',
              header: 'Cap?',
              render: (c) => c.cap_reached
                ? <span className="text-brand font-medium">Yes</span>
                : <span className="text-ink-muted">No</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (c) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[c.status] || STATUS_STYLES.new}`}>
                  {c.status}
                </span>
              ),
            },
            {
              key: 'last_payment',
              header: 'Last Payment',
              render: (c) => (
                <span className="text-[12px] text-ink-muted">
                  {c.last_payment ? new Date(c.last_payment).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '\u2014'}
                </span>
              ),
            },
          ]}
          data={data.customers}
          keyExtractor={(c) => c.id}
        />
      </div>
    </div>
  )
}
