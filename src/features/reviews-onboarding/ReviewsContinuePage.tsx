// ReviewsContinuePage (go.heyelsie.com/continue) — the "already paid, come
// back to finish setup" door (Hugo 2026-07-22). The customer paid on the call
// via /subscribe; the agent sends this link after the call. They enter the
// email they subscribed with, we email a 6-digit code, they verify, and land
// in /onboarding — which resumes past the payment step because they've already
// paid.
//
// NB: this needs Supabase Auth's email OTP template to send a CODE (use
// {{ .Token }} in the template), not a magic link. That's a dashboard setting.

import { useState, type FormEvent } from 'react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { supabase } from '@/core/hooks/useSupabaseQuery'

export default function ReviewsContinuePage() {
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // shouldCreateUser:false — this door is for EXISTING accounts only. New
      // customers use /subscribe. If the email isn't found, we still show the
      // code screen (Supabase doesn't reveal whether the email exists), and a
      // wrong/unknown email simply never produces a valid code.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      })
      if (error) throw error
      setStage('code')
    } catch (err) {
      setError((err as Error).message || 'Could not send the code')
    }
    setBusy(false)
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      })
      if (error) throw error
      // Session is set — onboarding resumes past the (already-paid) plan step.
      window.location.href = '/onboarding'
    } catch (err) {
      setError((err as Error).message || 'That code did not match — try again')
    }
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-ink">Continue your setup</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          {stage === 'email'
            ? "Enter the email you subscribed with and we'll send you a 6-digit code."
            : `We emailed a 6-digit code to ${email}. Enter it below.`}
        </p>

        {stage === 'email' ? (
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
        ) : (
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
            <button
              type="button"
              onClick={() => { setStage('email'); setCode(''); setError(null) }}
              className="w-full text-xs text-ink-subtle underline"
            >
              Use a different email
            </button>
          </form>
        )}

        {error && <p className="mt-4 text-sm font-medium text-danger">{error}</p>}
      </div>
    </div>
  )
}
