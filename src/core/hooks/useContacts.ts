import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Contact } from '@/core/types/database'

export function useContacts() {
  const { businessId } = useAuth()

  return useSupabaseQuery<Contact>(
    () =>
      supabase
        .from('contacts')
        .select('*')
        .eq('business_id', businessId!)
        .order('updated_at', { ascending: false }),
    [businessId]
  )
}
