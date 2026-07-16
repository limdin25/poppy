import { Navigate, Outlet } from 'react-router-dom'
import { useVoiceEnabled } from '@/core/hooks/useVoiceEnabled'
import { usePortalMode } from '@/core/hooks/usePortalMode'

/**
 * Gate for voice/calls-only routes. Redirects WhatsApp-only (public) accounts
 * to the dashboard. Voice is unlocked per-business via the `voice_ai` flag,
 * provisioned by a super-admin. Simple-portal (client) accounts always get
 * Calls — it's part of their slim menu, empty until their line is provisioned.
 */
export function VoiceRoute() {
  const { enabled: voice, loading: voiceLoading } = useVoiceEnabled()
  const { enabled: portal, loading: portalLoading } = usePortalMode()
  const loading = voiceLoading || portalLoading

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (!voice && !portal) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
