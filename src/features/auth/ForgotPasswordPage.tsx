import { useState } from 'react'
import { Mail, ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/browser'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError('')

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)
    if (resetError) {
      setError(resetError.message)
    } else {
      setSent(true)
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <Mail size={28} className="text-success" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-ink">Check your email</h1>
          <p className="mt-2 text-[15px] text-ink-muted">
            If an account exists for <span className="font-medium text-ink">{email}</span>,
            you'll receive a password reset link.
          </p>
          <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-brand hover:underline">
            <ArrowLeft size={14} />
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <Link to="/login" className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-ink-muted hover:text-ink">
          <ArrowLeft size={14} />
          Back to login
        </Link>

        <h1 className="text-2xl font-semibold text-ink">Reset your password</h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          Enter your email and we'll send you a reset link.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {error && (
            <div className="rounded-lg bg-danger/10 px-4 py-2 text-[13px] text-danger">
              {error}
            </div>
          )}

          <div>
            <label className="text-[13px] font-medium text-ink">Email address</label>
            <div className="relative mt-1.5">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@business.co.uk"
                required
                autoFocus
                className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!email || loading}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white shadow-soft transition hover:bg-brand-600 active:scale-[0.98] disabled:opacity-40"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <>
                Send reset link
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
