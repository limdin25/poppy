import { useState } from 'react'
import { Plus, FileText, Send, Download, ExternalLink, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useInvoices } from '@/core/hooks/useInvoices'
import type { Invoice } from '@/core/types/database'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_CONFIG = {
  draft: { icon: FileText, color: 'text-ink-muted', bg: 'bg-elevated', label: 'Draft' },
  sent: { icon: Clock, color: 'text-brand', bg: 'bg-brand/10', label: 'Sent' },
  paid: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10', label: 'Paid' },
  overdue: { icon: AlertCircle, color: 'text-danger', bg: 'bg-danger/10', label: 'Overdue' },
  cancelled: { icon: FileText, color: 'text-ink-muted', bg: 'bg-elevated', label: 'Cancelled' },
}

export default function InvoicesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: invoices, loading } = useInvoices()

  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0)
  const totalOutstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + i.total, 0)

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Invoices</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Track payments and send invoices to customers.</p>
        </div>
        <button className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600">
          <Plus size={14} />
          New invoice
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <p className="text-[13px] text-ink-muted">Total invoiced</p>
          <p className="mt-1 text-[24px] font-semibold text-ink">{"\u00A3"}{(totalPaid + totalOutstanding).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <p className="text-[13px] text-ink-muted">Paid</p>
          <p className="mt-1 text-[24px] font-semibold text-success">{"\u00A3"}{totalPaid.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <p className="text-[13px] text-ink-muted">Outstanding</p>
          <p className="mt-1 text-[24px] font-semibold text-warning">{"\u00A3"}{totalOutstanding.toLocaleString()}</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      ) : invoices.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-ink-muted">No invoices yet</p>
      ) : (
        <div className="mt-6 space-y-3">
          {invoices.map((invoice) => {
            const config = STATUS_CONFIG[invoice.status] ?? STATUS_CONFIG.draft
            const StatusIcon = config.icon
            const contactName = invoice.contact?.name ?? 'Unknown'

            return (
              <div
                key={invoice.id}
                onClick={() => setSelectedId(selectedId === invoice.id ? null : invoice.id)}
                className="cursor-pointer rounded-xl border border-border bg-surface p-4 shadow-soft transition hover:border-brand/20"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', config.bg)}>
                      <StatusIcon size={18} className={config.color} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-medium text-ink">{invoice.invoice_number}</p>
                        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', config.bg, config.color)}>
                          {config.label}
                        </span>
                      </div>
                      <p className="text-[13px] text-ink-muted">{contactName} · Due {formatDate(invoice.due_date)}</p>
                    </div>
                  </div>
                  <p className="text-[16px] font-semibold text-ink">{"\u00A3"}{invoice.total.toLocaleString()}</p>
                </div>

                {selectedId === invoice.id && (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="space-y-2">
                      {(invoice.line_items ?? []).map((item, i) => (
                        <div key={i} className="flex justify-between text-[13px]">
                          <span className="text-ink-muted">{item.description}</span>
                          <span className="font-medium text-ink">{"\u00A3"}{item.amount}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-border pt-2 text-[14px]">
                        <span className="font-semibold text-ink">Total</span>
                        <span className="font-bold text-ink">{"\u00A3"}{invoice.total.toLocaleString()}</span>
                      </div>
                    </div>

                    {invoice.paid_at && (
                      <p className="mt-3 text-[12px] text-success">Paid on {formatDate(invoice.paid_at)}</p>
                    )}

                    <div className="mt-4 flex gap-2">
                      {invoice.status === 'draft' && (
                        <button className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white">
                          <Send size={14} /> Send invoice
                        </button>
                      )}
                      {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                        <button className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white">
                          <ExternalLink size={14} /> Payment link
                        </button>
                      )}
                      <button className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-ink-muted hover:bg-elevated">
                        <Download size={14} /> PDF
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
