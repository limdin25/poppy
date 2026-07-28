// HeyElsie Reviews — the client app served on go.heyelsie.com.
// Self-contained: own login, own layout (sidebar on desktop, bottom nav on
// mobile), own session context. Admins can open any client's view with
// ?as={businessId} (RLS admin union + x-impersonate-business on writes).

import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Routes, Route, NavLink, Navigate, useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard, Users, UserPlus, MessageSquareText,
  Star, Blocks, Share2, Plug, Gift, CreditCard, LogOut, Menu, X, Globe,
} from 'lucide-react'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { cn } from '@/core/lib/cn'
import { ReviewsSessionContext, type ReviewsSession } from './lib'
import { BusinessSwitcher } from './components/BusinessSwitcher'

const DashboardPage = lazy(() => import('./pages/ReviewsDashboardPage'))
const ContactsPage = lazy(() => import('./pages/ReviewsContactsPage'))
const AddContactsPage = lazy(() => import('./pages/ReviewsAddContactsPage'))
const MessagingPage = lazy(() => import('./pages/ReviewsMessagingPage'))
const ReviewsInboxPage = lazy(() => import('./pages/ReviewsInboxPage'))
const WidgetsPage = lazy(() => import('./pages/ReviewsWidgetsPage'))
const SocialPostingPage = lazy(() => import('./pages/ReviewsSocialPostingPage'))
const IntegrationsPage = lazy(() => import('./pages/ReviewsIntegrationsPage'))
const SiteEditorPage = lazy(() => import('./pages/SiteEditorPage'))
const ReferralsPage = lazy(() => import('./pages/ReviewsReferralsPage'))
const BillingPage = lazy(() => import('./pages/ReviewsBillingPage'))
const OnboardingPage = lazy(() => import('@/features/reviews-onboarding/ReviewsOnboardingPage'))
const ContinuePage = lazy(() => import('@/features/reviews-onboarding/ReviewsContinuePage'))
const AddBusinessPage = lazy(() => import('./pages/AddBusinessPage'))
// Cross-feature import, same exception already taken for reviews-onboarding
// above: these two pages were only mounted in the non-`go` branch of
// src/app/App.tsx, so on go.heyelsie.com "Forgot password" fell through the
// catch-all to the password login — unreachable for every reviews client.
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'))

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/add-contacts', label: 'Add Contacts', icon: UserPlus },
  { to: '/messaging', label: 'Messaging', icon: MessageSquareText },
  { to: '/reviews', label: 'Reviews', icon: Star },
  { to: '/widgets', label: 'Widgets', icon: Blocks },
  { to: '/social', label: 'Social Posting', icon: Share2 },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/website', label: 'My website', icon: Globe },
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
        <h1 className="text-xl font-black tracking-tight text-ink">HeyElsie Reviews</h1>
        <p className="mt-1 text-sm text-ink-subtle">Sign in to your reviews dashboard</p>

        {/* The code door is PRIMARY (Hugo 2026-07-27). Customers who started on
            the £1 offer never chose a password — this screen used to offer them
            nothing but a password box and no forgot-password link, so their only
            way in was typing /continue by hand. */}
        <a
          href="/continue"
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Email me a sign-in code
        </a>
        <p className="mt-1.5 text-center text-xs text-ink-subtle">No password needed — the usual way in.</p>

        <details className="mt-5">
          <summary className="cursor-pointer text-center text-sm text-ink-subtle">Sign in with a password instead</summary>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
            <a href="/forgot-password" className="block text-center text-xs text-ink-subtle underline">Forgot password?</a>
          </form>
        </details>

        <p className="mt-4 text-center text-sm text-ink-subtle">
          New here? <a href="/onboarding" className="font-medium text-brand">Get started</a>
        </p>
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-center text-xs text-ink-subtle">Part of the team, not a reviews client?</p>
          <a
            href="https://app.heyelsie.com/login"
            className="flex w-full items-center justify-center rounded-xl border border-border bg-elevated px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-bg"
          >
            Staff &amp; agent sign-in →
          </a>
        </div>
      </div>
    </div>
  )
}

