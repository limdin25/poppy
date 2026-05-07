import { Hash, Phone } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { MetricCard } from '../components/MetricCard'
import { AdminError } from '../components/AdminError'
import { useAdminApi } from '../hooks/useAdminApi'

interface ChannelRow {
  id: string
  type: string
  status: string | null
  config: Record<string, unknown> | null
  created_at: string
  businesses: { name: string } | null
}

export default function NumberManagementPage() {
  const { data: channels, loading, error } = useAdminApi<ChannelRow[]>('numbers', [])

  const activeCount = channels.filter((n) => n.status === 'connected').length
  const totalCost = channels.length * 1.5

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Number Management</h1>
      {error && <AdminError error={error} />}
      <p className="mt-1 text-[13px] text-ink-muted">All provisioned voice channels</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Numbers" value={loading ? '...' : channels.length} icon={<Hash size={16} />} />
        <MetricCard label="Active" value={loading ? '...' : activeCount} change={`${channels.length - activeCount} disconnected`} trend="neutral" icon={<Phone size={16} />} />
        <MetricCard label="Monthly Cost" value={loading ? '...' : `£${totalCost.toFixed(2)}`} change="Twilio fees" trend="neutral" />
      </div>

      <div className="mt-6">
        <DataTable
          columns={[
            {
              key: 'business',
              header: 'Assigned To',
              render: (n) => <span className="font-medium text-ink">{n.businesses?.name || '— Unassigned'}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (n) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${n.status === 'connected' ? 'bg-success/10 text-success' : 'bg-elevated text-ink-muted'}`}>
                  {n.status || 'disconnected'}
                </span>
              ),
            },
            {
              key: 'cost',
              header: 'Cost/Mo',
              render: () => '£1.50',
            },
            {
              key: 'provisioned',
              header: 'Provisioned',
              render: (n) => <span className="text-ink-muted">{n.created_at?.split('T')[0] || '—'}</span>,
            },
          ]}
          data={channels}
          keyExtractor={(n) => n.id}
        />
      </div>
    </div>
  )
}
