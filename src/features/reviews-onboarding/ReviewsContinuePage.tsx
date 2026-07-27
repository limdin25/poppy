// go.heyelsie.com/continue — where every paying customer lands.
//
// Two audiences, one page:
//   1. Straight off Stripe (?session_id=cs_…). We confirm the payment, tell
//      them it worked, wait for provisioning, then send the sign-in code
//      automatically. They should never have to type anything.
//   2. Coming back later from a link an agent sent (no session_id). Email →
//      code → in.
//
// What this replaced was hostile to someone who had just paid: it ignored
// ?paid entirely (no confirmation of anything), asked them to retype the email
// they'd used seconds earlier on Stripe's page, and — because the webhook is
// async and the redirect is instant — usually showed them a raw GoTrue string
// ("Signups not allowed for otp") because their account didn't exist yet.
//
// NB: the code login needs Supabase Auth's magic-link template to send
// {{ .Token }}. See supabase/templates/magic-link.html — and note that the
// hosted project reads the DASHBOARD copy, not the repo one.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { TRIAL_DAYS } from '@/features/reviews/lib'

type Stage = 'confirming' | 'provisioning' | 'email' | 'code' | 'stuck' | 'expired'

interface SessionStatus {
  paid?: boolean
  ready?: boolean
  expired?: boolean
  email?: string | null
}

const MAX_POLLS = 30          // ~90s across the 2s→5s backoff

export default function ReviewsContinuePage() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')

  const [stage, setStage] = useState<Stage>(sessionId ? 'confirming' : 'email')
  const [email, setEmail] = useState('')
  const [emailLocked, setEmailLocked] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [justPaid, setJustPaid] = useState(false)
  const sentRef = useRef(false)

  /** Ask for the code. NEVER reveals whether the account exists, and never
   *  renders a raw GoTrue message — both of which the old version did. */
  const requestCode = useCallback(async (addr: string) => {
    if (!addr) return
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: addr.trim(),
      options: { shouldCreateUser: false },
    })
    if (otpErr) {
      const detail = `${(otpErr as { code?: string }).code ?? ''} ${otpErr.message}`
      if (otpErr.status === 429 || /rate/i.test(detail)) {
        setNotice("We've already sent you a code — check your inbox and spam. You can ask for another in a minute.")
      } else {
        // Unknown email, or provisioning hasn't landed yet. Stay quiet: telling
        // a stranger which addresses have accounts is an enumeration oracle.
        console.error('[continue] otp send failed:', detail)
      }
    }
    // ALWAYS advance. The old code threw before this line, so a customer whose
    // webhook hadn't landed yet was shown an error seconds after being charged.
    setStage('code')
  }, [])

  // Straight off Stripe: confirm, wait for the account, then send the code.
  useEffect(() => {
    if (!sessionId) return
    let stop = false
    let attempt = 0

    ;(async () => {
      while (!stop && attempt < MAX_POLLS) {
        attempt++
        let data: SessionStatus = {}
        try {
          const res = await fetch(
            `/api/billing/session-status?session_id=${encodeURIComponent(sessionId)}&attempt=${attempt}`,
          )
          data = (await res.json()) as SessionStatus
        } catch {
          // transient — keep polling
        }

        if (data.expired) { setStage('expired'); return }

        if (data.paid) {
          setJustPaid(true)
          if (data.email) { setEmail(data.email); setEmailLocked(true) }
          setStage((s) => (s === 'confirming' ? 'provisioning' : s))
        }

        if (data.paid && data.ready) {
          if (!sentRef.current) {
            sentRef.current = true
            await requestCode(data.email || email)
          }
          return
        }

        await new Promise((r) => setTimeout(r, attempt > 7 ? 5000 : 2000))
      }
      // Never an error loop with no exit — the welcome email is the recovery
      // path, so say so and stop.
      if (!stop) setStage('stuck')
    })()

    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, requestCode])

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    await requestCode(email)
    setBusy(false)
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      })
      if (vErr) throw vErr
      // Onboarding reads payment state from the DB, so no query params needed.
      window.location.href = '/onboarding'
    } catch {
      setError('That code did not match — check the latest email and try again.')
    }
    setBusy(false)
  }

  const paidBanner = justPaid && (
    <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
      <strong>Payment received ✓</strong><br />
      Your {TRIAL_DAYS}-day trial has started{email ? ` for ${email}` : ''}.
    </div>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        {paidBanner}

        {stage === 'confirming' && (
          <>
            <h1 className="text-2xl font-semibold text-ink">Checking your payment…</h1>
            <p className="mt-1 text-sm text-ink-subtle">One moment.</p>
          </>
        )}

        {stage === 'provisioning' && (
          <>
            <h1 className="text-2xl font-semibold text-ink">Setting up your account…</h1>
            <p className="mt-1 text-sm text-ink-subtle">
              This takes about ten seconds. We'll email you a sign-in code the moment it's ready.
            </p>
          </>
        )}

        {stage === 'expired' && (
          <>
            <h1 className="text-2xl font-semibold text-ink">That checkout link expired</h1>
            <p className="mt-1 text-sm text-ink-subtle">
              Nothing was charged. Open your link again to start over, or reply to the text we sent you.
            </p>
          </>
        )}

        {stage === 'stuck' && (
          <>
            <h1 className="text-2xl font-semibold text-ink">You're all paid up</h1>
            <p className="mt-1 text-sm text-ink-subtle">
              Your account is still being set up. We've emailed{email ? ` ${email}` : ' you'} a link to finish.
              If nothing arrives within five minutes, email <a className="underline" href="mailto:hello@heyelsie.com">hello@heyelsie.com</a> and we'll sort it straight away.
            </p>
          </>
        )}

        {stage === 'email' && (
          <>
            <h1 className="text-2xl font-semibold text-ink">Continue your setup</h1>
            <p className="mt-1 text-sm text-ink-subtle">
              Enter the email you subscribed with and we'll send you a 6-digit code.
            </p>
            <form onSubmit={sendCode} className="mt-6 space-y-3">
              <Input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Send me a code'}
              </Button>
            </form>
          </>
        )}

        {stage === 'code' && (
          <>
            <h1 className="text-2xl font-semibold text-ink">Enter your code</h1>
            <p className="mt-1 text-sm text-ink-subtle">
              If <strong>{email}</strong> has an account, a 6-digit code is on its way. Check spam too.
            </p>
            <form onSubmit={verify} className="mt-6 space-y-3">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Checking…' : 'Continue'}
              </Button>
              {!emailLocked && (
                <button
                  type="button"
                  onClick={() => { setStage('email'); setCode(''); setError(null); setNotice(null) }}
                  className="w-full text-xs text-ink-subtle underline"
                >
                  Use a different email
                </button>
              )}
              <a href="/forgot-password" className="block w-full text-center text-xs text-ink-subtle underline">
                Didn't get a code? Set a password instead
              </a>
            </form>
          </>
        )}

        {notice && <p className="mt-4 text-sm text-ink-subtle">{notice}</p>}
        {error && <p className="mt-4 text-sm font-medium text-danger">{error}</p>}
      </div>
    </div>
  )
}
