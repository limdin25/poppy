import { useEffect, useState } from 'react'
import { Mail, Lock, ArrowRight, Star, Check } from 'lucide-react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/integrations/supabase/browser'
import { BTN_BLUE, FIELD, DISPLAY, LABEL, STAR } from '@/core/ui/brand'

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
    .select('workspace_role, landing_path').eq('id', user.id).maybeSingle()
  // A per-person landing page, when one is set. Pedro Houses does exactly one
  // job, ringing estate agents, and the inbox then the plumber dialer is the
  // wrong script, the wrong pitch and the wrong leads. NULL for everyone else,
  // so every other account is unchanged.
  const landing = (prof?.landing_path as string | null)?.trim()
  if (landing && landing.startsWith('/')) return landing
  if ((prof?.workspace_role as string | null)) return '/admin/crm/inbox'
  if (user.email) {
    const { data: adm } = await supabase.from('admin_users').select('email').eq('email', user.email).maybeSingle()
    if (adm) return '/admin/crm/inbox'
  }
  return '/dashboard'
}

/** The proof rail — desktop only. Same Google-card language as the VSL page. */
function ProofPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[#1a73e8] p-12 lg:flex lg:flex-col lg:justify-center">
      {/* soft light, same trick the VSL hero uses to stop a flat blue block */}
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.28),transparent)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-24 h-[360px] w-[360px] rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.16),transparent)]" />

      <div className="relative mx-auto w-full max-w-md">
        <p className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-white/70">
          Reviews win the job
        </p>
        <h2 className={`mt-3 text-[34px] leading-[1.12] text-white ${DISPLAY}`}>
          When someone Googles a plumber, they call the one with 400 reviews.
        </h2>

        {/* a real-looking Google card, exactly the shape the VSL video shows */}
        <div className="mt-8 rounded-[18px] bg-white p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="flex items-center gap-3">
            <div className={`grid h-11 w-11 place-items-center rounded-full bg-[#F8FAFD] text-lg text-[#1a73e8] ring-1 ring-[#E5E7EB] ${DISPLAY}`}>G</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#1A1A1A]">Your business</p>
              <p className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                <span className="font-bold text-[#1A1A1A]">4.9</span>
                <span className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className="h-3 w-3" style={{ fill: STAR, color: STAR }} />
                  ))}
                </span>
                <span>· 412 reviews</span>
              </p>
            </div>
            <span className="ml-auto shrink-0 rounded-full bg-[#E8F0FE] px-2.5 py-1 text-[11px] font-bold text-[#1a73e8]">
              seen first
            </span>
          </div>
        </div>

        <ul className="mt-8 space-y-3">
          {['Every finished job asks for a review', 'Follow-ups that stop the moment they reply', 'AI answers every review for you'].map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-[15px] text-white/90">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-white" /> {b}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const [mode, setMode] = useState<'team' | 'client'>('team')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const { signInWithPassword, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  // Already signed in? Straight to where this account belongs (landing_path
  // aware, same resolver as a fresh sign-in). Pedro bookmarked /login and kept
  // arriving at a sign-in form for a session he already had; the natural next
  // click from there dumped him in the receptionist dashboard.
  useEffect(() => {
    if (!user) return
    let stale = false
    void resolveDestination(from).then((dest) => {
      if (!stale) navigate(dest, { replace: true })
    })
    return () => { stale = true }
  }, [user, from, navigate])

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

  const tab = (active: boolean) =>
    `h-10 rounded-[10px] text-[13px] font-bold transition ${
      active ? 'bg-white text-[#1a73e8] shadow-sm' : 'text-[#6B7280] hover:text-[#1A1A1A]'
    }`

  return (
    <div
      className="grid min-h-[100dvh] bg-white lg:grid-cols-[1fr_1.05fr]"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── form side ── */}
      <div className="flex flex-col justify-center px-6 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Link to="/welcome" className="mb-9 flex items-center justify-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#1a73e8]">{ELSIE_MARK}</div>
            <span className={`text-[19px] text-[#1A1A1A] ${DISPLAY}`}>HeyElsie</span>
          </Link>

          {/* One front door, two kinds of people: staff/owners sign in here; Reviews
              clients get sent to their own app on go.heyelsie.com. */}
          <div className="mb-7 grid grid-cols-2 gap-1 rounded-[13px] bg-[#F8FAFD] p-1 ring-1 ring-[#E5E7EB]">
            <button type="button" onClick={() => setMode('team')} className={tab(mode === 'team')}>
              Staff &amp; owners
            </button>
            <button type="button" onClick={() => setMode('client')} className={tab(mode === 'client')}>
              Reviews client
            </button>
          </div>

          {mode === 'client' ? (
            <div className="text-center">
              <h1 className={`text-[28px] leading-tight text-[#1A1A1A] ${DISPLAY}`}>Reviews clients</h1>
              <p className="mt-2 text-[15px] text-[#6B7280]">
                Your dashboard lives on go.heyelsie.com. Sign in there.
              </p>
              <a
                href={GO_URL}
                className={`mt-7 flex h-[52px] w-full items-center justify-center gap-2 text-[15.5px] ${BTN_BLUE}`}
              >
                Continue to go.heyelsie.com <ArrowRight size={16} />
              </a>
              <button
                onClick={() => setMode('team')}
                className="mt-4 text-[13px] font-semibold text-[#6B7280] transition hover:text-[#1a73e8]"
              >
                ← I'm staff or a business owner
              </button>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h1 className={`text-[28px] leading-tight text-[#1A1A1A] ${DISPLAY}`}>Welcome back</h1>
                <p className="mt-2 text-[15px] text-[#6B7280]">Sign in — we'll take you to the right place.</p>
              </div>

              <form onSubmit={handlePassword} className="mt-8 space-y-4">
                <div>
                  <label className={LABEL}>Email address</label>
                  <div className="relative mt-2">
                    <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@business.co.uk"
                      required
                      autoFocus
                      className={FIELD}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className={LABEL}>Password</label>
                    <Link to="/forgot-password" className="text-[12px] font-semibold text-[#1a73e8] hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative mt-2">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className={FIELD}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!email || !password || loading}
                  className={`flex h-[52px] w-full items-center justify-center text-[15.5px] ${BTN_BLUE}`}
                >
                  {loading
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    : 'Sign in'}
                </button>
              </form>

              {errorMsg && (
                <p className="mt-3 rounded-[10px] bg-red-50 px-4 py-2 text-center text-[13px] font-semibold text-red-700">
                  {errorMsg}
                </p>
              )}

              <p className="mt-7 text-center text-[13.5px] text-[#6B7280]">
                Don't have an account?{' '}
                <Link to="/register" className="font-bold text-[#1a73e8] hover:underline">Sign up free</Link>
              </p>
            </>
          )}
        </div>
      </div>

      <ProofPanel />
    </div>
  )
}
