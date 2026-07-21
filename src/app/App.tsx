import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './Layout'
import { ProtectedRoute } from '@/core/auth/ProtectedRoute'
import { VoiceRoute } from '@/core/auth/VoiceRoute'
import { FullAppRoute } from '@/core/auth/FullAppRoute'

const RegistrationPage = lazy(() => import('@/features/registration/RegistrationPage'))
const OnboardingPage = lazy(() => import('@/features/onboarding/OnboardingPage'))
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const CallsPage = lazy(() => import('@/features/calls/CallsPage'))
const InboxPage = lazy(() => import('@/features/inbox/InboxPage'))
const LeadsPage = lazy(() => import('@/features/leads/LeadsPage'))
const CampaignsPage = lazy(() => import('@/features/campaigns/CampaignsPage'))
const KnowledgeBasePage = lazy(() => import('@/features/knowledge/KnowledgeBasePage'))
const ContactsPage = lazy(() => import('@/features/contacts/ContactsPage'))
const AppointmentsPage = lazy(() => import('@/features/appointments/AppointmentsPage'))
const QuotesPage = lazy(() => import('@/features/quotes/QuotesPage'))
const InvoicesPage = lazy(() => import('@/features/invoices/InvoicesPage'))
const VoiceInvoicePage = lazy(() => import('@/features/invoices/voice/VoiceInvoicePage'))
const InvoicePublicPage = lazy(() =>
  import('@/features/invoices/public/InvoicePublicPage').then((m) => ({ default: m.InvoicePublicPage }))
)
const AgentLayout = lazy(() => import('@/features/agents/AgentLayout'))
const AiPersonalityPage = lazy(() => import('@/features/agents/settings/AiPersonalityPage'))
const CallBehaviourPage = lazy(() => import('@/features/agents/settings/CallBehaviourPage'))
const ClassificationPage = lazy(() => import('@/features/agents/settings/ClassificationPage'))
const FollowupPage = lazy(() => import('@/features/agents/settings/FollowupPage'))
const HandoffPage = lazy(() => import('@/features/agents/settings/HandoffPage'))
const TemplatesPage = lazy(() => import('@/features/templates/TemplatesPage'))
const ConnectionsPage = lazy(() => import('@/features/connections/ConnectionsPage'))
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'))
const AccountPage = lazy(() => import('@/features/account/AccountPage'))
const BillingPage = lazy(() => import('@/features/billing/BillingPage'))
const AdminApp = lazy(() => import('@/features/admin/AdminApp'))
const CrmApp = lazy(() => import('@/features/crm/CrmApp'))
const AgentJoinPage = lazy(() => import('@/features/agent-onboarding/AgentJoinPage'))
const ScriptPage = lazy(() => import('@/features/script/ScriptPage'))
const LandingPage = lazy(() => import('@/features/landing/LandingPage'))
const ReviewsApp = lazy(() => import('@/features/reviews/ReviewsApp'))
const PrivacyPolicyPage = lazy(() => import('@/features/legal/PrivacyPolicyPage'))
const TermsPage = lazy(() => import('@/features/legal/TermsPage'))
const DpaPage = lazy(() => import('@/features/legal/DpaPage'))

function LoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
    </div>
  )
}

/**
 * Host-aware root.
 *
 * The same SPA serves two domains:
 *  - heyelsie.com / www.heyelsie.com  → the marketing site (landing at "/")
 *  - app.heyelsie.com (and previews / localhost) → the product (dashboard)
 *
 * So "/" on the marketing apex renders the landing page in place (URL stays "/"),
 * while everywhere else "/" sends you into the authenticated app at /dashboard.
 * (Supabase sessions are per-origin, so the app must stay on the host you logged
 * in on — we never bounce across subdomains.)
 */
function RootEntry() {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const isMarketing = host === 'heyelsie.com' || host === 'www.heyelsie.com'
  if (isMarketing) return <LandingPage />
  return <Navigate to="/dashboard" replace />
}

