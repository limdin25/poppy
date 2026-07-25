// Add-Business wizard (/business/add): connect → select → plan → confirm.
// Google is connected through the existing Zernio flow (Zernio hosts the OAuth +
// location picker), so "select" confirms the connected location rather than
// listing them. Creation happens up-front (a draft business made active) so the
// Zernio connect can attach to it; Confirm records the plan and opens the dashboard.
import { useEffect, useReducer, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Star } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { cn } from '@/core/lib/cn'
import { reviewsApi, REVIEW_PLAN_CARDS } from '../lib'
import { wizardReducer, canAdvance, initialWizard, STEPS, stepIndex } from '../add-business-machine'

const STEP_LABELS: Record<string, string> = { connect: 'Connect', select: 'Select', plan: 'Plan', confirm: 'Confirm' }

function Stepper({ current }: { current: string }) {
  const idx = stepIndex(current as never)
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <div className={cn('grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-bold',
              i < idx ? 'border-brand bg-brand text-white' : i === idx ? 'border-brand bg-brand text-white' : 'border-border text-ink-subtle')}>
              {i < idx ? <Check style={{ width: 15, height: 15 }} /> : i + 1}
            </div>
            <span className={cn('text-[11px] font-medium', i <= idx ? 'text-ink' : 'text-ink-subtle')}>{STEP_LABELS[s]}</span>
          </div>
          {i < STEPS.length - 1 && <div className={cn('mx-1 h-0.5 flex-1', i < idx ? 'bg-brand' : 'bg-border')} />}
        </div>
      ))}
    </div>
  )
}

export default function AddBusinessPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [state, dispatch] = useReducer(wizardReducer, initialWizard)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  // Returning from the Zernio OAuth redirect: finish the connection. The draft
  // business id rode along in the redirect (?draft=), so we complete against it
  // explicitly (never the user's live active business).
  useEffect(() => {
    if (params.get('connected') !== 'googlebusiness') return
    const accountId = params.get('accountId')
    const profileId = params.get('profileId')
    const draft = params.get('draft')
    async function finish() {
      if (!accountId || !profileId || !draft) { dispatch({ type: 'oauthFailed', error: 'Google connection was cancelled.' }); setParams({}, { replace: true }); return }
      setBusy(true)
      try {
        const out = await reviewsApi<{ locationName: string | null }>('/api/reviews/connect-complete', { body: { profileId, accountId, business_id: draft } })
        dispatch({ type: 'connected', businessId: draft, locationName: out.locationName })
      } catch (e) {
        dispatch({ type: 'oauthFailed', error: (e as Error).message })
      } finally {
        setBusy(false)
        setParams({}, { replace: true })
      }
    }
    finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect() {
    setBusy(true)
    dispatch({ type: 'error', error: '' })
    try {
      const created = await reviewsApi<{ businessId: string }>('/api/reviews/businesses', { method: 'POST', body: { action: 'create', name: name.trim() || 'New business' } })
      const draft = created.businessId
      const out = await reviewsApi<{ authUrl: string }>('/api/reviews/connect', { body: { return_to: `/business/add?draft=${draft}`, business_id: draft } })
      window.location.href = out.authUrl
    } catch (e) {
      dispatch({ type: 'oauthFailed', error: (e as Error).message })
      setBusy(false)
    }
  }

  async function confirm() {
    if (!state.businessId) return
    setBusy(true)
    try {
      // Activate the draft, then take payment through the standard reviews
      // checkout (10-day trial + card) — no free paid-tier access.
      await reviewsApi('/api/reviews/businesses', { method: 'POST', body: { action: 'finalize', business_id: state.businessId } })
      const priceId = REVIEW_PLAN_CARDS.find((p) => p.key === state.plan)?.priceId
      if (priceId) {
        const out = await reviewsApi<{ url: string }>('/api/billing/checkout', { body: { priceId, returnPath: '/dashboard' } })
        window.location.href = out.url
      } else {
        navigate('/dashboard')
      }
    } catch (e) {
      dispatch({ type: 'error', error: (e as Error).message })
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-sm font-medium text-ink-subtle hover:text-ink">
        <ArrowLeft style={{ width: 16, height: 16 }} /> Back
      </button>
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Add Business</h1>
        <p className="text-sm text-ink-subtle">Connect a new Google Business Profile location.</p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <Stepper current={state.step} />
        {state.error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-danger">{state.error}</p>}

        {/* Step 1 · Connect */}
        {state.step === 'connect' && (
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full border border-border text-2xl font-bold text-[#4285F4]">G</div>
            <h2 className="text-lg font-semibold text-ink">Connect to Google</h2>
            <p className="max-w-sm text-sm text-ink-subtle">Connect your Google account to access your Business Profile locations. We only request permission to manage your business information.</p>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name (optional — we'll use your Google name)" className="max-w-sm" />
            <Button onClick={connect} disabled={busy} className="mt-1">{busy ? 'Opening Google…' : 'Connect with Google'}</Button>
          </div>
        )}

        {/* Step 2 · Select (Zernio already picked the location) */}
        {state.step === 'select' && (
          <div className="mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-ink">Confirm your location</h2>
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <Check className="text-emerald-600" style={{ width: 18, height: 18 }} />
              <div>
                <p className="text-sm font-semibold text-emerald-800">{state.locationName ?? 'Google Business Profile connected'}</p>
                <p className="text-xs text-emerald-700">Connected via Google. This is the location we'll manage reviews for.</p>
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => dispatch({ type: 'back' })}>Back</Button>
              <Button disabled={!canAdvance(state)} onClick={() => dispatch({ type: 'next' })}>Continue</Button>
            </div>
          </div>
        )}

        {/* Step 3 · Plan */}
        {state.step === 'plan' && (
          <div className="mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-ink">Choose a plan</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {REVIEW_PLAN_CARDS.map((p) => (
                <button key={p.key} onClick={() => dispatch({ type: 'selectPlan', plan: p.key })}
                  className={cn('rounded-xl border p-3 text-left', state.plan === p.key ? 'border-brand bg-brand-50' : 'border-border hover:border-ink-subtle/50')}>
                  <p className="text-sm font-semibold text-ink">{p.name}{p.popular && <span className="ml-1 text-[10px] font-bold text-brand">POPULAR</span>}</p>
                  <p className="text-lg font-black text-ink">£{p.price}<span className="text-xs font-medium text-ink-subtle">/mo</span></p>
                  <p className="text-xs text-ink-subtle">{p.requests}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => dispatch({ type: 'back' })}>Back</Button>
              <Button disabled={!canAdvance(state)} onClick={() => dispatch({ type: 'next' })}>Continue</Button>
            </div>
          </div>
        )}

        {/* Step 4 · Confirm */}
        {state.step === 'confirm' && (
          <div className="mt-6 space-y-4">
            <h2 className="text-lg font-semibold text-ink">Review &amp; finish</h2>
            <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
              <div className="flex justify-between"><span className="text-ink-subtle">Location</span><span className="font-medium text-ink">{state.locationName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-ink-subtle">Plan</span><span className="font-medium text-ink">{REVIEW_PLAN_CARDS.find((p) => p.key === state.plan)?.name ?? '—'}</span></div>
              <div className="flex items-center gap-1 text-emerald-700"><Star style={{ width: 13, height: 13 }} className="fill-emerald-500 text-emerald-500" /> Google connected</div>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => dispatch({ type: 'back' })}>Back</Button>
              <Button disabled={busy} onClick={confirm}>{busy ? 'Finishing…' : 'Confirm &amp; open dashboard'}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
