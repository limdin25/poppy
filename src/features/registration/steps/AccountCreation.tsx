import { useState } from 'react'
import { User, Mail, Lock, ShieldCheck, Star, Clock } from 'lucide-react'
import { supabase } from '@/integrations/supabase/browser'

interface Props {
  businessId: string
  businessName: string
  onSubmit: (name: string, email: string) => void
}

export default function AccountCreation({ businessId, businessName, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password.trim()) return
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, businessId }),
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.error || 'Registration failed')
        setSubmitting(false)
        return
      }

      // Set the session in the client so AuthProvider picks it up
      if (data.access_token && data.refresh_token) {
        await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        })
      }

      onSubmit(name, email)
    } catch {
      setError('Network error — please try again')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="text-2xl font-semibold text-ink">
        Poppy's almost ready to take your calls
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        Complete your registration to activate Poppy for{' '}
        <span className="font-medium text-ink">{businessName}</span>
      </p>

      <div className="mt-6 space-y-3">
        {[
          { icon: Clock, text: 'Grow your business while Poppy answers calls 24/7' },
          { icon: ShieldCheck, text: 'Free for the first 7 days, no credit card required' },
          { icon: Star, text: 'Our support team is here for you and ready to help' },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3">
            <Icon size={18} className="shrink-0 text-brand" />
            <span className="text-[14px] text-ink-muted">{text}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-elevated/50 p-4">
        <p className="text-[13px] italic text-ink-muted">
          "Poppy just works. Setup was fast and it sounds so real, customers
          think it's an actual receptionist."
        </p>
        <p className="mt-2 text-[12px] font-medium text-ink-subtle">
          — BlueTap Plumbing, Essex
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {error && (
          <div className="rounded-lg bg-danger/10 px-4 py-2 text-[13px] text-danger">
            {error}
          </div>
        )}

        <div>
          <label className="text-[13px] font-medium text-ink">Your name</label>
          <div className="relative mt-1.5">
            <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
              className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink">Email address</label>
          <div className="relative mt-1.5">
            <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
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
          <label className="text-[13px] font-medium text-ink">Password</label>
          <div className="relative mt-1.5">
            <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              minLength={6}
              className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!name.trim() || !email.trim() || !password.trim() || submitting}
          className="h-12 w-full rounded-xl bg-brand text-[15px] font-semibold text-white shadow-soft transition-all hover:bg-brand-600 active:scale-[0.98] disabled:opacity-40"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Creating account...
            </span>
          ) : (
            'Try Poppy Now'
          )}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] text-ink-subtle">
        By creating an account, you agree with our Privacy Policy and Terms of
        Service
      </p>
    </div>
  )
}
