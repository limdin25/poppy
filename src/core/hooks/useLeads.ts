import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Contact } from '@/core/types/database'

/**
 * Contacts that have been classified as leads (hot/warm/cold), most recently
 * updated first. New/unclassified contacts are excluded from the lead view.
 */
export function useLeads() {
  const { businessId } = useAuth()

  return useSupabaseQuery<Contact>(
    () =>
      supabase
        .from('contacts')
        .select('*')
        .eq('business_id', businessId!)
        .in('lead_status', ['hot', 'warm', 'cold'])
        .order('lead_updated_at', { ascending: false, nullsFirst: false }),
    [businessId]
  )
}
