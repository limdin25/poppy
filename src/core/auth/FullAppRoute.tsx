import { Navigate, Outlet } from 'react-router-dom'
import { usePortalMode } from '@/core/hooks/usePortalMode'

/**
 * Gate for full-app routes (Leads, Campaigns, Knowledge Base, Templates,
 * AI Agent, Integrations, Analytics, Billing, Contacts). Simple-portal
 * (client) accounts are sent back to the dashboard — their app is only
 * Inbox, Appointments, Calls, Quotes and Invoices.
 */
export function FullAppRoute() {
  const { enabled: portal, loading } = usePortalMode()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (portal) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
