import { Building2, Phone, Users } from 'lucide-react'
import { MetricCard } from '../components/MetricCard'
import { useAdminApi } from '../hooks/useAdminApi'

interface DashboardData {
  businesses: number
  calls: number
  users: number
}

interface AuditEntry {
  id: string
  admin_email: string
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
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

export default function AdminDashboardPage() {
  const { data: stats, loading } = useAdminApi<DashboardData>('dashboard', { businesses: 0, calls: 0, users: 0 })
  const { data: recent } = useAdminApi<AuditEntry[]>('audit-log?limit=5', [])

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Platform-wide overview</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Total Businesses"
          value={loading ? '...' : stats.businesses}
          icon={<Building2 size={16} />}
        />
        <MetricCard
          label="Total Calls"
          value={loading ? '...' : stats.calls}
          icon={<Phone size={16} />}
        />
        <MetricCard
          label="Total Users"
          value={loading ? '...' : stats.users}
          icon={<Users size={16} />}
        />
      </div>

      <div className="mt-6">
        <h2 className="text-[14px] font-semibold text-ink">Recent Activity</h2>
        <div className="mt-3 rounded-xl border border-border">
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-muted">No recent activity</p>
          ) : (
            recent.map((entry, i) => (
              <div
                key={entry.id}
                className={`flex items-center justify-between px-4 py-3 ${i < recent.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div>
                  <p className="text-[13px] font-medium text-ink">{entry.action.replace(/_/g, ' ')}</p>
                  <p className="text-[12px] text-ink-muted">
                    {entry.target_type}{entry.target_id ? ` · ${entry.target_id.slice(0, 8)}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-subtle">{timeAgo(entry.created_at)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