function Shell({ session }: { session: ReviewsSession }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to + (session.impersonating ? `?as=${session.businessId}` : '')}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) => cn(
            'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
            isActive ? 'bg-ink text-white' : 'text-ink-muted hover:bg-elevated hover:text-ink',
          )}
        >
          <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
          {label}
        </NavLink>
      ))}
      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-muted hover:bg-elevated hover:text-ink"
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
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface/60 p-4 md:flex">
          <div className="px-2 py-1">
            <span className="text-xl font-black tracking-tight text-ink">HeyElsie</span>
            <span className="ml-1 text-xl font-light text-ink-subtle">Reviews</span>
          </div>
          <div className="mb-4 mt-3">
            <BusinessSwitcher session={session} />
          </div>
          {nav}
        </aside>

        {/* Mobile top bar */}
        <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border bg-bg/80 px-4 py-3 backdrop-blur md:hidden">
          <span className="text-base font-black tracking-tight text-ink">HeyElsie <span className="font-light text-ink-subtle">Reviews</span></span>
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu"
            className="grid h-9 w-9 place-items-center rounded-full bg-elevated">
            {menuOpen ? <X className="h-5 w-5 text-ink" /> : <Menu className="h-5 w-5 text-ink" />}
          </button>
        </div>
        {menuOpen && (
          <div className="fixed inset-0 z-30 bg-bg pt-16 md:hidden">
            <div className="p-4">
              <div className="mb-3">
                <BusinessSwitcher session={session} />
              </div>
              {nav}
            </div>
          </div>
        )}

        <main className="mx-auto min-w-0 max-w-6xl flex-1 px-4 pb-24 pt-16 md:px-10 md:pt-10">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/business/dashboard" element={<Navigate to="/dashboard" replace />} />
              <Route path="/business/add" element={<AddBusinessPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/add-contacts" element={<AddContactsPage />} />
              <Route path="/messaging" element={<MessagingPage />} />
              {/* Scheduling merged into Messaging — keep the old path working */}
              <Route path="/scheduling" element={<Navigate to="/messaging" replace />} />
              <Route path="/reviews" element={<ReviewsInboxPage />} />
              <Route path="/widgets" element={<WidgetsPage />} />
              <Route path="/social" element={<SocialPostingPage />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              {/* The site-demo editor. Lives in this feature because it is a
                  page of the go. client app; the markup it previews comes from
                  src/core/site-demo so the api route and this render the same
                  HTML. */}
              <Route path="/website" element={<SiteEditorPage />} />
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

      const { data: members } = await supabase
        .from('team_members').select('business_id').eq('user_id', user.id)
      const memberIds = [...new Set((members ?? []).map((m) => m.business_id))]
      if (!memberIds.length) {
        // A CRM contractor agent has no reviews business. Don't dead-end them on
        // the reviews login — send them to the CRM on the app host, where their
        // account lives (login is per-origin, so they sign in there).
        const { data: prof } = await supabase.from('profiles').select('workspace_role').eq('id', user.id).maybeSingle()
        const role = (prof as { workspace_role?: string | null } | null)?.workspace_role
        if (!cancelled && (role === 'agent' || role === 'admin' || role === 'viewer')) {
          // Staff belong on the app host, not the reviews client app. Clear the
          // stray reviews-origin session and send them to the SINGLE app login,
          // which routes them into the CRM by role — one sign-in, no dead-end
          // at /admin/crm/inbox (where they had no session and got bounced again).
          // scope:'local' — only drop THIS origin's session; never revoke their
          // real CRM session on the app host.
          await supabase.auth.signOut({ scope: 'local' })
          window.location.replace('https://app.heyelsie.com/login')
          return
        }
        if (!cancelled) setState({ loading: false, session: null, authed: false, isAdmin: false })
        return
      }
      // Multi-business: pick the profile's active business (if the user still
      // belongs to it and it isn't an unfinished draft), else the first non-draft.
      const { data: prof2 } = await supabase.from('profiles').select('active_business_id').eq('id', user.id).maybeSingle()
      const { data: bizRows } = await supabase.from('businesses').select('id, name, status').in('id', memberIds)
      const nonDraftIds = (bizRows ?? []).filter((b) => b.status !== 'draft').map((b) => b.id)
      const activeId = (prof2?.active_business_id && nonDraftIds.includes(prof2.active_business_id))
        ? prof2.active_business_id : (nonDraftIds[0] ?? memberIds[0])
      const biz = (bizRows ?? []).find((b) => b.id === activeId) ?? null
      const { data: flag } = await supabase
        .from('feature_flags').select('enabled').eq('business_id', activeId).eq('flag_key', 'reviews').maybeSingle()
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
          businessId: activeId, businessName: biz?.name ?? 'Your business',
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
    <div className="reviews-theme min-h-screen bg-bg">
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Public: the 10-minute onboarding (includes account creation) */}
        <Route path="/onboarding" element={<OnboardingPage />} />
        {/* Public: subscribe-on-the-call door (email-only account, pay first). */}
        <Route path="/subscribe" element={<OnboardingPage mode="subscribe" />} />
        {/* Public: already-paid door — email + code, then resume onboarding. */}
        <Route path="/continue" element={<ContinuePage />} />
        {/* Public: password recovery, for clients who chose one (or who follow
            the "set your password" button in the welcome email). */}
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/*" element={
          state.loading ? <Loading />
          : !state.authed || !state.session ? <LoginScreen />
          : !state.session.reviewsEnabled && !state.session.impersonating ? (
            state.isAdmin ? (
              <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
                <h1 className="text-xl font-black tracking-tight text-ink">You're signed in with your admin account</h1>
                <p className="max-w-sm text-sm text-ink-subtle">
                  go.heyelsie.com is the client-facing Reviews dashboard. To see a client's view, open them from
                  the admin panel ("View as client"), or pick one now:
                </p>
                <a href="https://app.heyelsie.com/super/reviews"><Button>Open /super → Review Clients</Button></a>
              </div>
            ) : (
              <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
                <h1 className="text-xl font-black tracking-tight text-ink">This account doesn't have Reviews enabled</h1>
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
    </div>
  )
}
