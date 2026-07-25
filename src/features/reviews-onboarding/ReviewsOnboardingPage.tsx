// The 10-minute reviews onboarding (go.heyelsie.com/onboarding):
// account → upload customers → compliance confirmation → pick a plan (card,
// 10-day trial) → done. Google Business Profile connection happens AFTER
// signup, from the dashboard. Handles the Stripe checkout round-trip.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import Papa from 'papaparse'
import { Upload, ShieldCheck, PartyPopper } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { REVIEW_PLAN_CARDS, PLAN_FEATURES, reviewsApi } from '@/features/reviews/lib'

type Step = 'account' | 'contacts' | 'compliance' | 'plan' | 'software' | 'done'
// Two entry modes into the SAME funnel (Hugo 2026-07-22):
//   onboarding — the normal public signup (account → set-up → pay near the end).
//   subscribe  — the on-the-call close: email-only account, then PAY FIRST,
//                then the rest of the setup. Sent as go.heyelsie.com/subscribe.
type Mode = 'onboarding' | 'subscribe'
const ONBOARDING_STEPS: Step[] = ['account', 'contacts', 'compliance', 'plan', 'software', 'done']
const SUBSCRIBE_STEPS: Step[] = ['account', 'plan', 'contacts', 'compliance', 'software', 'done']
const STEP_LABELS: Record<Step, string> = {
  account: 'Account', contacts: 'Customers', compliance: 'Consent', plan: 'Plan', software: 'Software', done: 'Done',
}

// Job/booking software we ask about after checkout. A known pick promises an
// integration link; 'other' is the none/unknown catch-all.
const SOFTWARE: Array<{ key: string; name: string }> = [
  { key: 'jobber', name: 'Jobber' },
  { key: 'housecall_pro', name: 'Housecall Pro' },
  { key: 'servicetitan', name: 'ServiceTitan' },
  { key: 'quickbooks', name: 'QuickBooks' },
  { key: 'google_contacts', name: 'Google Contacts' },
  { key: 'other', name: 'Something else / none' },
]

const RAIL_BULLETS = [
  ['📈', 'More reviews mean more calls. Buyers pick the business with 400 reviews, not 25'],
  ['⏱', 'Ten minutes to set up, then it runs itself'],
  ['💬', 'Personalised texts and emails your customers actually respond to'],
  ['🤖', 'AI replies to every review for you'],
  ['🛡', 'Built for UK rules, with opt-outs handled automatically'],
  ['⭐', 'Most businesses see their first new reviews within days'],
]

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    if (keys.includes(k.trim().toLowerCase())) return row[k]?.trim() ?? ''
  }
  return ''
}

