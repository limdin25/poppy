import { CheckCircle2, XCircle, AlertCircle, Link2Off } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import type { UnsubscribeRow } from '../types'

interface Props {
  rows: UnsubscribeRow[]
  total: number
  loading: boolean
}

const statusConfig = {
  unsubscribed: { icon: CheckCircle2, label: 'Unsubscribed', color: 'text-emerald-600 bg-emerald-50' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-red-500 bg-red-50' },
  attempted: { icon: AlertCircle, label: 'Attempted', color: 'text-amber-600 bg-amber-50' },
  no_link: { icon: Link2Off, label: 'No Link', color: 'text-gray-500 bg-gray-100' },
}

export function UnsubscribeTable({ rows, total, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface shadow-soft overflow-hidden">
        <div className="p-3 border-b border-border">
          <div className="h-5 w-48 skeleton" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4 p-3 border-b border-border/50">
            <div className="h-3 w-24 skeleton" />
            <div className="h-3 w-32 skeleton" />
            <div className="h-3 w-16 skeleton" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-3">
        <p className="text-[13px] font-semibold text-ink">Unsubscribe History</p>
        <span className="text-[11px] text-ink-muted">{total} total</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-[12px] text-ink-muted">No unsubscribe attempts yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-border bg-elevated/50">
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Date</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Sender</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Subject</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Status</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const cfg = statusConfig[row.status]
                const Icon = cfg.icon
                return (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-elevated/30 transition">
                    <td className="px-3 py-2 text-[11px] text-ink-muted whitespace-nowrap">
                      {new Date(row.date).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[160px]">
                        {row.senderName && (
                          <p className="text-[12px] font-medium text-ink truncate">{row.senderName}</p>
                        )}
                        <p className="text-[10px] text-ink-muted truncate">{row.sender}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-muted max-w-[180px] truncate">
                      {row.subject || '-'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium', cfg.color)}>
                        <Icon size={10} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-muted max-w-[200px] truncate">
                      {row.reason}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
