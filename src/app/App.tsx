import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './Layout'
import { ProtectedRoute } from '@/core/auth/ProtectedRoute'
import { VoiceRoute } from '@/core/auth/VoiceRoute'

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
const AgentLayout = lazy(() => import('@/features/agents/AgentLayout'))
const AiPersonalityPage = lazy(() => import('@/features/agents/settings/AiPersonalityPage'))
const ClassificationPage = lazy(() => import('@/features/agents/settings/ClassificationPage'))
const FollowupPage = lazy(() => import('@/features/agents/settings/FollowupPage'))
const HandoffPage = lazy(() => import('@/features/agents/settings/HandoffPage'))
const TemplatesPage = lazy(() => import('@/features/templates/TemplatesPage'))
const ConnectionsPage = lazy(() => import('@/features/connections/ConnectionsPage'))
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'))
const AccountPage = lazy(() => import('@/features/account/AccountPage'))
const BillingPage = lazy(() => import('@/features/billing/BillingPage'))
const AdminApp = lazy(() => import('@/features/admin/AdminApp'))
const LandingPage = lazy(() => import('@/features/landing/LandingPage'))
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

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Public — no layout */}
        <Route path="welcome" element={<LandingPage />} />
        <Route path="privacy" element={<PrivacyPolicyPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="dpa" element={<DpaPage />} />
        <Route path="register" element={<RegistrationPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />

        {/* Admin / super panel — own layout (same guarded app, two entry paths) */}
        <Route path="admin/*" element={<AdminApp />} />
        <Route path="super/*" element={<AdminApp />} />

        {/* Authenticated app */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            {/* Voice-only — gated behind the per-business voice_ai flag */}
            <Route element={<VoiceRoute />}>
              <Route path="calls" element={<CallsPage />} />
            </Route>
            <Route path="inbox" element={<InboxPage />} />
            <Route path="leads" element={<LeadsPage />} />
            <Route path="campaigns" element={<CampaignsPage />} />
            <Route path="knowledge" element={<KnowledgeBasePage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="appointments" element={<AppointmentsPage />} />
            <Route path="quotes" element={<QuotesPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="agents" element={<AgentLayout />}>
              <Route index element={<Navigate to="personality" replace />} />
              <Route path="personality" element={<AiPersonalityPage />} />
              <Route path="classification" element={<ClassificationPage />} />
              <Route path="followup" element={<FollowupPage />} />
              <Route path="handoff" element={<HandoffPage />} />
            </Route>
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="agent/*" element={<Navigate to="/agents" replace />} />
            <Route path="account/*" element={<AccountPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
