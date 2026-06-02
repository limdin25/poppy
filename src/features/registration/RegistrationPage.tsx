import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, User, Mail, Lock } from 'lucide-react'
import { supabase } from '@/integrations/supabase/browser'

const ELSIE_MARK = (
  <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.555 4.126 1.528 5.86L.06 23.644a.5.5 0 00.612.612l5.784-1.468A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.95 9.95 0 01-5.332-1.538l-.382-.23-3.432.87.87-3.432-.23-.382A9.95 9.95 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
)

const FIELD = 'h-12 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

export default function RegistrationPage() {
  const navigate = useNavigate()
  const [businessName, setBusinessName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!businessName.trim() || !name.trim() || !email.trim() || password.length < 6) {
      setError('Fill every field — password must be at least 6 characters.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      // One call creates the user + business + team member
      const regRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, businessName }),
      })
      const reg = await regRes.json()
      if (!regRes.ok || !reg.ok) {
        setError(reg.error || 'Registration failed')
        setSubmitting(false)
        return
      }

      // Sign in, then into onboarding
      if (reg.access_token && reg.refresh_token) {
        await supabase.auth.setSession({ access_token: reg.access_token, refresh_token: reg.refresh_token })
      }
      navigate('/onboarding', { replace: true })
    } catch {
      setError('Network error — please try again')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-white px-6 py-10" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="w-full max-w-sm">
        <Link to="/welcome" className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900">{ELSIE_MARK}</div>
          <span className="text-[18px] font-semibold tracking-tight text-gray-900">Elsie</span>
        </Link>

        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Start free</h1>
          <p className="mt-2 text-[15px] text-gray-500">Your AI receptionist on WhatsApp — set up in a minute.</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-3.5">
          {error && <div className="rounded-lg bg-red-50 px-4 py-2 text-[13px] text-red-700">{error}</div>}

          <div className="relative">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className={FIELD} placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
          </div>
          <div className="relative">
            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className={FIELD} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="email" className={FIELD} placeholder="you@business.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="password" className={FIELD} placeholder="Password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-gray-900 text-[15px] font-medium text-white transition hover:bg-gray-800 active:scale-[0.98] disabled:opacity-40"
          >
            {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-gray-400">
          By creating an account you agree to our{' '}
          <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy Policy</Link>.
        </p>

        <p className="mt-6 text-center text-[13px] text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-gray-900 hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  )
}
