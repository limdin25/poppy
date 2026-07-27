import { useState } from 'react'
import { Lock, CheckCircle2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/browser'

/** Only same-origin paths. Rejects protocol-relative (`//evil`) and the
 *  backslash variant browsers normalise to a slash — otherwise ?next= is an
 *  open redirect on a page that has just authenticated someone. */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/')) return null
  if (next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    setError('')

    const { error: updateError } = await supabase.auth.updateUser({ password })

    setLoading(false)
    if (updateError) {
      setError(updateError.message)
    } else {
      setDone(true)
      // The reviews welcome email sends ?next=/onboarding so a new client lands
      // back in setup rather than an empty dashboard.
      setTimeout(() => navigate(safeNext(params.get('next')) ?? '/dashboard'), 2000)
    }
  }

  if (done) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <CheckCircle2 size={28} className="text-success" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-ink">Password updated</h1>
          <p className="mt-2 text-[15px] text-ink-muted">Redirecting you to the dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-ink">Set new password</h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          Choose a new password for your account.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {error && (
            <div className="rounded-lg bg-danger/10 px-4 py-2 text-[13px] text-danger">
              {error}
            </div>
          )}

          <div>
            <label className="text-[13px] font-medium text-ink">New password</label>
            <div className="relative mt-1.5">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                autoFocus
                className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <div>
            <label className="text-[13px] font-medium text-ink">Confirm password</label>
            <div className="relative mt-1.5">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                required
                minLength={6}
                className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!password || !confirm || loading}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white shadow-soft transition hover:bg-brand-600 active:scale-[0.98] disabled:opacity-40"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              'Update password'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
