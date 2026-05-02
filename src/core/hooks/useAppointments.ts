import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Appointment } from '@/core/types/database'

export function useAppointments() {
  const { businessId } = useAuth()

  return useSupabaseQuery<Appointment>(
    () =>
      supabase
        .from('appointments')
        .select('*, contact:contacts(*), service:services(*)')
        .eq('business_id', businessId!)
        .order('starts_at', { ascending: true }),
    [businessId]
  )
}
