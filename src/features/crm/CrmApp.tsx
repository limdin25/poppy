import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import CrmLayout from './layout/Smsv2Layout'
import AdminOnlyRoute from './components/AdminOnlyRoute'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))
const CallsPage = lazy(() => import('./pages/CallsPage'))
const PastCallScreen = lazy(() => import('./pages/PastCallScreen'))
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'))
const DealProcessPage = lazy(() => import('./pages/DealProcessPage'))
const DealCockpitPage = lazy(() => import('./pages/DealCockpitPage'))
const RawLeadsPage = lazy(() => import('./pages/RawLeadsPage'))
const ContactsPage = lazy(() => import('./pages/ContactsPage'))
const ContactDetailPage = lazy(() => import('./pages/ContactDetailPage'))
const PipelinesPage = lazy(() => import('./pages/PipelinesPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const DialerProPage = lazy(() => import('./dialer-pro/DialerProPage'))
const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage'))

// CRM-scoped query client — react-query stays contained to this feature.
const crmQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

const Fallback = () => (
  <div className="flex h-screen items-center justify-center">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
  </div>
)

export default function CrmApp() {
  return (
    <QueryClientProvider client={crmQueryClient}>
      <Suspense fallback={<Fallback />}>
        <Routes>
          {/* Old CRM login URL — consolidated into the single app login at
              /login, which routes staff straight to the CRM by role. */}
          <Route path="login" element={<Navigate to="/login" replace />} />
          <Route element={<CrmLayout />}>
            <Route index element={<Navigate to="inbox" replace />} />
            <Route path="dashboard" element={<AdminOnlyRoute><DashboardPage /></AdminOnlyRoute>} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="calls" element={<CallsPage />} />
            <Route path="calls/:callId" element={<PastCallScreen />} />
            <Route path="templates" element={<TemplatesPage />} />
            {/* The property deal process, step by step. Its own page under
                Templates in the menu (Hugo 2026-08-12), not a tab inside it. */}
            <Route path="cockpit" element={<DealCockpitPage />} />
            <Route path="raw-leads" element={<AdminOnlyRoute><RawLeadsPage /></AdminOnlyRoute>} />
            <Route path="deal-process" element={<DealProcessPage />} />
            <Route path="dialer" element={<Navigate to="/admin/crm/dialer-pro" replace />} />
            <Route path="dialer-pro" element={<DialerProPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="broadcasts" element={<BroadcastsPage />} />
            <Route path="contacts/:id" element={<ContactDetailPage />} />
            <Route path="pipelines" element={<PipelinesPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            {/* RETIRED 2026-08-14, this CRM is the property business only.
                The lazy imports were removed with the routes (noUnusedLocals).
                Hugo: "hide anything related to Video funnel, Website flow,
                because this crm is for property only now."

                video-funnel, site-flow, ai-calls, agent/* and ai-warmup all
                belonged to the reviews and receptionist businesses. The pages,
                their hooks and every table are UNTOUCHED on disk, so restoring
                one is a route and a nav entry. Old links fall through to the
                catch-all below and land on the CRM home rather than a 404. */}
            <Route path="settings" element={<AdminOnlyRoute><SettingsPage /></AdminOnlyRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/admin/crm" replace />} />
        </Routes>
      </Suspense>
    </QueryClientProvider>
  )
}
