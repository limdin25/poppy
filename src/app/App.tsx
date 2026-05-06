import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './Layout'
import { ProtectedRoute } from '@/core/auth/ProtectedRoute'

const RegistrationPage = lazy(() => import('@/features/registration/RegistrationPage'))
const OnboardingPage = lazy(() => import('@/features/onboarding/OnboardingPage'))
const LoginPage = lazy(() => import('@/features/auth/LoginPage'))
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage'))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const CallsPage = lazy(() => import('@/features/calls/CallsPage'))
const InboxPage = lazy(() => import('@/features/inbox/InboxPage'))
const ContactsPage = lazy(() => import('@/features/contacts/ContactsPage'))
const AppointmentsPage = lazy(() => import('@/features/appointments/AppointmentsPage'))
const QuotesPage = lazy(() => import('@/features/quotes/QuotesPage'))
const InvoicesPage = lazy(() => import('@/features/invoices/InvoicesPage'))
const AgentSetupPage = lazy(() => import('@/features/agent-setup/AgentSetupPage'))
const AccountPage = lazy(() => import('@/features/account/AccountPage'))
const AdminApp = lazy(() => import('@/features/admin/AdminApp'))
const LandingPage = lazy(() => import('@/features/landing/LandingPage'))

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
        <Route path="register" element={<RegistrationPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />

        {/* Admin panel — own layout */}
        <Route path="admin/*" element={<AdminApp />} />

        {/* Authenticated app */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="calls" element={<CallsPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="appointments" element={<AppointmentsPage />} />
            <Route path="quotes" element={<QuotesPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="agent/*" element={<AgentSetupPage />} />
            <Route path="account/*" element={<AccountPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
