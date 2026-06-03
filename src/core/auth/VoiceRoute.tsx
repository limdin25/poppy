import { Navigate, Outlet } from 'react-router-dom'
import { useVoiceEnabled } from '@/core/hooks/useVoiceEnabled'

/**
 * Gate for voice/calls-only routes. Redirects WhatsApp-only (public) accounts
 * to the dashboard. Voice is unlocked per-business via the `voice_ai` flag,
 * provisioned by a super-admin.
 */
export function VoiceRoute() {
  const { enabled, loading } = useVoiceEnabled()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (!enabled) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
