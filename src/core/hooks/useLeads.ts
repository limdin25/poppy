import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Contact } from '@/core/types/database'

/**
 * Every contact for the business, most recently active first. The Leads page
 * shows the full list (lifecycle Status + AI Classification columns), matching
 * the reference dashboard — not just AI-classified leads.
 */
export function useLeads() {
  const { businessId } = useAuth()

  return useSupabaseQuery<Contact>(
    () =>
      supabase
        .from('contacts')
        .select('*')
        .eq('business_id', businessId!)
        .order('updated_at', { ascending: false, nullsFirst: false }),
    [businessId]
  )
}
