import { Activity, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface ServiceStatus {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  latency: string
  lastCheck: string
  details: string
}

const MOCK_SERVICES: ServiceStatus[] = [
  { name: 'Supabase (Database)', status: 'healthy', latency: '12ms', lastCheck: '30s ago', details: 'All queries responding normally' },
  { name: 'Supabase (Auth)', status: 'healthy', latency: '45ms', lastCheck: '30s ago', details: 'Sign-in and magic links working' },
  { name: 'Retell AI (Voice)', status: 'healthy', latency: '180ms', lastCheck: '1 min ago', details: 'All agents responding, 0 failures in last hour' },
  { name: 'Twilio (Telephony)', status: 'healthy', latency: '95ms', lastCheck: '1 min ago', details: 'SIP trunks connected, SMS delivery normal' },
  { name: 'Stripe (Billing)', status: 'healthy', latency: '120ms', lastCheck: '2 min ago', details: 'Webhooks processing, no failed payments' },
  { name: 'Unipile (WhatsApp/Email)', status: 'degraded', latency: '450ms', lastCheck: '1 min ago', details: 'Higher than normal latency on WhatsApp messages' },
  { name: 'OpenAI (GPT-4o)', status: 'healthy', latency: '320ms', lastCheck: '30s ago', details: 'Token usage normal, no rate limiting' },
  { name: 'Resend (Email)', status: 'healthy', latency: '85ms', lastCheck: '5 min ago', details: 'All transactional emails delivered' },
  { name: 'Cal.com (Booking)', status: 'healthy', latency: '200ms', lastCheck: '3 min ago', details: 'API responding, availability checks working' },
  { name: 'Vercel (Hosting)', status: 'healthy', latency: '8ms', lastCheck: '10s ago', details: 'All serverless functions warm' },
]

const STATUS_CONFIG = {
  healthy: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10', label: 'Healthy' },
  degraded: { icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10', label: 'Degraded' },
  down: { icon: XCircle, color: 'text-danger', bg: 'bg-danger/10', label: 'Down' },
}

export default function SystemHealthPage() {
  const healthyCount = MOCK_SERVICES.filter((s) => s.status === 'healthy').length

  return (
    <div>
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-ink-muted" />
        <h1 className="text-xl font-semibold text-ink">System Health</h1>
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">
        {healthyCount}/{MOCK_SERVICES.length} services healthy
      </p>

      {/* Overall status */}
      <div className={cn(
        'mt-5 flex items-center gap-3 rounded-xl p-4',
        healthyCount === MOCK_SERVICES.length ? 'bg-success/10' : 'bg-warning/10'
      )}>
        {healthyCount === MOCK_SERVICES.length ? (
          <>
            <CheckCircle2 size={20} className="text-success" />
            <p className="text-[14px] font-medium text-success">All systems operational</p>
          </>
        ) : (
          <>
            <AlertTriangle size={20} className="text-warning" />
            <p className="text-[14px] font-medium text-warning">
              {MOCK_SERVICES.length - healthyCount} service(s) experiencing issues
            </p>
          </>
        )}
      </div>

      {/* Service list */}
      <div className="mt-4 space-y-2">
        {MOCK_SERVICES.map((service) => {
          const config = STATUS_CONFIG[service.status]
          const Icon = config.icon
          return (
            <div key={service.name} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-full', config.bg)}>
                  <Icon size={14} className={config.color} />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-ink">{service.name}</p>
                  <p className="text-[11px] text-ink-muted">{service.details}</p>
                </div>
              </div>
              <div className="text-right">
                <span className={cn('inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium', config.bg, config.color)}>
                  {config.label}
                </span>
                <p className="mt-0.5 text-[10px] text-ink-subtle">
                  {service.latency} · {service.lastCheck}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
