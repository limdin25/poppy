import { useState } from 'react'
import { Check, CreditCard, ExternalLink, Loader2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '£49',
    period: '/month',
    priceId: 'price_1TTj1DLdAEhwWg6w9uuBcjJl',
    features: ['Unlimited voice calls', '1 team member', '30-day call recordings', 'Email notifications'],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '£99',
    period: '/month',
    priceId: 'price_1TTj1DLdAEhwWg6wERoybYsY',
    features: ['Everything in Starter', 'SMS follow-ups', 'WhatsApp channel', '3 team members', '90-day recordings'],
  },
  {
    id: 'business',
    name: 'Business',
    price: '£199',
    period: '/month',
    priceId: 'price_1TTj1DLdAEhwWg6w2l8IOzJ9',
    features: ['Everything in Professional', 'Email channel', 'Unlimited team', '1-year recordings', 'Priority support'],
  },
]

function getTrialInfo(createdAt: string | undefined) {
  if (!createdAt) return { daysLeft: 0, expiresLabel: '' }
  const created = new Date(createdAt)
  const expires = new Date(created.getTime() + 14 * 24 * 60 * 60 * 1000)
  const now = new Date()
  const daysLeft = Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
  const expiresLabel = expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return { daysLeft, expiresLabel }
}

export default function BillingSection() {
  const { session } = useAuth()
  const { data: business } = useBusiness()
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  const currentPlan = (business as any)?.plan || 'trial'
  const { daysLeft, expiresLabel } = getTrialInfo(business?.created_at)

  async function handleUpgrade(priceId: string, planId: string) {
    if (!session) return
    setLoadingPlan(planId)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ priceId }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch (err) {
      console.error('[billing] checkout error:', err)
    } finally {
      setLoadingPlan(null)
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
      {currentPlan === 'trial' && (
        <div className="rounded-xl border border-brand/20 bg-brand-50 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] font-semibold text-ink">Free Trial</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining · Expires {expiresLabel}
              </p>
            </div>
            <span className="rounded-lg bg-brand/10 px-3 py-1 text-[12px] font-semibold text-brand">
              Trial
            </span>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id
          return (
            <div
              key={plan.id}
              className={cn(
                'rounded-xl border p-5 transition',
                isCurrent ? 'border-brand bg-surface shadow-soft' : 'border-border bg-surface'
              )}
            >
              {isCurrent && (
                <span className="mb-3 inline-block rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                  Current plan
                </span>
              )}
              <h3 className="text-[16px] font-semibold text-ink">{plan.name}</h3>
              <div className="mt-2 flex items-baseline gap-0.5">
                <span className="text-[28px] font-bold text-ink">{plan.price}</span>
                <span className="text-[14px] text-ink-muted">{plan.period}</span>
              </div>

              <ul className="mt-4 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-[13px] text-ink-muted">
                    <Check size={14} className="shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => !isCurrent && handleUpgrade(plan.priceId, plan.id)}
                disabled={isCurrent || loadingPlan === plan.id}
                className={cn(
                  'mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-semibold transition',
                  isCurrent
                    ? 'border border-border text-ink-muted'
                    : 'bg-brand text-white hover:bg-brand-600 disabled:opacity-60'
                )}
              >
                {loadingPlan === plan.id && <Loader2 size={14} className="animate-spin" />}
                {isCurrent ? 'Current plan' : 'Upgrade'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Payment Method</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Manage your payment method through the billing portal.
        </p>
        <button
          onClick={openPortal}
          disabled={portalLoading}
          className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {portalLoading ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
          Add payment method
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Invoices & Billing Portal</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          View past invoices, update payment details, or cancel your subscription.
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
