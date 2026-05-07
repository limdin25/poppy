import { useState, useEffect } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { getCurrencySymbol } from '@/core/utils/currency'
import type { Currency } from '@/core/utils/currency'
import { AlertTriangle, X } from 'lucide-react'

interface BillingPeriod {
  id: string
  start: string
  end: string
  booking_count: number
  total_amount: number
  total_before_cap: number
  cap_amount: number
  cap_reached: boolean
  currency: Currency
  days_remaining: number
  amount_saved: number
}

interface BookingItem {
  id: string
  created_at: string
  contact_name: string | null
  service_description: string | null
  appointment_datetime: string | null
  channel: string | null
  amount_billed: number
  capped: boolean
  currency: Currency
}

interface PastPeriod {
  id: string
  start: string
  end: string
  booking_count: number
  total_amount: number
  cap_reached: boolean
  currency: Currency
  status: string
  paid_at: string | null
  stripe_invoice_id: string | null
}

const DISPUTE_REASONS = [
  { value: 'ai_error', label: 'AI made an error' },
  { value: 'wrong_time', label: 'Wrong time booked' },
  { value: 'wrong_service', label: 'Wrong service booked' },
  { value: 'duplicate', label: 'Duplicate booking' },
  { value: 'other', label: 'Other' },
] as const

interface DisputeState {
  bookingId: string
  contactName: string | null
  amount: number
}

