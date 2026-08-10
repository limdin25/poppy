import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AdminProvider } from './context/AdminContext'
import AdminGuard from './AdminGuard'
import AdminLayout from './AdminLayout'

const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))
const BusinessesPage = lazy(() => import('./pages/BusinessesPage'))
const BusinessDetailPage = lazy(() => import('./pages/BusinessDetailPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const CallMonitorPage = lazy(() => import('./pages/CallMonitorPage'))
const ConversationMonitorPage = lazy(() => import('./pages/ConversationMonitorPage'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const AIManagementPage = lazy(() => import('./pages/AIManagementPage'))
const NumberManagementPage = lazy(() => import('./pages/NumberManagementPage'))
const FeatureFlagsPage = lazy(() => import('./pages/FeatureFlagsPage'))
const SystemHealthPage = lazy(() => import('./pages/SystemHealthPage'))
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'))
const AdminAnalyticsPage = lazy(() => import('./pages/AdminAnalyticsPage'))
const PropertiesPage = lazy(() => import('./pages/PropertiesPage'))
const ScraperPage = lazy(() => import('./pages/ScraperPage'))
const PipelinePage = lazy(() => import('./pages/PipelinePage'))
const CeoCockpitPage = lazy(() => import('./pages/CeoCockpitPage'))
const PhoneValidationPage = lazy(() => import('./pages/PhoneValidationPage'))
const ReviewsAdminPage = lazy(() => import('./pages/ReviewsAdminPage'))
const TrainingPage = lazy(() => import('./pages/TrainingPage'))

function AdminFallback() {
  return (
    <div className="flex h-40 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
    </div>
  )
}

export default function AdminApp() {
  return (
    <AdminGuard>
      <AdminProvider>
        <Suspense fallback={<AdminFallback />}>
          <Routes>
            <Route element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="reviews" element={<ReviewsAdminPage />} />
              <Route path="ceo" element={<CeoCockpitPage />} />
              <Route path="businesses" element={<BusinessesPage />} />
              <Route path="businesses/:id" element={<BusinessDetailPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="calls" element={<CallMonitorPage />} />
              <Route path="conversations" element={<ConversationMonitorPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="ai" element={<AIManagementPage />} />
              <Route path="numbers" element={<NumberManagementPage />} />
              <Route path="feature-flags" element={<FeatureFlagsPage />} />
              <Route path="properties" element={<PropertiesPage />} />
              <Route path="scraper" element={<ScraperPage />} />
              <Route path="pipeline" element={<PipelinePage />} />
              <Route path="training" element={<TrainingPage />} />
              <Route path="phone-validation" element={<PhoneValidationPage />} />
              <Route path="system" element={<SystemHealthPage />} />
              <Route path="analytics" element={<AdminAnalyticsPage />} />
              <Route path="audit-log" element={<AuditLogPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </AdminProvider>
    </AdminGuard>
  )
}
