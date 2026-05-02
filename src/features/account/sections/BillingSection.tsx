import { Check, CreditCard, ExternalLink } from 'lucide-react'
import { cn } from '@/core/lib/cn'

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '£49',
    period: '/month',
    features: ['Unlimited voice calls', '1 team member', '30-day call recordings', 'Email notifications'],
    current: false,
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '£99',
    period: '/month',
    features: ['Everything in Starter', 'SMS follow-ups', 'WhatsApp channel', '3 team members', '90-day recordings'],
    current: true,
    badge: 'Current plan',
  },
  {
    id: 'business',
    name: 'Business',
    price: '£199',
    period: '/month',
    features: ['Everything in Professional', 'Email channel', 'Unlimited team', '1-year recordings', 'Priority support'],
    current: false,
  },
]

export default function BillingSection() {
  return (
    <div className="space-y-6">
      {/* Current plan status */}
      <div className="rounded-xl border border-brand/20 bg-brand-50 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[14px] font-semibold text-ink">Free Trial</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">6 days remaining · Expires 7 May 2026</p>
          </div>
          <span className="rounded-lg bg-brand/10 px-3 py-1 text-[12px] font-semibold text-brand">
            Trial
          </span>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              'rounded-xl border p-5 transition',
              plan.current ? 'border-brand bg-surface shadow-soft' : 'border-border bg-surface'
            )}
          >
            {plan.badge && (
              <span className="mb-3 inline-block rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                {plan.badge}
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
              className={cn(
                'mt-5 h-10 w-full rounded-lg text-[13px] font-semibold transition',
                plan.current
                  ? 'border border-border text-ink-muted'
                  : 'bg-brand text-white hover:bg-brand-600'
              )}
              disabled={plan.current}
            >
              {plan.current ? 'Current plan' : 'Upgrade'}
            </button>
          </div>
        ))}
      </div>

      {/* Payment method */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Payment Method</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          No payment method on file. Add one before your trial ends.
        </p>
        <button className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white transition hover:bg-brand-600">
          <CreditCard size={14} />
          Add payment method
        </button>
      </div>

      {/* Billing portal */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Invoices & Billing Portal</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          View past invoices, update payment details, or cancel your subscription.
        </p>
        <button className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-muted transition hover:bg-elevated">
          <ExternalLink size={14} />
          Open billing portal
        </button>
      </div>
    </div>
  )
}
