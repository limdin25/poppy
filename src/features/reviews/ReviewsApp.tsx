// HeyElsie Reviews — the client app served on go.heyelsie.com.
// Self-contained: own login, own layout (sidebar on desktop, bottom nav on
// mobile), own session context. Admins can open any client's view with
// ?as={businessId} (RLS admin union + x-impersonate-business on writes).

import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Routes, Route, NavLink, Navigate, useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard, Users, UserPlus, MessageSquareText, CalendarClock,
  Star, Blocks, Share2, Gift, CreditCard, LogOut, Menu, X,
} from 'lucide-react'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { cn } from '@/core/lib/cn'
import { ReviewsSessionContext, type ReviewsSession } from './lib'

const DashboardPage = lazy(() => import('./pages/ReviewsDashboardPage'))
const ContactsPage = lazy(() => import('./pages/ReviewsContactsPage'))
const AddContactsPage = lazy(() => import('./pages/ReviewsAddContactsPage'))
const MessagingPage = lazy(() => import('./pages/ReviewsMessagingPage'))
const SchedulingPage = lazy(() => import('./pages/ReviewsSchedulingPage'))
const ReviewsInboxPage = lazy(() => import('./pages/ReviewsInboxPage'))
const WidgetsPage = lazy(() => import('./pages/ReviewsWidgetsPage'))
const SocialPostingPage = lazy(() => import('./pages/ReviewsSocialPostingPage'))
const ReferralsPage = lazy(() => import('./pages/ReviewsReferralsPage'))
const BillingPage = lazy(() => import('./pages/ReviewsBillingPage'))
const OnboardingPage = lazy(() => import('@/features/reviews-onboarding/ReviewsOnboardingPage'))

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/add-contacts', label: 'Add Contacts', icon: UserPlus },
  { to: '/messaging', label: 'Messaging', icon: MessageSquareText },
  { to: '/scheduling', label: 'Scheduling', icon: CalendarClock },
  { to: '/reviews', label: 'Reviews', icon: Star },
  { to: '/widgets', label: 'Widgets', icon: Blocks },
  { to: '/social', label: 'Social Posting', icon: Share2 },
  { to: '/referrals', label: 'Refer a Friend', icon: Gift },
  { to: '/billing', label: 'Billing', icon: CreditCard },
]

function Loading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
    </div>
  )
}

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-card">
        <h1 className="text-xl font-semibold text-ink">HeyElsie Reviews</h1>
        <p className="mt-1 text-sm text-ink-subtle">Sign in to your reviews dashboard</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-subtle">
          New here? <a href="/onboarding" className="font-medium text-brand">Start your free trial</a>
        </p>
      </div>
    </div>
  )
}

