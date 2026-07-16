import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import CrmLayout from './layout/Smsv2Layout'
import AdminOnlyRoute from './components/AdminOnlyRoute'

const CrmLoginPage = lazy(() => import('./pages/CrmLoginPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))
const CallsPage = lazy(() => import('./pages/CallsPage'))
const PastCallScreen = lazy(() => import('./pages/PastCallScreen'))
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'))
const ContactsPage = lazy(() => import('./pages/ContactsPage'))
const ContactDetailPage = lazy(() => import('./pages/ContactDetailPage'))
const PipelinesPage = lazy(() => import('./pages/PipelinesPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const DialerProPage = lazy(() => import('./dialer-pro/DialerProPage'))
const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage'))
const CrmAgentLayout = lazy(() => import('./agent/CrmAgentLayout'))
const CrmAgentPersonalityPage = lazy(() => import('./agent/CrmAgentPersonalityPage'))
const CrmCallBehaviourPage = lazy(() => import('./agent/CrmCallBehaviourPage'))

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
          {/* Public — outside CrmGuard (CrmLayout embeds the guard). */}
          <Route path="login" element={<CrmLoginPage />} />
          <Route element={<CrmLayout />}>
            <Route index element={<Navigate to="inbox" replace />} />
            <Route path="dashboard" element={<AdminOnlyRoute><DashboardPage /></AdminOnlyRoute>} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="calls" element={<CallsPage />} />
            <Route path="calls/:callId" element={<PastCallScreen />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="dialer" element={<Navigate to="/admin/crm/dialer-pro" replace />} />
            <Route path="dialer-pro" element={<DialerProPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="broadcasts" element={<BroadcastsPage />} />
            <Route path="agent" element={<AdminOnlyRoute><CrmAgentLayout /></AdminOnlyRoute>}>
              <Route index element={<Navigate to="personality" replace />} />
              <Route path="personality" element={<CrmAgentPersonalityPage />} />
              <Route path="calling" element={<CrmCallBehaviourPage />} />
            </Route>
            {/* Old bare warm-up form — now the SMS tab of the full agent UI. */}
            <Route path="ai-warmup" element={<Navigate to="/admin/crm/agent/personality?ch=sms" replace />} />
            <Route path="contacts/:id" element={<ContactDetailPage />} />
            <Route path="pipelines" element={<PipelinesPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="settings" element={<AdminOnlyRoute><SettingsPage /></AdminOnlyRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/admin/crm" replace />} />
        </Routes>
      </Suspense>
    </QueryClientProvider>
  )
}