export default function ReviewsOnboardingPage({ mode = 'onboarding' }: { mode?: Mode }) {
  const [params] = useSearchParams()
  const STEPS = mode === 'subscribe' ? SUBSCRIBE_STEPS : ONBOARDING_STEPS
  const [step, setStep] = useState<Step>('account')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hasSession, setHasSession] = useState(false)

  // Account form (subscribe door prefills from the link the agent sent)
  const [name, setName] = useState(params.get('name') ?? '')
  const [businessName, setBusinessName] = useState(params.get('business') ?? '')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')

  // Contacts
  const fileRef = useRef<HTMLInputElement>(null)
  const [imported, setImported] = useState<number | null>(null)

  // Software (post-checkout) step
  const softwareFileRef = useRef<HTMLInputElement>(null)
  const [crmProvider, setCrmProvider] = useState<string | null>(null)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)

  // Plan
  const [launched, setLaunched] = useState<string | null>(null)

  const stepIndex = STEPS.indexOf(step)

  // Resolve where the user is in the flow (fresh visit or Stripe return).
  // Mode-aware: subscribe pays FIRST (account → plan → pay → rest); onboarding
  // pays near the end. The /continue door lands here already signed in + paid,
  // so it resumes past the plan step automatically.
  useEffect(() => {
    async function resolve() {
      const { data: { session } } = await supabase.auth.getSession()
      setHasSession(!!session)
      if (!session) { setStep('account'); return }
      if (params.get('cancelled') === '1') { setStep('plan'); return }

      const [{ data: settings }, { data: member }] = await Promise.all([
        supabase.from('review_settings').select('attested_at, crm_provider').limit(1).maybeSingle(),
        supabase.from('team_members').select('business_id').eq('user_id', session.user.id).limit(1).maybeSingle(),
      ])
      if (!member) { setStep('account'); return }
      const { data: biz } = await supabase.from('businesses').select('plan').eq('id', member.business_id).single()
      const paid = !!biz?.plan?.startsWith('reviews_')

      if (mode === 'subscribe') {
        // Pay-first: account → plan → (Stripe) → contacts → compliance → software.
        if (params.get('paid') === '1') { setStep('contacts'); return }
        if (!paid) { setStep('plan'); return }
        if (!settings?.attested_at) { setStep('contacts'); return }
        if (!settings?.crm_provider) { setStep('software'); return }
        setStep('done'); return
      }

      // onboarding mode (also where the /continue door lands, already paid).
      if (params.get('paid') === '1') { setStep('software'); return }
      if (!settings?.attested_at) { setStep('contacts'); return }
      if (!paid) { setStep('plan'); return }
      if (!settings?.crm_provider) { setStep('software'); return }
      setStep('done')
    }
    resolve()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createAccount(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const isSub = mode === 'subscribe'
      // Subscribe door: no password field — the customer sets nothing and later
      // signs in with an emailed 6-digit code (/continue). We mint a strong
      // random password server-side so the account exists; they never see it.
      const pw = isSub ? `${crypto.randomUUID()}Aa1!` : password
      const nm = isSub ? (name.trim() || businessName.trim() || email.split('@')[0]) : name
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nm, email, password: pw, businessName,
          product: 'reviews',
          ref: params.get('ref') ?? undefined,
          crm_contact_id: params.get('crm') ?? undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Registration failed')
      await supabase.auth.setSession({ access_token: json.access_token, refresh_token: json.refresh_token })
      setHasSession(true)
      setStep(isSub ? 'plan' : 'contacts')
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  function handleFile(file: File) {
    setError(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data.map((row) => ({
          name: pick(row, ['full name', 'name', 'customer name']) || `${pick(row, ['first name', 'firstname', 'first'])} ${pick(row, ['last name', 'lastname', 'surname'])}`.trim(),
          phone: pick(row, ['phone', 'phone number', 'mobile', 'mobile number', 'tel']),
          email: pick(row, ['email', 'email address', 'e-mail']),
        })).filter((r) => r.phone || r.email)
        if (!rows.length) { setError('No usable rows. The CSV needs a Phone or Email column.'); return }
        try {
          const out = await reviewsApi<{ imported: number }>('/api/contacts/import', { body: { rows } })
          setImported(out.imported ?? rows.length)
        } catch (err) {
          setError((err as Error).message)
        }
      },
      error: () => setError('Could not read that file. Is it a CSV?'),
    })
  }

  async function attest() {
    setBusy(true)
    setError(null)
    try {
      await reviewsApi('/api/reviews/settings', { method: 'PUT', body: { attest: true } })
      // Subscribe mode paid BEFORE compliance, so continue to software — never
      // back to the pay screen (that would invite a second subscription).
      // Matches resolve()'s own subscribe routing.
      setStep(mode === 'subscribe' ? 'software' : 'plan')
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  // Software step: CSV routes to the contacts importer; screenshots/invoices go
  // to the onboarding-upload endpoint for the team to turn into contacts.
  async function handleOnboardingFile(file: File) {
    setError(null)
    if (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')) {
      handleFile(file)
      return
    }
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'onboarding')
      if (crmProvider) fd.append('crm_provider', crmProvider)
      await reviewsApi('/api/reviews/onboarding-upload', { formData: fd })
      setUploadMsg("Uploaded ✓ we'll take it from here")
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function saveSoftware() {
    setBusy(true)
    setError(null)
    try {
      if (crmProvider) await reviewsApi('/api/reviews/settings', { method: 'PUT', body: { crm_provider: crmProvider } })
      setStep('done')
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  async function choosePlan(priceId: string) {
    setBusy(true)
    setError(null)
    try {
      const out = await reviewsApi<{ url: string }>('/api/billing/checkout', { body: { priceId, returnPath: mode === 'subscribe' ? '/subscribe' : '/onboarding' } })
      window.location.href = out.url
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  async function launchFirstCampaign() {
    setBusy(true)
    try {
      const out = await reviewsApi<{ queued: number }>('/api/reviews/campaigns', { body: { type: 'reactivation' } })
      setLaunched(`${out.queued} review requests queued. They'll start dripping out as soon as your sender number is assigned.`)
    } catch (err) {
      setLaunched((err as Error).message)
    }
    setBusy(false)
  }

  const rail = useMemo(() => (
    <div className="hidden w-80 shrink-0 flex-col justify-center bg-brand p-10 text-white lg:flex">
      <h2 className="text-2xl font-bold leading-tight">Let's 4x your Google reviews</h2>
      <ul className="mt-6 space-y-4">
        {RAIL_BULLETS.map(([icon, text]) => (
          <li key={text} className="flex gap-3 text-sm leading-snug text-white/90">
            <span>{icon}</span><span>{text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-xs text-white/70">
        88% of consumers trust online reviews as much as personal recommendations (BrightLocal)
      </p>
    </div>
  ), [])

  return (
    <div className="flex min-h-screen bg-bg">
      {rail}
      <div className="flex flex-1 flex-col items-center px-4 py-10">
        {/* Progress */}
        <div className="mb-8 flex w-full max-w-md items-center gap-1">
          {STEPS.slice(0, 5).map((s, i) => (
            <div key={s} className="flex flex-1 flex-col items-center gap-1">
              <div className={cn('h-1.5 w-full rounded-full', i <= Math.min(stepIndex, 4) ? 'bg-brand' : 'bg-border')} />
              <span className={cn('text-[10px]', i <= stepIndex ? 'text-brand font-medium' : 'text-ink-subtle')}>{STEP_LABELS[s]}</span>
            </div>
          ))}
        </div>

        <div className="w-full max-w-md">
          {step === 'account' && (
            <div>
              <h1 className="text-2xl font-semibold text-ink">
                {mode === 'subscribe' ? 'Start your subscription' : 'Create your account'}
              </h1>
              <p className="mt-1 text-sm text-ink-subtle">10-day free trial · nothing charged for 10 days</p>
              {hasSession ? (
                <div className="mt-6 space-y-3">
                  <p className="text-sm text-ink">You're already signed in.</p>
                  <Button onClick={() => setStep(mode === 'subscribe' ? 'plan' : 'contacts')}>Continue</Button>
                </div>
              ) : (
                <form onSubmit={createAccount} className="mt-6 space-y-3">
                  {mode === 'subscribe' ? (
                    <>
                      <Input placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
                      <Input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
                      <p className="text-xs text-ink-subtle">No password needed — next time you'll sign in with a code we email you.</p>
                    </>
                  ) : (
                    <>
                      <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
                      <Input placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
                      <Input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
                      <Input type="password" placeholder="Choose a password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
                    </>
                  )}
                  <p className="text-xs text-ink-subtle">
                    By continuing you agree to our <a href="https://heyelsie.com/terms" className="underline">terms</a> and{' '}
                    <a href="https://heyelsie.com/privacy" className="underline">privacy policy</a>.
                  </p>
                  <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating…' : mode === 'subscribe' ? 'Continue to payment' : 'Continue'}</Button>
                </form>
              )}
            </div>
          )}

          {step === 'contacts' && (
            <div>
              {mode === 'subscribe' && params.get('paid') === '1' && (
                <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                  🎉 Payment received — your 10-day trial's started. Let's finish setting you up (about 2 minutes).
                </div>
              )}
              <h1 className="text-2xl font-semibold text-ink">Upload your customer list</h1>
              <p className="mt-1 text-sm text-ink-subtle">
                Your past customers are your fastest reviews. Most businesses get 10-15% of them to leave one.
                A CSV export from your job software or spreadsheet works.
              </p>
              <button onClick={() => fileRef.current?.click()}
                className="mt-5 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border p-8 hover:border-brand/50">
                <Upload className="text-ink-subtle" style={{ width: 22, height: 22 }} />
                <span className="text-sm font-medium text-ink">{imported ? `${imported} contacts imported ✓` : 'Upload CSV (name + phone or email)'}</span>
              </button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <div className="mt-4 flex gap-2">
                <Button variant="ghost" onClick={() => setStep('compliance')}>Skip for now</Button>
                <Button className="flex-1" onClick={() => setStep('compliance')} disabled={!imported && false}>Continue</Button>
              </div>
            </div>
          )}

          {step === 'compliance' && (
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-brand" style={{ width: 22, height: 22 }} />
                <h1 className="text-2xl font-semibold text-ink">One legal thing (30 seconds)</h1>
              </div>
              <p className="mt-2 text-sm text-ink-subtle">
                UK rules let us text and email <strong>your own customers</strong> about leaving a review. Please confirm:
              </p>
              <ul className="mt-4 space-y-2 rounded-xl bg-border/30 p-4 text-sm text-ink">
                <li>• These contacts are real customers of your business</li>
                <li>• Their details came from genuine transactions with you</li>
                <li>• They weren't told they'd never be contacted</li>
                <li>• Requests go to ALL customers. We never cherry-pick happy ones (Google policy + UK law)</li>
              </ul>
              <Button className="mt-5 w-full" onClick={attest} disabled={busy}>
                {busy ? 'Recording…' : 'I confirm, continue'}
              </Button>
            </div>
          )}

          {step === 'plan' && (
            <div>
              <h1 className="text-2xl font-semibold text-ink">Choose your plan</h1>
              <p className="mt-1 text-sm text-ink-subtle">Every plan has every feature. Only the monthly request volume differs. 10-day free trial, cancel anytime.</p>
              <div className="mt-5 space-y-3">
                {REVIEW_PLAN_CARDS.map((p) => (
                  <button key={p.key} onClick={() => choosePlan(p.priceId)} disabled={busy}
                    className={cn('relative w-full rounded-2xl border p-4 text-left transition-colors hover:border-brand',
                      p.popular ? 'border-brand bg-brand-50/50' : 'border-border bg-surface')}>
                    {p.popular && <span className="absolute -top-2 right-4 rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-semibold text-white">POPULAR</span>}
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold text-ink">{p.name}</span>
                      <span className="text-lg font-bold text-ink">£{p.price}<span className="text-xs font-normal text-ink-subtle">/mo</span></span>
                    </div>
                    <p className="text-xs text-ink-subtle">{p.requests}</p>
                  </button>
                ))}
              </div>
              <details className="mt-3 text-xs text-ink-subtle">
                <summary className="cursor-pointer font-medium">What's included (every plan)</summary>
                <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {PLAN_FEATURES.map((f) => <li key={f}>✓ {f}</li>)}
                </ul>
              </details>
            </div>
          )}

          {step === 'software' && (
            <div>
              <h1 className="text-2xl font-semibold text-ink">What do you use to run your jobs?</h1>
              <p className="mt-1 text-sm text-ink-subtle">
                So we can auto-request a review after every future job. Pick one, or "something else".
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {SOFTWARE.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setCrmProvider(s.key)}
                    className={cn(
                      'rounded-xl border p-3 text-left text-sm font-medium transition-colors',
                      crmProvider === s.key
                        ? 'border-brand bg-brand-50/50 text-ink'
                        : 'border-border bg-surface text-ink hover:border-brand/50',
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              {crmProvider && crmProvider !== 'other' && (
                <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                  Perfect. We'll prepare your {SOFTWARE.find((s) => s.key === crmProvider)?.name} integration and text you a connection link today or tomorrow.
                </p>
              )}

              <div className="mt-5 rounded-2xl border border-border p-4">
                <p className="text-sm font-medium text-ink">Send your past customers (optional)</p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  A spreadsheet is best. No export? Upload screenshots of your contacts or a few recent invoices and we'll sort it.
                </p>
                <button
                  onClick={() => softwareFileRef.current?.click()}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-4 text-sm font-medium text-ink hover:border-brand/50"
                >
                  <Upload style={{ width: 18, height: 18 }} />
                  {uploadMsg ?? (imported ? `${imported} contacts imported ✓` : 'Upload spreadsheet, screenshots or invoices')}
                </button>
                <input
                  ref={softwareFileRef}
                  type="file"
                  accept=".csv,text/csv,image/png,image/jpeg,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleOnboardingFile(e.target.files[0])}
                />
              </div>

              <div className="mt-4 flex gap-2">
                <Button variant="ghost" onClick={() => setStep('done')}>Skip</Button>
                <Button className="flex-1" onClick={saveSoftware} disabled={busy}>{busy ? 'Saving…' : 'Continue'}</Button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center">
              <PartyPopper className="mx-auto text-brand" style={{ width: 40, height: 40 }} />
              <h1 className="mt-3 text-2xl font-semibold text-ink">You're all set!</h1>
              <p className="mt-2 text-sm text-ink-subtle">
                Your trial has started. Next step: connect your Google Business Profile from your dashboard, so we
                can track new reviews and reply for you. Our team is also assigning your dedicated UK sending
                number (usually same day).
              </p>
              {imported ? (
                <div className="mt-5">
                  <Button onClick={launchFirstCampaign} disabled={busy || !!launched}>
                    {launched ? 'Campaign armed ✓' : busy ? 'Arming…' : `Arm my first campaign (${imported} customers)`}
                  </Button>
                  {launched && <p className="mt-2 text-xs text-emerald-700">{launched}</p>}
                </div>
              ) : (
                <p className="mt-4 text-xs text-ink-subtle">Next: upload your customer list from the dashboard to launch your first reactivation.</p>
              )}
              <a href="/dashboard" className="mt-6 block">
                <Button variant="secondary" className="w-full">Open my dashboard</Button>
              </a>
            </div>
          )}

          {error && <p className="mt-4 text-sm font-medium text-danger">{error}</p>}
        </div>
      </div>
    </div>
  )
}
