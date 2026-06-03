import { useState } from 'react'
import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'
import { cn } from '@/core/lib/cn'

/**
 * Billing — fixed monthly plans (no per-booking / per-message fees, no credits).
 * Plan selection + card management go through the Stripe billing portal.
 * NOTE: Stripe products/prices must be updated to match (£29 / £49 / £79).
 */

interface Plan {
  id: string
  name: string
  price: number
  tagline: string
  features: string[]
  highlight?: boolean
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    tagline: '1 account · 1 user',
    features: ['1 WhatsApp account', '1 team member', 'Unlimited AI replies', 'Lead capture & qualifying', 'Knowledge base'],
  },
  {
    id: 'team',
    name: 'Team',
    price: 49,
    tagline: '1 account · 3 users',
    features: ['1 WhatsApp account', 'Up to 3 team members', 'Everything in Starter', 'Draft-reply approvals', 'Campaigns & auto follow-up'],
    highlight: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: 79,
    tagline: '3 accounts · 10 users',
    features: ['Up to 3 WhatsApp accounts', 'Up to 10 team members', 'Everything in Team', 'Analytics & CSV export', 'Priority support'],
  },
]

export default function BillingSection() {
  const { session } = useAuth()
  const { data: business } = useBusiness()
  const [portalLoading, setPortalLoading] = useState(false)

  const currentPlan = (business?.plan || 'trial').toLowerCase()
  const onTrial = currentPlan === 'trial' || !PLANS.some((p) => p.id === currentPlan)
  const currency = business?.currency || 'GBP'
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£'

  async function openPortal() {
    if (!session) return
    setPortalLoading(true)
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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
      {onTrial && (
        <div className="rounded-xl border border-brand/20 bg-brand-50 p-4">
          <p className="text-[14px] font-semibold text-ink">You're on the free trial</p>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Pick a plan below to keep Elsie answering once your trial ends.
          </p>
        </div>
      )}

      <div>
        <h2 className="text-[15px] font-semibold text-ink">Plans</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Simple monthly pricing — no per-message or per-booking fees, ever.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {PLANS.map((p) => {
            const isCurrent = !onTrial && currentPlan === p.id
            return (
              <div
                key={p.id}
                className={cn(
                  'flex flex-col rounded-2xl border bg-surface p-5 shadow-soft',
                  isCurrent ? 'border-accent ring-1 ring-accent' : p.highlight ? 'border-ink-subtle/40' : 'border-border',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-ink">{p.name}</h3>
                  {isCurrent ? (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white">
                      Current
                    </span>
                  ) : p.highlight ? (
                    <span className="rounded-full bg-elevated px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
                      Popular
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 text-[28px] font-bold leading-none text-ink">
                  {symbol}{p.price}
                  <span className="text-[13px] font-normal text-ink-subtle"> /mo</span>
                </p>
                <p className="mt-1 text-[12px] text-ink-subtle">{p.tagline}</p>

                <ul className="mt-4 flex-1 space-y-1.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-[12.5px] text-ink-muted">
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={openPortal}
                  disabled={isCurrent || portalLoading}
                  className={cn(
                    'mt-5 flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold transition disabled:opacity-60',
                    isCurrent
                      ? 'cursor-default border border-border bg-elevated text-ink-muted'
                      : 'bg-accent text-white hover:opacity-90',
                  )}
                >
                  {portalLoading && !isCurrent ? <Loader2 size={14} className="animate-spin" /> : null}
                  {isCurrent ? 'Current plan' : `Choose ${p.name}`}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Payment & invoices</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Update your card, download invoices, or change your plan.
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
