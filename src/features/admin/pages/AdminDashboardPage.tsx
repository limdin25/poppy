import { Building2, Phone, CreditCard, Users, TrendingUp, Clock } from 'lucide-react'
import { MetricCard } from '../components/MetricCard'

const MOCK_RECENT = [
  { id: '1', action: 'New signup', detail: 'Brighton Plumbing Co registered', time: '5 min ago' },
  { id: '2', action: 'Call completed', detail: 'John Peterson → Smith & Sons (3:24)', time: '12 min ago' },
  { id: '3', action: 'Plan upgrade', detail: 'ABC Heating → Professional plan', time: '1 hour ago' },
  { id: '4', action: 'Number provisioned', detail: '+44 7700 900456 → D&M Electrical', time: '2 hours ago' },
  { id: '5', action: 'AI prompt updated', detail: 'Sarah\'s Salon changed greeting', time: '3 hours ago' },
]

export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Platform-wide overview</p>

      {/* KPI cards */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Businesses"
          value={47}
          change="+3 this week"
          trend="up"
          icon={<Building2 size={16} />}
        />
        <MetricCard
          label="Calls Today"
          value={128}
          change="+12% vs yesterday"
          trend="up"
          icon={<Phone size={16} />}
        />
        <MetricCard
          label="MRR"
          value="£4,230"
          change="+£320 this month"
          trend="up"
          icon={<CreditCard size={16} />}
        />
        <MetricCard
          label="Active Users"
          value={39}
          change="83% of total"
          trend="neutral"
          icon={<Users size={16} />}
        />
      </div>

      {/* Second row */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Call Success Rate"
          value="87%"
          change="Completed vs missed"
          trend="neutral"
          icon={<TrendingUp size={16} />}
        />
        <MetricCard
          label="Avg Call Duration"
          value="2:34"
          change="+8s vs last week"
          trend="neutral"
          icon={<Clock size={16} />}
        />
        <MetricCard
          label="Trial Conversions"
          value="34%"
          change="16 of 47 businesses"
          trend="up"
          icon={<CreditCard size={16} />}
        />
      </div>

      {/* Recent activity */}
      <div className="mt-6">
        <h2 className="text-[14px] font-semibold text-ink">Recent Activity</h2>
        <div className="mt-3 rounded-xl border border-border">
          {MOCK_RECENT.map((event, i) => (
            <div
              key={event.id}
              className={`flex items-center justify-between px-4 py-3 ${i < MOCK_RECENT.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div>
                <p className="text-[13px] font-medium text-ink">{event.action}</p>
                <p className="text-[12px] text-ink-muted">{event.detail}</p>
              </div>
              <span className="shrink-0 text-[11px] text-ink-subtle">{event.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
