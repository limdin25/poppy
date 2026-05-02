import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseRow, supabase } from './useSupabaseQuery'
import type { Business } from '@/core/types/database'

export function useBusiness() {
  const { businessId } = useAuth()

  return useSupabaseRow<Business>(
    () =>
      supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId!)
        .single(),
    [businessId]
  )
}
