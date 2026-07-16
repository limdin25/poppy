import { useEffect, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

/**
 * Whether the current business is a simple-portal (client/tradesperson) account.
 * Reads the per-business `simple_portal` feature flag. Portal accounts get the
 * slim menu (Inbox, Appointments, Calls, Quotes, Invoices, Settings) and are
 * redirected away from full-app routes. No flag row = full app, so existing
 * accounts (Hugo, demos, QA) are unaffected; registration turns it on for new
 * sign-ups and admins toggle it per account in Admin → Feature Flags.
 */
export function usePortalMode(): { enabled: boolean; loading: boolean } {
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
      .eq('flag_key', 'simple_portal')
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
