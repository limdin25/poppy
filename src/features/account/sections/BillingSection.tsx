import { useState, useEffect } from 'react'
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'
import { supabase } from '@/integrations/supabase/browser'

interface BillingPeriod {
  id: string
  period_start: string
  period_end: string
  booking_count: number
  total_amount: string
  cap_amount: string
  cap_reached: boolean
  status: string
  currency: string
}

export default function BillingSection() {
  const { session, businessId } = useAuth()
  const { data: business } = useBusiness()
  const [portalLoading, setPortalLoading] = useState(false)
  const [activateLoading, setActivateLoading] = useState(false)
  const [period, setPeriod] = useState<BillingPeriod | null>(null)

  useEffect(() => {
    if (!businessId) return
    supabase
      .from('billing_periods')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'active')
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setPeriod(data as BillingPeriod | null))
  }, [businessId])

  const billingActive = (business as any)?.billing_active
  const currency = (business as any)?.currency || 'GBP'
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£'
  const totalAmount = period ? parseFloat(period.total_amount) || 0 : 0
  const capAmount = period ? parseFloat(period.cap_amount) || 189 : 189
  const bookings = period?.booking_count || 0

  async function handleActivate() {
    if (!session) return
    setActivateLoading(true)
    try {
      const res = await fetch('/api/billing/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.ok) window.location.reload()
    } catch (err) {
      console.error('[billing] activate error:', err)
    } finally {
      setActivateLoading(false)
    }
  }

  async function openPortal() {
    if (!session) return
    setPortalLoading(true)
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch (err) {
      console.error('[billing] portal error:', err)
    } finally {
      setPortalLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Pricing</h2>
        <div className="mt-3 space-y-2 text-[13px] text-ink-muted">
          <p><strong className="text-ink">{symbol}0 setup fee.</strong> No upfront cost — Elsie starts working for free.</p>
          <p><strong className="text-ink">{symbol}20 per booking.</strong> You only pay when Elsie books an appointment into your calendar.</p>
          <p><strong className="text-ink">{symbol}189/month cap.</strong> No matter how many bookings, you never pay more than {symbol}189 per 30-day cycle.</p>
          <p>Calls, messages, and AI replies are always free. You only pay for completed bookings.</p>
        </div>
      </div>

      {billingActive && period && (
        <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
          <h2 className="text-[15px] font-semibold text-ink">Current Billing Period</h2>
          <p className="mt-1 text-[12px] text-ink-muted">
            {new Date(period.period_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — {new Date(period.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-elevated p-3 text-center">
              <p className="text-[22px] font-bold text-ink">{bookings}</p>
              <p className="text-[11px] text-ink-muted">Bookings</p>
            </div>
            <div className="rounded-lg bg-elevated p-3 text-center">
              <p className="text-[22px] font-bold text-ink">{symbol}{totalAmount.toFixed(0)}</p>
              <p className="text-[11px] text-ink-muted">This cycle</p>
            </div>
            <div className="rounded-lg bg-elevated p-3 text-center">
              <p className="text-[22px] font-bold text-ink">{symbol}{capAmount}</p>
              <p className="text-[11px] text-ink-muted">Cap</p>
            </div>
          </div>

          {period.cap_reached && (
            <div className="mt-3 rounded-lg bg-success/10 p-2 text-center text-[12px] font-medium text-success">
              Cap reached — remaining bookings this cycle are free
            </div>
          )}

          <div className="mt-3 h-2 rounded-full bg-elevated overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${Math.min(100, (totalAmount / capAmount) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-right text-[11px] text-ink-subtle">
            {symbol}{totalAmount.toFixed(0)} / {symbol}{capAmount}
          </p>
        </div>
      )}

      {!billingActive && (
        <div className="rounded-xl border border-brand/20 bg-brand-50 p-5">
          <p className="text-[14px] font-semibold text-ink">Free mode</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            Elsie is working for you, but billing is not active yet. Bookings are being tracked.
            Add a payment method to activate billing when you are ready.
          </p>
          <button
            onClick={handleActivate}
            disabled={activateLoading}
            className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {activateLoading ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
            Add payment method
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Invoices & Payment</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          View past invoices, update payment details, or manage your billing.
        </p>
        <button
          onClick={openPortal}
          disabled={portalLoading}
          className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-60"
        >
          {portalLoading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
          Open billing portal
        </button>
      </div>
    </div>
  )
}
