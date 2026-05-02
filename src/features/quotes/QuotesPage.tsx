import { useState } from 'react'
import { Plus, FileText, Send, Download } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useQuotes } from '@/core/hooks/useQuotes'
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
  const { data: quotes, loading } = useQuotes()

  const totalQuoted = quotes.reduce((s, q) => s + q.total, 0)
  const totalAccepted = quotes.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total, 0)
  const totalPending = quotes.filter(q => q.status === 'sent' || q.status === 'draft').reduce((s, q) => s + q.total, 0)

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Quotes</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Create and manage quotes for your customers.</p>
        </div>
        <button className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600">
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QuoteCard({ quote, expanded, onToggle }: { quote: Quote; expanded: boolean; onToggle: () => void }) {
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
        <div className="mt-4 border-t border-border pt-4">
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
              <tr className="border-t border-border">
                <td colSpan={3} className="pt-2 text-right font-semibold text-ink">Total</td>
                <td className="pt-2 text-right text-[15px] font-bold text-ink">{"\u00A3"}{quote.total.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-4 flex gap-2">
            {quote.status === 'draft' && (
              <button className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white">
                <Send size={14} /> Send to customer
              </button>
            )}
            <button className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-ink-muted hover:bg-elevated">
              <Download size={14} /> Download PDF
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
