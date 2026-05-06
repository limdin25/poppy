import { useState } from 'react'
import { Plus, FileText, Download, Pencil, CheckCircle2, Clock, AlertCircle, Trash2, Send } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useInvoices } from '@/core/hooks/useInvoices'
import { useInvoiceMutations } from '@/core/hooks/useInvoiceMutations'
import InvoiceFormDialog from './components/InvoiceFormDialog'
import type { Invoice } from '@/core/types/database'

function formatDate(dateStr: string | null) {
  if (!dateStr) return '\u2014'
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
  const [showForm, setShowForm] = useState(false)
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null)
  const { data: invoices, loading, refetch } = useInvoices()
  const { markAsSent, markAsPaid, deleteInvoice, loading: mutating } = useInvoiceMutations(refetch)

  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0)
  const totalOutstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + i.total, 0)

  function openNew() {
    setEditInvoice(null)
    setShowForm(true)
  }

  function openEdit(invoice: Invoice) {
    setEditInvoice(invoice)
    setShowForm(true)
  }

  function handlePrint(invoice: Invoice) {
    const w = window.open('', '_blank')
    if (!w) return
    const items = invoice.line_items ?? []
    const paymentInfo = invoice.payment_method === 'bank_transfer'
      ? `<div style="margin-top:30px;padding:16px;background:#f0f7ff;border-radius:8px;border:1px solid #d0e3ff">
          <p style="font-size:12px;font-weight:600;color:#333;margin:0 0 8px">Payment Details - Bank Transfer</p>
          <p style="font-size:13px;color:#555;margin:0">Please transfer the total amount to the account details provided.</p></div>`
      : invoice.payment_method === 'cash'
      ? `<div style="margin-top:30px;padding:16px;background:#f0fff4;border-radius:8px;border:1px solid #c6f6d5">
          <p style="font-size:12px;font-weight:600;color:#333;margin:0">Payment: Cash</p></div>`
      : ''

    w.document.write(`<!DOCTYPE html><html><head><title>${invoice.invoice_number}</title>
<style>body{font-family:system-ui,sans-serif;padding:40px;max-width:800px;margin:0 auto}
table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #eee}
th{font-size:12px;color:#666;text-transform:uppercase}.header{display:flex;justify-content:space-between;margin-bottom:30px}
.status{display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;background:#f0f0f0}
@media print{body{padding:20px}}</style></head><body>
<div class="header"><div><h1 style="margin:0">${invoice.invoice_number}</h1>
<p style="color:#666">${invoice.contact?.name ?? 'No customer'}</p></div>
<div style="text-align:right"><span class="status">${invoice.status}</span>
<p style="color:#666;font-size:13px">Due: ${formatDate(invoice.due_date)}</p></div></div>
<table><thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>
${items.map(i => `<tr><td>${i.description}</td><td style="text-align:right">\u00A3${i.amount.toFixed(2)}</td></tr>`).join('')}
</tbody></table>
<div style="text-align:right;margin-top:20px">
<p>Subtotal: \u00A3${invoice.subtotal.toFixed(2)}</p>
${invoice.vat_rate > 0 ? `<p>VAT (${invoice.vat_rate}%): \u00A3${invoice.vat_amount.toFixed(2)}</p>` : ''}
<p style="font-size:18px;font-weight:bold">Total: \u00A3${invoice.total.toFixed(2)}</p></div>
${paymentInfo}
${invoice.notes ? `<div style="margin-top:20px;padding:16px;background:#f9f9f9;border-radius:8px"><p style="font-size:13px;color:#666;margin:0">${invoice.notes}</p></div>` : ''}
</body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 300)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Invoices</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Track payments and send invoices to customers.</p>
        </div>
        <button
          onClick={openNew}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
        >
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
                  <div className="mt-4 border-t border-border pt-4" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-2">
                      {(invoice.line_items ?? []).map((item, i) => (
                        <div key={i} className="flex justify-between text-[13px]">
                          <span className="text-ink-muted">{item.description}</span>
                          <span className="font-medium text-ink">{"\u00A3"}{item.amount.toFixed(2)}</span>
                        </div>
                      ))}
                      {invoice.vat_rate > 0 && (
                        <div className="flex justify-between text-[12px] text-ink-muted border-t border-border/50 pt-2">
                          <span>VAT ({invoice.vat_rate}%)</span>
                          <span>{"\u00A3"}{invoice.vat_amount.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border pt-2 text-[14px]">
                        <span className="font-semibold text-ink">Total</span>
                        <span className="font-bold text-ink">{"\u00A3"}{invoice.total.toLocaleString()}</span>
                      </div>
                    </div>

                    {invoice.paid_at && (
                      <p className="mt-3 text-[12px] text-success">Paid on {formatDate(invoice.paid_at)}</p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => openEdit(invoice)}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-ink-muted hover:bg-elevated"
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      {invoice.status === 'draft' && (
                        <button
                          onClick={() => markAsSent(invoice.id)}
                          disabled={mutating}
                          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-60"
                        >
                          <Send size={14} /> Mark as sent
                        </button>
                      )}
                      {(invoice.status === 'sent' || invoice.status === 'overdue') && (
                        <button
                          onClick={() => markAsPaid(invoice.id)}
                          disabled={mutating}
                          className="flex h-9 items-center gap-1.5 rounded-lg bg-success px-3 text-[13px] font-medium text-white disabled:opacity-60"
                        >
                          <CheckCircle2 size={14} /> Mark as paid
                        </button>
                      )}
                      <button
                        onClick={() => handlePrint(invoice)}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-ink-muted hover:bg-elevated"
                      >
                        <Download size={14} /> PDF
                      </button>
                      {invoice.status === 'draft' && (
                        <button
                          onClick={() => deleteInvoice(invoice.id)}
                          disabled={mutating}
                          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-danger hover:bg-danger/10 disabled:opacity-60"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <InvoiceFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={refetch}
        editInvoice={editInvoice}
      />
    </div>
  )
}
