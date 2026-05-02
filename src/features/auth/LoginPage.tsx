import { useState } from 'react'
import { Mail, ArrowRight, Lock } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'magic' | 'password'>('magic')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const { signInWithPassword, signInWithOtp } = useAuth()
  const navigate = useNavigate()

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setErrorMsg('')
    const { error } = await signInWithOtp(email)
    setLoading(false)
    if (error) setErrorMsg(error.message)
    else setSent(true)
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setErrorMsg('')
    const { error } = await signInWithPassword(email, password)
    setLoading(false)
    if (error) setErrorMsg(error.message)
    else navigate('/', { replace: true })
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
            We sent a magic link to <span className="font-medium text-ink">{email}</span>
          </p>
          <p className="mt-4 text-[13px] text-ink-subtle">
            Click the link in the email to sign in. It expires in 10 minutes.
          </p>
          <button
            onClick={() => setSent(false)}
            className="mt-6 text-[14px] font-medium text-brand hover:underline"
          >
            Try a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-ink">Welcome back</h1>
          <p className="mt-2 text-[15px] text-ink-muted">Sign in to your Poppy account</p>
        </div>

        {/* Magic link form */}
        {mode === 'magic' ? (
          <form onSubmit={handleMagicLink} className="mt-8 space-y-4">
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
                  Send magic link
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePassword} className="mt-8 space-y-4">
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
                  className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium text-ink">Password</label>
                <Link to="/forgot-password" className="text-[12px] text-brand hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative mt-1.5">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!email || !password || loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white shadow-soft transition hover:bg-brand-600 active:scale-[0.98] disabled:opacity-40"
            >
              {loading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        )}

        {errorMsg && (
          <p className="mt-3 text-center text-[13px] text-danger">{errorMsg}</p>
        )}

        {/* Toggle mode */}
        <div className="mt-4 text-center">
          <button
            onClick={() => setMode(mode === 'magic' ? 'password' : 'magic')}
            className="text-[13px] text-ink-muted hover:text-brand"
          >
            {mode === 'magic' ? 'Sign in with password instead' : 'Sign in with magic link instead'}
          </button>
        </div>

        {/* Register link */}
        <p className="mt-8 text-center text-[13px] text-ink-muted">
          Don't have an account?{' '}
          <Link to="/register" className="font-medium text-brand hover:underline">
            Get started free
          </Link>
        </p>
      </div>
    </div>
  )
}