/**
 * /welcome — marketing on the apex only. On app.heyelsie.com (the receptionist
 * product) logged-out users go straight to the login form instead of seeing
 * the reviews marketing page there.
 */
function WelcomeEntry() {
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const isMarketing = host === 'heyelsie.com' || host === 'www.heyelsie.com'
  if (isMarketing) return <LandingPage />
  return <Navigate to="/login" replace />
}

export default function App() {
  // go.heyelsie.com serves the HeyElsie Reviews client app in full — its own
  // login, onboarding and dashboard. (Supabase sessions are per-origin, so the
  // reviews app owns the whole origin; the receptionist app is untouched.)
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  // go.localhost → loopback in Chromium; lets Playwright/dev hit the reviews app
  if (host === 'go.heyelsie.com' || host === 'go.localhost') {
    // Agent hiring link lives here too (Hugo shares go.heyelsie.com/join). It is
    // a standalone public page, so serve it before the reviews app takes over the
    // whole origin. Rendered outside the Router, so AgentJoinPage uses no router.
    const path = typeof window !== 'undefined' ? window.location.pathname : ''
    if (path === '/join' || path === '/join/') {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <AgentJoinPage />
        </Suspense>
      )
    }
    return (
      <Suspense fallback={<LoadingFallback />}>
        <ReviewsApp />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Root — host-aware: marketing apex shows the landing, app host → dashboard */}
        <Route path="/" element={<RootEntry />} />

        {/* Public — no layout */}
        <Route path="welcome" element={<WelcomeEntry />} />
        <Route path="privacy" element={<PrivacyPolicyPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="dpa" element={<DpaPage />} />
        <Route path="register" element={<RegistrationPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        {/* Public agent hiring link — the new hire signs the agreement,
            verifies their email, and gets a CRM agent account. */}
        <Route path="join" element={<AgentJoinPage />} />
        {/* PIN-gated one-call sales script (heyelsie.com/script). */}
        <Route path="script" element={<ScriptPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />

        {/* Public customer invoice — the share-link page, e.g. /smiths-plumbing/invoice/45-x7k2q.
            Dynamic segments rank below the static routes above, so /privacy etc. still win. */}
        <Route path=":slug/invoice/:code" element={<InvoicePublicPage />} />

        {/* CRM — sibling of AdminApp, deliberately OUTSIDE AdminGuard so sales
            agents can reach /admin/crm/* without the full admin panel. Matched
            before admin/* so any other /admin/... URL still hits AdminGuard. */}
        <Route path="admin/crm/*" element={<CrmApp />} />

        {/* Admin / super panel — own layout (same guarded app, two entry paths) */}
        <Route path="admin/*" element={<AdminApp />} />
        <Route path="super/*" element={<AdminApp />} />

        {/* Authenticated app */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="dashboard" element={<DashboardPage />} />
            {/* Voice-only — gated behind the per-business voice_ai flag */}
            <Route element={<VoiceRoute />}>
              <Route path="calls" element={<CallsPage />} />
            </Route>
            <Route path="inbox" element={<InboxPage />} />
            <Route path="appointments" element={<AppointmentsPage />} />
            <Route path="quotes" element={<QuotesPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="invoices/new" element={<VoiceInvoicePage />} />
            {/* Full-app only — simple-portal (client) accounts bounce to /dashboard */}
            <Route element={<FullAppRoute />}>
              <Route path="leads" element={<LeadsPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="knowledge" element={<KnowledgeBasePage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="contacts" element={<ContactsPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="agents" element={<AgentLayout />}>
                <Route index element={<Navigate to="personality" replace />} />
                <Route path="personality" element={<AiPersonalityPage />} />
                <Route path="calling" element={<CallBehaviourPage />} />
                <Route path="classification" element={<ClassificationPage />} />
                <Route path="followup" element={<FollowupPage />} />
                <Route path="handoff" element={<HandoffPage />} />
              </Route>
              <Route path="connections" element={<ConnectionsPage />} />
            </Route>
            <Route path="agent/*" element={<Navigate to="/agents" replace />} />
            <Route path="account/*" element={<AccountPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