export default function BillingPage() {
  const { session } = useAuth()
  const [currentPeriod, setCurrentPeriod] = useState<BillingPeriod | null>(null)
  const [isFree, setIsFree] = useState(false)
  const [bookings, setBookings] = useState<BookingItem[]>([])
  const [pastPeriods, setPastPeriods] = useState<PastPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [disputeModal, setDisputeModal] = useState<DisputeState | null>(null)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeDescription, setDisputeDescription] = useState('')
  const [disputeSubmitting, setDisputeSubmitting] = useState(false)
  const [disputedIds, setDisputedIds] = useState<Set<string>>(new Set())

  const accessToken = session?.access_token

  useEffect(() => {
    if (!accessToken) return
    Promise.all([
      fetchUsage(),
      fetchBookings(),
      fetchHistory(),
      fetchDisputes(),
    ]).finally(() => setLoading(false))
  }, [accessToken])

  async function fetchUsage() {
    const res = await fetch('/api/billing/usage', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return
    const data = await res.json()
    setCurrentPeriod(data.current_period)
    setIsFree(data.is_free || false)
  }

  async function fetchBookings() {
    const res = await fetch('/api/billing/bookings', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return
    const data = await res.json()
    setBookings(data.bookings || [])
  }

  async function fetchHistory() {
    const res = await fetch('/api/billing/history', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return
    const data = await res.json()
    setPastPeriods(data.periods || [])
  }

  async function fetchDisputes() {
    const res = await fetch('/api/billing/disputes', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return
    const data = await res.json()
    const ids = new Set<string>((data.disputes || []).map((d: any) => d.booking_event_id))
    setDisputedIds(ids)
  }

  async function submitDispute() {
    if (!disputeModal || !disputeReason) return
    setDisputeSubmitting(true)
    const res = await fetch('/api/billing/disputes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_event_id: disputeModal.bookingId,
        reason: disputeReason,
        description: disputeDescription || undefined,
      }),
    })
    if (res.ok) {
      setDisputedIds(prev => new Set([...prev, disputeModal.bookingId]))
      setDisputeModal(null)
      setDisputeReason('')
      setDisputeDescription('')
    }
    setDisputeSubmitting(false)
  }

  async function openPortal() {
    const res = await fetch('/api/billing/portal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    })
    if (!res.ok) return
    const data = await res.json()
    if (data.url) window.open(data.url, '_blank')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  const sym = getCurrencySymbol(currentPeriod?.currency || 'GBP')

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">Billing</h1>

      {/* Free Plan Banner */}
      {isFree && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[14px] font-semibold text-emerald-800">Free Plan</p>
          <p className="mt-1 text-[13px] text-emerald-700">
            You're on a free plan. The costs below show what you would be charged on a paid plan.
          </p>
        </div>
      )}

      {/* Current Period */}
      {currentPeriod ? (
        <div className="rounded-xl border border-border bg-surface p-5">
          {currentPeriod.cap_reached ? (
            <>
              <p className="text-lg font-semibold text-ink">
                {isFree ? 'Cap would be reached!' : "You've hit your monthly cap!"}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                Elsie booked {currentPeriod.booking_count}+ appointments this month.
                {isFree
                  ? ` On a paid plan, everything past the cap would be free until ${formatDate(currentPeriod.end)}.`
                  : ` Everything is free until ${formatDate(currentPeriod.end)}.`
                }
              </p>
              <div className="mt-4 flex items-center gap-2">
                <div className="h-3 flex-1 rounded-full bg-brand" />
                <span className="text-sm font-medium text-brand">MAXED</span>
              </div>
              <p className="mt-1 text-sm font-medium text-ink">
                {sym}{currentPeriod.total_amount.toFixed(0)} / {sym}{currentPeriod.cap_amount} cap
                {isFree && <span className="ml-2 text-[12px] text-ink-subtle">(simulated)</span>}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-muted">
                  This month {isFree && <span className="text-emerald-600">(simulated)</span>}
                </p>
                <p className="text-sm font-medium text-ink">
                  {sym}{currentPeriod.total_amount.toFixed(0)} / {sym}{currentPeriod.cap_amount} cap
                </p>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-elevated">
                <div
                  className={`h-full rounded-full transition-all ${progressColor(currentPeriod.total_amount, currentPeriod.cap_amount)}`}
                  style={{ width: `${Math.min(100, (currentPeriod.total_amount / currentPeriod.cap_amount) * 100)}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-[13px] text-ink-muted">
                <span>{currentPeriod.booking_count} appointments booked by Elsie</span>
                <span>{currentPeriod.days_remaining} days remaining</span>
              </div>
              <p className="mt-1 text-[12px] text-ink-subtle">
                Billing period: {formatDate(currentPeriod.start)} – {formatDate(currentPeriod.end)}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-5 text-center text-sm text-ink-muted">
          No active billing period. Billing starts when your account is activated.
        </div>
      )}

      {/* Booking List */}
      {bookings.length > 0 && (
        <div className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-ink">
              Bookings {isFree && <span className="text-[12px] font-normal text-ink-subtle">(simulated costs)</span>}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] font-medium text-ink-muted">
                  <th className="px-5 py-2">Date</th>
                  <th className="px-5 py-2">Customer</th>
                  <th className="px-5 py-2 hidden sm:table-cell">Service</th>
                  <th className="px-5 py-2 hidden md:table-cell">Channel</th>
                  <th className="px-5 py-2 text-right">Amount</th>
                  <th className="px-5 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 text-[13px] text-ink-muted">
                      {b.created_at ? formatDateTime(b.created_at) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-[13px] font-medium text-ink">
                      {b.contact_name || 'Customer'}
                    </td>
                    <td className="px-5 py-2.5 text-[13px] text-ink-muted hidden sm:table-cell">
                      {b.service_description || '—'}
                    </td>
                    <td className="px-5 py-2.5 hidden md:table-cell">
                      <span className="inline-flex items-center rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-muted capitalize">
                        {b.channel || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-[13px]">
                      {b.capped ? (
                        <span className="text-ink-subtle">{sym}0.00 <span className="text-[11px]">(cap reached)</span></span>
                      ) : (
                        <span className="font-medium text-ink">{sym}{b.amount_billed.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {disputedIds.has(b.id) ? (
                        <span className="text-[11px] text-amber-600 font-medium">Disputed</span>
                      ) : b.amount_billed > 0 ? (
                        <button
                          onClick={() => setDisputeModal({ bookingId: b.id, contactName: b.contact_name, amount: b.amount_billed })}
                          className="text-[11px] text-ink-subtle hover:text-red-600 transition-colors"
                        >
                          Dispute
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Past Invoices */}
      {pastPeriods.length > 0 && (
        <div className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-ink">Past Invoices</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] font-medium text-ink-muted">
                  <th className="px-5 py-2">Period</th>
                  <th className="px-5 py-2">Bookings</th>
                  <th className="px-5 py-2">Total</th>
                  <th className="px-5 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {pastPeriods.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 text-[13px] text-ink-muted">
                      {formatDate(p.start)} – {formatDate(p.end)}
                    </td>
                    <td className="px-5 py-2.5 text-[13px] text-ink">{p.booking_count}</td>
                    <td className="px-5 py-2.5 text-[13px] font-medium text-ink">
                      {sym}{p.total_amount.toFixed(2)}
                    </td>
                    <td className="px-5 py-2.5">
                      <StatusBadge status={isFree ? 'free' : p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment Method */}
      {!isFree && <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Payment Method</h2>
        <p className="mt-2 text-[13px] text-ink-muted">
          Manage your payment method, view invoices, and download receipts.
        </p>
        <button
          onClick={openPortal}
          className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
        >
          Manage Payment
        </button>
      </div>}

      {/* Dispute Modal */}
      {disputeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500" />
                <h3 className="text-[15px] font-semibold text-ink">Dispute booking</h3>
              </div>
              <button onClick={() => setDisputeModal(null)} className="text-ink-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <p className="mt-2 text-[13px] text-ink-muted">
              Disputing the booking for <strong>{disputeModal.contactName || 'Customer'}</strong> ({sym}{disputeModal.amount.toFixed(2)}).
              We'll review and credit your account if approved.
            </p>

            <div className="mt-4">
              <label className="text-[13px] font-medium text-ink">Reason</label>
              <div className="mt-2 space-y-1.5">
                {DISPUTE_REASONS.map(r => (
                  <label key={r.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="dispute_reason"
                      value={r.value}
                      checked={disputeReason === r.value}
                      onChange={() => setDisputeReason(r.value)}
                      className="accent-brand"
                    />
                    <span className="text-[13px] text-ink">{r.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label className="text-[13px] font-medium text-ink">Details (optional)</label>
              <textarea
                value={disputeDescription}
                onChange={e => setDisputeDescription(e.target.value)}
                placeholder="Tell us what went wrong..."
                rows={3}
                className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink placeholder:text-ink-subtle resize-none focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setDisputeModal(null)}
                className="rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-ink hover:bg-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitDispute}
                disabled={!disputeReason || disputeSubmitting}
                className="rounded-lg bg-red-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {disputeSubmitting ? 'Submitting...' : 'Submit dispute'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function progressColor(amount: number, cap: number): string {
  const pct = (amount / cap) * 100
  if (pct >= 80) return 'bg-brand'
  if (pct >= 50) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700',
    invoiced: 'bg-amber-50 text-amber-700',
    failed: 'bg-red-50 text-red-700',
    void: 'bg-gray-50 text-gray-500',
    free: 'bg-emerald-50 text-emerald-600',
  }
  const labels: Record<string, string> = {
    paid: 'Paid',
    invoiced: 'Pending',
    failed: 'Failed',
    void: 'No charge',
    free: 'Free plan',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status] || styles.void}`}>
      {labels[status] || status}
    </span>
  )
}
