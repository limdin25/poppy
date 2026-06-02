import { useEffect, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

/**
 * Whether the current business has the voice/calls receptionist provisioned.
 * Reads the per-business `voice_ai` feature flag. No flag row = OFF, so public
 * WhatsApp signups never see Calls/voice. Super-admins enable it per account.
 */
export function useVoiceEnabled(): { enabled: boolean; loading: boolean } {
  const { businessId, loading: authLoading } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (authLoading) return
    if (!businessId) {
      setEnabled(false)
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('feature_flags')
      .select('enabled')
      .eq('business_id', businessId)
      .eq('flag_key', 'voice_ai')
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setEnabled(data?.enabled === true)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [businessId, authLoading])

  return { enabled, loading }
}
