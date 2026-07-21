import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthProvider'

// Workspace roles that belong in the CRM (/admin/crm), not the receptionist app.
const CRM_ROLES = new Set(['agent', 'admin', 'viewer'])

export function ProtectedRoute() {
  const { user, loading, profileLoaded, businessId, workspaceRole } = useAuth()

  // Wait for both the session AND the profile (business + role) so we never
  // flash the receptionist dashboard before deciding where the user belongs.
  if (loading || (user && !profileLoaded)) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (!user) return <Navigate to="/welcome" replace />

  // A CRM contractor agent (or CRM admin/viewer) has a workspace_role but no
  // receptionist business. Send them to the CRM instead of the empty dashboard.
  // Owners (workspace_role null, or with a business) fall through to the app.
  if (!businessId && workspaceRole && CRM_ROLES.has(workspaceRole)) {
    return <Navigate to="/admin/crm/inbox" replace />
  }

  return <Outlet />
}
