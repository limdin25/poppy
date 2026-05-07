import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from '@/core/hooks/useSupabaseQuery'
import type { Agent } from '@/core/types/database'

export function useAgents() {
  const { businessId } = useAuth()
  return useSupabaseQuery<Agent>(
    () => supabase.from('agents').select('*').eq('business_id', businessId!).order('sort_order'),
    [businessId]
  )
}
