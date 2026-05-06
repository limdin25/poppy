import { useState } from 'react'
import { Plus, FileText, Download, Pencil, ArrowRightLeft, Trash2, Send, CheckCircle2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useQuotes } from '@/core/hooks/useQuotes'
import { useQuoteMutations } from '@/core/hooks/useQuoteMutations'
import QuoteFormDialog from './components/QuoteFormDialog'
import type { Quote } from '@/core/types/database'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_STYLES = {
  draft: 'bg-elevated text-ink-muted',
  sent: 'bg-brand/10 text-brand',
  accepted: 'bg-success/10 text-success',
  rejected: 'bg-danger/10 text-danger',
  expired: 'bg-warning/10 text-warning',
}

export default function QuotesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editQuote, setEditQuote] = useState<Quote | null>(null)
  const { data: quotes, loading, refetch } = useQuotes()
  const { deleteQuote, convertToInvoice, markAsSent, markAsAccepted, loading: mutating } = useQuoteMutations(refetch)

  const totalQuoted = quotes.reduce((s, q) => s + q.total, 0)
  const totalAccepted = quotes.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total, 0)
  const totalPending = quotes.filter(q => q.status === 'sent' || q.status === 'draft').reduce((s, q) => s + q.total, 0)

  function openNew() {
    setEditQuote(null)
    setShowForm(true)
  }

  function openEdit(quote: Quote) {
    setEditQuote(quote)
    setShowForm(true)
  }

  function handlePrint(quote: Quote) {
    const w = window.open('', '_blank')
    if (!w) return
    const items = quote.line_items ?? []
    w.document.write(`<!DOCTYPE html><html><head><title>${quote.quote_number}</title>
<style>body{font-family:system-ui,sans-serif;padding:40px;max-width:800px;margin:0 auto}
table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #eee}
th{font-size:12px;color:#666;text-transform:uppercase}.total-row td{border-top:2px solid #333;font-weight:bold}
.header{display:flex;justify-content:space-between;margin-bottom:30px}.status{display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;background:#f0f0f0}
@media print{body{padding:20px}}</style></head><body>
<div class="header"><div><h1 style="margin:0">${quote.quote_number}</h1>
<p style="color:#666">${quote.contact?.name ?? 'No customer'}</p></div>
<div style="text-align:right"><span class="status">${quote.status}</span>
<p style="color:#666;font-size:13px">${formatDate(quote.created_at)}</p>
${quote.valid_until ? `<p style="color:#666;font-size:13px">Valid until: ${formatDate(quote.valid_until)}</p>` : ''}</div></div>
<table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>
${items.map(i => `<tr><td>${i.description}</td><td>${i.qty}</td><td>\u00A3${i.unit_price.toFixed(2)}</td><td>\u00A3${(i.qty * i.unit_price).toFixed(2)}</td></tr>`).join('')}
</tbody></table>
<div style="text-align:right;margin-top:20px">
<p>Subtotal: \u00A3${quote.subtotal.toFixed(2)}</p>
${quote.vat_rate > 0 ? `<p>VAT (${quote.vat_rate}%): \u00A3${quote.vat_amount.toFixed(2)}</p>` : ''}
<p style="font-size:18px;font-weight:bold">Total: \u00A3${quote.total.toFixed(2)}</p></div>
${quote.notes ? `<div style="margin-top:30px;padding:16px;background:#f9f9f9;border-radius:8px"><p style="font-size:13px;color:#666;margin:0">${quote.notes}</p></div>` : ''}
</body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 300)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Quotes</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Create and manage quotes for your customers.</p>
        </div>
        <button
          onClick={openNew}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
        >
          <Plus size={14} />
          New quote
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <p className="text-[13px] text-ink-muted">Total quoted</p>
          <p className="mt-1 text-[24px] font-semibold text-ink">{"\u00A3"}{totalQuoted.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <p className="text-[13px] text-ink-muted">Accepted</p>
          <p className="mt-1 text-[24px] font-semibold text-success">{"\u00A3"}{totalAccepted.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <p className="text-[13px] text-ink-muted">Pending</p>
          <p className="mt-1 text-[24px] font-semibold text-brand">{"\u00A3"}{totalPending.toLocaleString()}</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      ) : quotes.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-ink-muted">No quotes yet</p>
      ) : (
        <div className="mt-6 space-y-3">
          {quotes.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              expanded={selectedId === quote.id}
              onToggle={() => setSelectedId(selectedId === quote.id ? null : quote.id)}
              onEdit={() => openEdit(quote)}
              onDelete={() => deleteQuote(quote.id)}
              onConvert={() => convertToInvoice(quote.id)}
              onMarkSent={() => markAsSent(quote.id)}
              onMarkAccepted={() => markAsAccepted(quote.id)}
              onPrint={() => handlePrint(quote)}
              mutating={mutating}
            />
          ))}
        </div>
      )}

      <QuoteFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={refetch}
        editQuote={editQuote}
      />
    </div>
  )
}

function QuoteCard({
  quote, expanded, onToggle, onEdit, onDelete, onConvert, onMarkSent, onMarkAccepted, onPrint, mutating
}: {
  quote: Quote; expanded: boolean; onToggle: () => void
  onEdit: () => void; onDelete: () => void; onConvert: () => void
  onMarkSent: () => void; onMarkAccepted: () => void; onPrint: () => void; mutating: boolean
}) {
  const contactName = quote.contact?.name ?? 'Unknown'
  const items = quote.line_items ?? []

  return (
    <div
      onClick={onToggle}
      className="cursor-pointer rounded-xl border border-border bg-surface p-4 shadow-soft transition hover:border-brand/20"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-elevated">
            <FileText size={18} className="text-ink-muted" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-medium text-ink">{quote.quote_number}</p>
              <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium capitalize', STATUS_STYLES[quote.status])}>
                {quote.status}
              </span>
            </div>
            <p className="text-[13px] text-ink-muted">{contactName} · {formatDate(quote.created_at)}</p>
          </div>
        </div>
        <p className="text-[16px] font-semibold text-ink">{"\u00A3"}{quote.total.toLocaleString()}</p>
      </div>

      {expanded && items.length > 0 && (
        <div className="mt-4 border-t border-border pt-4" onClick={(e) => e.stopPropagation()}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-ink-subtle">
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 text-right font-medium">Qty</th>
                <th className="pb-2 text-right font-medium">Price</th>
                <th className="pb-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="py-2 text-ink">{item.description}</td>
                  <td className="py-2 text-right text-ink-muted">{item.qty}</td>
                  <td className="py-2 text-right text-ink-muted">{"\u00A3"}{item.unit_price}</td>
                  <td className="py-2 text-right font-medium text-ink">{"\u00A3"}{(item.qty * item.unit_price).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {quote.vat_rate > 0 && (
                <tr className="border-t border-border">
                  <td colSpan={3} className="pt-2 text-right text-[12px] text-ink-muted">VAT ({quote.vat_rate}%)</td>
                  <td className="pt-2 text-right text-[12px] text-ink-muted">{"\u00A3"}{quote.vat_amount.toFixed(2)}</td>
                </tr>
              )}
              <tr className="border-t border-border">
                <td colSpan={3} className="pt-2 text-right font-semibold text-ink">Total</td>
                <td className="pt-2 text-right text-[15px] font-bold text-ink">{"\u00A3"}{quote.total.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={onEdit}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-ink-muted hover:bg-elevated"
            >
              <Pencil size={14} /> Edit
            </button>
            {quote.status === 'draft' && (
              <button
                onClick={onMarkSent}
                disabled={mutating}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <Send size={14} /> Mark as sent
              </button>
            )}
            {quote.status === 'sent' && (
              <button
                onClick={onMarkAccepted}
                disabled={mutating}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-success px-3 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <CheckCircle2 size={14} /> Mark as accepted
              </button>
            )}
            {(quote.status === 'sent' || quote.status === 'accepted') && (
              <button
                onClick={onConvert}
                disabled={mutating}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white disabled:opacity-60"
              >
                <ArrowRightLeft size={14} /> Convert to invoice
              </button>
            )}
            <button
              onClick={onPrint}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-ink-muted hover:bg-elevated"
            >
              <Download size={14} /> PDF
            </button>
            {quote.status === 'draft' && (
              <button
                onClick={onDelete}
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
}