function Shell({ session }: { session: ReviewsSession }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to + (session.impersonating ? `?as=${session.businessId}` : '')}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) => cn(
            'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
            isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-subtle hover:bg-border/40 hover:text-ink',
          )}
        >
          <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
          {label}
        </NavLink>
      ))}
      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-subtle hover:bg-border/40 hover:text-ink"
      >
        <LogOut style={{ width: 18, height: 18 }} /> Log out
      </button>
    </nav>
  )

  return (
    <div className="min-h-screen bg-bg">
      {session.impersonating && (
        <div className="bg-amber-500 px-4 py-1.5 text-center text-sm font-medium text-white">
          Viewing as: {session.businessName} (admin)
        </div>
      )}
      <div className="mx-auto flex max-w-6xl">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface p-4 md:flex">
          <div className="mb-6 px-2">
            <span className="text-lg font-bold text-brand">HeyElsie</span>
            <span className="ml-1 text-lg font-light text-ink">Reviews</span>
            <p className="mt-1 truncate text-xs text-ink-subtle">{session.businessName}</p>
          </div>
          {nav}
        </aside>

        {/* Mobile top bar */}
        <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <span className="text-base font-bold text-brand">HeyElsie <span className="font-light text-ink">Reviews</span></span>
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            {menuOpen ? <X className="h-5 w-5 text-ink" /> : <Menu className="h-5 w-5 text-ink" />}
          </button>
        </div>
        {menuOpen && (
          <div className="fixed inset-0 z-30 bg-bg pt-16 md:hidden">
            <div className="p-4">{nav}</div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 pb-24 pt-16 md:px-8 md:pt-8">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/add-contacts" element={<AddContactsPage />} />
              <Route path="/messaging" element={<MessagingPage />} />
              <Route path="/scheduling" element={<SchedulingPage />} />
              <Route path="/reviews" element={<ReviewsInboxPage />} />
              <Route path="/widgets" element={<WidgetsPage />} />
              <Route path="/social" element={<SocialPostingPage />} />
              <Route path="/referrals" element={<ReferralsPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}

export default function ReviewsApp() {
  const [params] = useSearchParams()

  useEffect(() => {
    document.title = 'HeyElsie Reviews'
  }, [])
  const [state, setState] = useState<{ loading: boolean; session: ReviewsSession | null; authed: boolean; isAdmin: boolean }>({
    loading: true, session: null, authed: false, isAdmin: false,
  })

  useEffect(() => {
    let cancelled = false

    async function resolve() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        if (!cancelled) setState({ loading: false, session: null, authed: false, isAdmin: false })
        return
      }
      const user = session.user
      const asParam = params.get('as')

      // Admin impersonation via ?as= (persisted for the tab)
      let impersonateId = asParam
      if (!impersonateId) impersonateId = sessionStorage.getItem('go_impersonation')
      if (impersonateId) {
        const { data: admin } = await supabase.from('admin_users').select('email').eq('email', user.email ?? '').maybeSingle()
        if (admin) {
          const { data: biz } = await supabase.from('businesses').select('id, name').eq('id', impersonateId).maybeSingle()
          if (biz) {
            sessionStorage.setItem('go_impersonation', biz.id)
            if (!cancelled) setState({
              loading: false, authed: true, isAdmin: true,
              session: { userId: user.id, email: user.email ?? '', businessId: biz.id, businessName: biz.name, impersonating: true, reviewsEnabled: true },
            })
            return
          }
        }
        sessionStorage.removeItem('go_impersonation')
      }

      const { data: member } = await supabase
        .from('team_members').select('business_id').eq('user_id', user.id).limit(1).maybeSingle()
      if (!member) {
        if (!cancelled) setState({ loading: false, session: null, authed: false, isAdmin: false })
        return
      }
      const { data: biz } = await supabase.from('businesses').select('id, name').eq('id', member.business_id).single()
      const { data: flag } = await supabase
        .from('feature_flags').select('enabled').eq('business_id', member.business_id).eq('flag_key', 'reviews').maybeSingle()
      // Admins signed in with a non-reviews account get pointed at /super
      // instead of the generic "not enabled" screen.
      let isAdmin = false
      if (!flag?.enabled) {
        const { data: admin } = await supabase.from('admin_users').select('email').eq('email', user.email ?? '').maybeSingle()
        isAdmin = !!admin
      }
      if (!cancelled) setState({
        loading: false, authed: true, isAdmin,
        session: {
          userId: user.id, email: user.email ?? '',
          businessId: member.business_id, businessName: biz?.name ?? 'Your business',
          impersonating: false, reviewsEnabled: !!flag?.enabled,
        },
      })
    }

    resolve()
    const { data: sub } = supabase.auth.onAuthStateChange(() => { resolve() })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('as')])

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Public: the 10-minute onboarding (includes account creation) */}
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/*" element={
          state.loading ? <Loading />
          : !state.authed || !state.session ? <LoginScreen />
          : !state.session.reviewsEnabled && !state.session.impersonating ? (
            state.isAdmin ? (
              <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
                <h1 className="text-xl font-semibold text-ink">You're signed in with your admin account</h1>
                <p className="max-w-sm text-sm text-ink-subtle">
                  go.heyelsie.com is the client-facing Reviews dashboard. To see a client's view, open them from
                  the admin panel ("View as client") — or pick one now:
                </p>
                <a href="https://app.heyelsie.com/super/reviews"><Button>Open /super → Review Clients</Button></a>
              </div>
            ) : (
              <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
                <h1 className="text-xl font-semibold text-ink">This account doesn't have Reviews enabled</h1>
                <p className="max-w-sm text-sm text-ink-subtle">
                  Your account uses a different HeyElsie product. To add Reviews, start the setup below or contact us.
                </p>
                <a href="/onboarding"><Button>Set up HeyElsie Reviews</Button></a>
              </div>
            )
          ) : (
            <ReviewsSessionContext.Provider value={state.session}>
              <Shell session={state.session} />
            </ReviewsSessionContext.Provider>
          )
        } />
      </Routes>
    </Suspense>
  )
}
