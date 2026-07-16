import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, FileText, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Skeleton } from '@/core/ui/Skeleton'

/* Shape of GET /api/public/invoice — coded against the contract, not the app types */
interface PublicInvoice {
  invoice_number: string
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
  line_items: { description: string; amount: number }[]
  subtotal: number
  vat_rate: number
  vat_amount: number
  total: number
  notes: string | null
  due_date: string | null
  paid_at: string | null
  created_at: string
  payment_method: 'bank_transfer' | 'cash' | 'none'
}

interface PublicBusiness {
  name: string
  logo_url: string | null
  phone: string | null
  vat_number: string | null
  bank_details: { account_name: string; sort_code: string; account_number: string; bank_name?: string } | null
}

interface PublicInvoicePayload {
  invoice: PublicInvoice
  business: PublicBusiness
  customer: { name: string } | null
}

const STATUS_CONFIG: Record<PublicInvoice['status'], { icon: typeof FileText; color: string; bg: string; label: string }> = {
  draft: { icon: FileText, color: 'text-ink-muted', bg: 'bg-elevated', label: 'Draft' },
  sent: { icon: Clock, color: 'text-brand', bg: 'bg-brand/10', label: 'Awaiting payment' },
  paid: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10', label: 'Paid' },
  overdue: { icon: AlertCircle, color: 'text-danger', bg: 'bg-danger/10', label: 'Overdue' },
  cancelled: { icon: FileText, color: 'text-ink-muted', bg: 'bg-elevated', label: 'Cancelled' },
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMoney(n: number) {
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatSortCode(code: string) {
  const digits = code.replace(/\D/g, '')
  if (digits.length === 6) return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  return code
}

function PoweredByElsie() {
  return (
    <p className="mt-6 pb-24 text-center text-[12px] text-ink-subtle print:hidden">
      Powered by{' '}
      <a
        href="https://heyelsie.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-brand hover:text-brand-600"
      >
        Elsie
      </a>
    </p>
  )
}

export function InvoicePublicPage() {
  const { slug, code } = useParams<{ slug: string; code: string }>()
  const [data, setData] = useState<PublicInvoicePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!slug || !code) {
      setLoading(false)
      setNotFound(true)
      return
    }
    let cancelled = false
    fetch(`/api/public/invoice?slug=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('not_found')
        return (await res.json()) as PublicInvoicePayload
      })
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setNotFound(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, code])

  useEffect(() => {
    if (data) document.title = `Invoice ${data.invoice.invoice_number} — ${data.business.name}`
  }, [data])

  if (loading) {
    return (
      <div className="min-h-screen bg-page font-sans">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-2/5" />
                <Skeleton className="h-4 w-1/4" />
              </div>
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="mt-8 space-y-3">
              <Skeleton className="w-full" />
              <Skeleton className="w-full" />
              <Skeleton className="w-3/4" />
            </div>
            <div className="mt-8 flex justify-end">
              <Skeleton className="h-8 w-1/3" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-page font-sans">
        <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
          <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
              <FileText size={22} className="text-ink-muted" />
            </div>
            <h1 className="mt-4 text-[18px] font-semibold text-ink">This invoice link isn't valid</h1>
            <p className="mt-2 text-[13px] text-ink-muted">
              The link may have been typed incorrectly or is no longer available. Please check the link, or contact the
              business that sent it to you.
            </p>
          </div>
          <PoweredByElsie />
        </div>
      </div>
    )
  }

  const { invoice, business, customer } = data
  const isPaid = Boolean(invoice.paid_at)
  const status = STATUS_CONFIG[invoice.status] ?? STATUS_CONFIG.draft
  const badge = isPaid ? STATUS_CONFIG.paid : status
  const BadgeIcon = badge.icon
  const bank = invoice.payment_method === 'bank_transfer' ? business.bank_details : null

  return (
    <div className="min-h-screen bg-page font-sans print:bg-white">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12 print:max-w-none print:p-0">
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none">
          {/* Business header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              {business.logo_url ? (
                <img
                  src={business.logo_url}
                  alt={business.name}
                  className="h-12 w-12 rounded-lg border border-border object-contain"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand/10 text-[18px] font-semibold text-brand">
                  {business.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-[16px] font-semibold text-ink">{business.name}</p>
                {business.phone && (
                  <a href={`tel:${business.phone}`} className="text-[13px] text-ink-muted hover:text-ink print:text-ink-muted">
                    {business.phone}
                  </a>
                )}
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Invoice</p>
              <p className="text-[16px] font-semibold text-ink">{invoice.invoice_number}</p>
              <span
                className={cn(
                  'mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
                  badge.bg,
                  badge.color
                )}
              >
                <BadgeIcon size={12} />
                {badge.label}
              </span>
            </div>
          </div>

          {/* Paid banner */}
          {isPaid && (
            <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-success/25 bg-success/10 px-4 py-3">
              <CheckCircle2 size={18} className="shrink-0 text-success" />
              <p className="text-[13px] font-medium text-success">
                Paid in full on {formatDate(invoice.paid_at)} — thank you.
              </p>
            </div>
          )}

          {/* Dates + billed to */}
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Issued</p>
              <p className="mt-0.5 text-[13px] text-ink">{formatDate(invoice.created_at)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Due</p>
              <p className={cn('mt-0.5 text-[13px]', !isPaid && invoice.status === 'overdue' ? 'font-medium text-danger' : 'text-ink')}>
                {formatDate(invoice.due_date)}
              </p>
            </div>
            {customer?.name && (
              <div className="col-span-2 sm:col-span-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Billed to</p>
                <p className="mt-0.5 text-[13px] text-ink">{customer.name}</p>
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="mt-6 border-t border-border pt-2">
            <table className="w-full">
              <thead>
                <tr className="text-left">
                  <th className="py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Description</th>
                  <th className="py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.line_items.map((item, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="py-3 pr-4 text-[13px] text-ink">{item.description}</td>
                    <td className="py-3 text-right text-[13px] font-medium tabular-nums text-ink">
                      {formatMoney(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-2 border-t border-border pt-4">
            <div className="ml-auto w-full max-w-[280px] space-y-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-ink-muted">Subtotal</span>
                <span className="tabular-nums text-ink">{formatMoney(invoice.subtotal)}</span>
              </div>
              {invoice.vat_rate > 0 && (
                <div className="flex justify-between text-[13px]">
                  <span className="text-ink-muted">VAT ({invoice.vat_rate}%)</span>
                  <span className="tabular-nums text-ink">{formatMoney(invoice.vat_amount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2.5">
                <span className="text-[14px] font-semibold text-ink">Total</span>
                <span className="text-[18px] font-bold tabular-nums text-ink">{formatMoney(invoice.total)}</span>
              </div>
            </div>
          </div>

          {/* Bank transfer details */}
          {bank && !isPaid && (
            <div className="mt-6 rounded-xl border border-brand/20 bg-brand-50 p-4 print:border-border print:bg-white">
              <p className="text-[12px] font-semibold text-ink">How to pay — bank transfer</p>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {bank.bank_name && (
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-[12px] text-ink-muted">Bank</dt>
                    <dd className="text-[13px] font-medium text-ink">{bank.bank_name}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="text-[12px] text-ink-muted">Account name</dt>
                  <dd className="text-[13px] font-medium text-ink">{bank.account_name}</dd>
                </div>
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="text-[12px] text-ink-muted">Sort code</dt>
                  <dd className="text-[13px] font-medium tabular-nums text-ink">{formatSortCode(bank.sort_code)}</dd>
                </div>
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="text-[12px] text-ink-muted">Account number</dt>
                  <dd className="text-[13px] font-medium tabular-nums text-ink">{bank.account_number}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[12px] text-ink-muted">
                Please use <span className="font-medium text-ink">{invoice.invoice_number}</span> as the payment reference.
              </p>
            </div>
          )}

          {invoice.payment_method === 'cash' && !isPaid && (
            <div className="mt-6 rounded-xl border border-border bg-elevated p-4 print:bg-white">
              <p className="text-[12px] font-semibold text-ink">Payment method</p>
              <p className="mt-1 text-[13px] text-ink-muted">Cash on completion.</p>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="mt-6 rounded-xl bg-elevated p-4 print:border print:border-border print:bg-white">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Notes</p>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-muted">{invoice.notes}</p>
            </div>
          )}

          {/* Card footer */}
          <div className="mt-8 border-t border-border pt-4 text-[12px] text-ink-subtle">
            <p>
              {business.name}
              {business.vat_number ? ` · VAT No. ${business.vat_number}` : ''}
            </p>
          </div>
        </div>

        <PoweredByElsie />
      </div>

      {/* Sticky download bar */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 px-4 py-3 shadow-pop backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <p className="hidden text-[13px] text-ink-muted sm:block">
            {invoice.invoice_number} · {formatMoney(invoice.total)}
          </p>
          <button
            onClick={() => window.print()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition hover:bg-brand-600 sm:w-auto"
          >
            <Download size={15} />
            Download PDF
          </button>
        </div>
      </div>
    </div>
  )
}
