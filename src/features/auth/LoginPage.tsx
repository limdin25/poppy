import { useState } from 'react'
import { Mail, Lock, ArrowRight } from 'lucide-react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/integrations/supabase/browser'

const ELSIE_MARK = (
  <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.555 4.126 1.528 5.86L.06 23.644a.5.5 0 00.612.612l5.784-1.468A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.95 9.95 0 01-5.332-1.538l-.382-.23-3.432.87.87-3.432-.23-.382A9.95 9.95 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
)

const GO_URL = 'https://go.heyelsie.com'

// After a successful sign-in, decide where the person belongs. One login, no
// guessing: the account tells us. CRM staff (profiles.workspace_role set, or an
// admin_users row) → the CRM; everyone else (receptionist owners) → /dashboard.
// A `from` redirect (a CRM deep-link the guard bounced off) always wins.
async function resolveDestination(from?: string): Promise<string> {
  if (from && from !== '/login') return from
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return '/dashboard'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prof } = await (supabase.from('profiles') as any)
    .select('workspace_role').eq('id', user.id).maybeSingle()
  if ((prof?.workspace_role as string | null)) return '/admin/crm/inbox'
  if (user.email) {
    const { data: adm } = await supabase.from('admin_users').select('email').eq('email', user.email).maybeSingle()
    if (adm) return '/admin/crm/inbox'
  }
  return '/dashboard'
}

export default function LoginPage() {
  const [mode, setMode] = useState<'team' | 'client'>('team')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const { signInWithPassword } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  async function signIn(em: string, pw: string) {
    setLoading(true)
    setErrorMsg('')
    const { error } = await signInWithPassword(em, pw)
    if (error) { setLoading(false); setErrorMsg(error.message); return }
    const dest = await resolveDestination(from)
    setLoading(false)
    navigate(dest, { replace: true })
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    await signIn(email, password)
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-white px-6" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="w-full max-w-sm">
        <Link to="/welcome" className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900">{ELSIE_MARK}</div>
          <span className="text-[18px] font-semibold tracking-tight text-gray-900">Elsie</span>
        </Link>

        {/* One front door, two kinds of people: staff/owners sign in here; Reviews
            clients get sent to their own app on go.heyelsie.com. */}
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setMode('team')}
            className={`h-9 rounded-lg text-[13px] font-medium transition ${mode === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Staff &amp; owners
          </button>
          <button
            type="button"
            onClick={() => setMode('client')}
            className={`h-9 rounded-lg text-[13px] font-medium transition ${mode === 'client' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Reviews client
          </button>
        </div>

        {mode === 'client' ? (
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Reviews clients</h1>
            <p className="mt-2 text-[15px] text-gray-500">Your dashboard lives on go.heyelsie.com. Sign in there.</p>
            <a
              href={GO_URL}
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 text-[15px] font-medium text-white transition hover:bg-gray-800 active:scale-[0.98]"
            >
              Continue to go.heyelsie.com <ArrowRight size={16} />
            </a>
            <button onClick={() => setMode('team')} className="mt-4 text-[13px] text-gray-500 hover:text-gray-900">
              ← I'm staff or a business owner
            </button>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Welcome back</h1>
              <p className="mt-2 text-[15px] text-gray-500">Sign in — we'll take you to the right place.</p>
            </div>

            <form onSubmit={handlePassword} className="mt-8 space-y-4">
              <div>
                <label className="text-[13px] font-medium text-gray-900">Email address</label>
                <div className="relative mt-1.5">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@business.co.uk"
                    required
                    autoFocus
                    className="h-12 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium text-gray-900">Password</label>
                  <Link to="/forgot-password" className="text-[12px] text-gray-500 hover:text-gray-900">Forgot password?</Link>
                </div>
                <div className="relative mt-1.5">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="h-12 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!email || !password || loading}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-gray-900 text-[15px] font-medium text-white transition hover:bg-gray-800 active:scale-[0.98] disabled:opacity-40"
              >
                {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : 'Sign in'}
              </button>
            </form>

            {errorMsg && <p className="mt-3 text-center text-[13px] text-red-600">{errorMsg}</p>}

            <p className="mt-6 text-center text-[13px] text-gray-500">
              Don't have an account?{' '}
              <Link to="/register" className="font-medium text-gray-900 hover:underline">Sign up free</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
