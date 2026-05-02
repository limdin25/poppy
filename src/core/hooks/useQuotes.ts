import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Quote } from '@/core/types/database'

export function useQuotes() {
  const { businessId } = useAuth()

  return useSupabaseQuery<Quote>(
    () =>
      supabase
        .from('quotes')
        .select('*, contact:contacts(*)')
        .eq('business_id', businessId!)
        .order('created_at', { ascending: false }),
    [businessId]
  )
}
