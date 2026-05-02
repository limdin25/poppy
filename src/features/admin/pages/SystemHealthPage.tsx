import { Activity, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAdminApi } from '../hooks/useAdminApi'

interface ServiceCheck {
  service: string
  status: 'healthy' | 'degraded' | 'down'
  latency: string
}

interface HealthData {
  checks: ServiceCheck[]
  timestamp: string
}

const STATUS_CONFIG = {
  healthy: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10', label: 'Healthy' },
  degraded: { icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10', label: 'Degraded' },
  down: { icon: XCircle, color: 'text-danger', bg: 'bg-danger/10', label: 'Down' },
}

export default function SystemHealthPage() {
  const { data, loading } = useAdminApi<HealthData>('system/health', { checks: [], timestamp: '' })
  const checks = data.checks

  const healthyCount = checks.filter((s) => s.status === 'healthy').length

  return (
    <div>
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-ink-muted" />
        <h1 className="text-xl font-semibold text-ink">System Health</h1>
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">
        {loading ? 'Checking...' : `${healthyCount}/${checks.length} services healthy`}
      </p>

      {!loading && checks.length > 0 && (
        <div className={cn(
          'mt-5 flex items-center gap-3 rounded-xl p-4',
          healthyCount === checks.length ? 'bg-success/10' : 'bg-warning/10'
        )}>
          {healthyCount === checks.length ? (
            <>
              <CheckCircle2 size={20} className="text-success" />
              <p className="text-[14px] font-medium text-success">All systems operational</p>
            </>
          ) : (
            <>
              <AlertTriangle size={20} className="text-warning" />
              <p className="text-[14px] font-medium text-warning">
                {checks.length - healthyCount} service(s) experiencing issues
              </p>
            </>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {checks.map((service) => {
          const config = STATUS_CONFIG[service.status] || STATUS_CONFIG.healthy
          const Icon = config.icon
          return (
            <div key={service.service} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-full', config.bg)}>
                  <Icon size={14} className={config.color} />
                </div>
                <p className="text-[13px] font-medium text-ink">{service.service}</p>
              </div>
              <div className="text-right">
                <span className={cn('inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium', config.bg, config.color)}>
                  {config.label}
                </span>
                <p className="mt-0.5 text-[10px] text-ink-subtle">{service.latency}</p>
              </div>
            </div>
          )
        })}
        {loading && <p className="py-6 text-center text-[13px] text-ink-muted">Running health checks...</p>}
        {!loading && checks.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-muted">No health checks configured</p>
        )}
      </div>
    </div>
  )
}
