import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Invoice } from '@/core/types/database'

export function useInvoices() {
  const { businessId } = useAuth()

  return useSupabaseQuery<Invoice>(
    () =>
      supabase
        .from('invoices')
        .select('*, contact:contacts(*)')
        .eq('business_id', businessId!)
        .order('created_at', { ascending: false }),
    [businessId]
  )
}
