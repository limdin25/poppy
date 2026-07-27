import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { SectionCard } from '@/core/ui/SectionCard'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useReviewsSession, reviewsApi, REVIEW_PLANS, PLAN_FEATURES, planCap, requestsLabel, BADGE_LABEL, POUND_ENTRY_GBP, TRIAL_DAYS } from '../lib'

export default function ReviewsBillingPage() {
  const session = useReviewsSession()
  const [plan, setPlan] = useState<string | null>(null)
  const [billingStatus, setBillingStatus] = useState<string | null>(null)
  const [used, setUsed] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const imp = session.impersonating ? session.businessId : null

  useEffect(() => {
    async function load() {
      const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-01`
      const [{ data: biz }, { data: usage }] = await Promise.all([
        supabase.from('businesses').select('plan, billing_status').eq('id', session.businessId).single(),
        supabase.from('review_usage').select('requests_sent').eq('business_id', session.businessId).eq('period_start', period).maybeSingle(),
      ])
      setPlan(biz?.plan ?? null)
      setBillingStatus(biz?.billing_status ?? null)
      setUsed(usage?.requests_sent ?? 0)
    }
    load()
  }, [session.businessId])

  const cap = planCap(plan)
  const pct = Math.min(100, Math.round((used / cap) * 100))
  const onReviewsPlan = plan?.startsWith('reviews_')

  async function choosePlan(priceId: string) {
    setBusy(priceId)
    setMsg(null)
    try {
      const out = await reviewsApi<{ url: string }>('/api/billing/checkout', {
        body: { priceId, returnPath: '/billing' }, impersonateBusinessId: imp,
      })
      window.location.href = out.url
    } catch (err) {
      setMsg((err as Error).message)
      setBusy(null)
    }
  }

  async function openPortal() {
    setBusy('portal')
    try {
      const out = await reviewsApi<{ url: string }>('/api/billing/portal', {
        method: 'POST', body: {}, impersonateBusinessId: imp,
      })
      window.location.href = out.url
    } catch (err) {
      setMsg((err as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Billing</h1>
        <p className="text-sm text-ink-subtle">Your plan, usage and payment details</p>
      </div>

      <SectionCard title="This month's usage">
        <div className="flex items-end justify-between">
          <p className="text-2xl font-semibold text-ink">{used} <span className="text-sm font-normal text-ink-subtle">of {cap} requests</span></p>
          {billingStatus && (
            <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium',
              billingStatus === 'active' ? 'bg-emerald-100 text-emerald-700'
              : billingStatus === 'trialing' ? 'bg-blue-100 text-blue-700'
              : 'bg-amber-100 text-amber-700')}>
              {billingStatus === 'trialing' ? 'Free trial' : billingStatus}
            </span>
          )}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-brand')} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Follow-ups are free and don't count. {pct >= 100
            ? 'You\'ve hit your monthly cap, so sending is paused until you upgrade or the month resets.'
            : pct >= 80 ? 'You\'re close to your cap. Consider upgrading so requests never pause.' : ''}
        </p>
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-3">
        {REVIEW_PLANS.map((p) => {
          const isCurrent = plan === p.key
          return (
            <div key={p.key} className={cn('relative rounded-2xl border bg-surface p-5 shadow-soft',
              p.popular ? 'border-brand' : 'border-border')}>
              {p.popular && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-0.5 text-[11px] font-semibold text-white">
                  {BADGE_LABEL}
                </span>
              )}
              <p className="text-sm font-semibold text-ink">{p.name}</p>
              <p className="mt-1 text-2xl font-bold text-ink">£{p.priceGbp}<span className="text-sm font-normal text-ink-subtle">/mo</span></p>
              <p className="text-xs text-ink-subtle">{requestsLabel(p)}</p>
              <ul className="mt-3 space-y-1">
                {PLAN_FEATURES.slice(0, 6).map((f) => (
                  <li key={f} className="flex items-center gap-1.5 text-xs text-ink">
                    <Check className="text-emerald-500" style={{ width: 12, height: 12 }} /> {f}
                  </li>
                ))}
                <li className="text-xs text-ink-subtle">+ everything else, on every plan</li>
              </ul>
              <Button
                className="mt-4 w-full"
                size="sm"
                variant={isCurrent ? 'secondary' : p.popular ? 'primary' : 'outline'}
                disabled={isCurrent || busy !== null}
                onClick={() => choosePlan(p.stripePriceId)}
              >
                {isCurrent ? 'Current plan' : busy === p.stripePriceId ? 'Redirecting…' : onReviewsPlan ? `Switch to ${p.name}` : `Start for £${POUND_ENTRY_GBP}`}
              </Button>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-ink-subtle">
        Every plan has every feature. The only difference is monthly request volume. Upgrades pro-rate automatically.
        New accounts start at £{POUND_ENTRY_GBP} for the first {TRIAL_DAYS} days.
      </p>

      {onReviewsPlan && (
        <Button variant="secondary" size="sm" onClick={openPortal} disabled={busy !== null}>
          {busy === 'portal' ? 'Opening…' : 'Manage payment method & invoices'}
        </Button>
      )}

      {msg && <p className="text-sm font-medium text-danger">{msg}</p>}
    </div>
  )
}
