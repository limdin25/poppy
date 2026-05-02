import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Call } from '@/core/types/database'

export function useCalls() {
  const { businessId } = useAuth()

  return useSupabaseQuery<Call>(
    () =>
      supabase
        .from('calls')
        .select('*, contact:contacts(*)')
        .eq('business_id', businessId!)
        .order('created_at', { ascending: false }),
    [businessId]
  )
}
