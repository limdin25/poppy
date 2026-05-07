import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseRow, supabase } from '@/core/hooks/useSupabaseQuery'
import type { Agent } from '@/core/types/database'

export function useAgent(agentId: string) {
  const { businessId } = useAuth()
  return useSupabaseRow<Agent>(
    () =>
      supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .eq('business_id', businessId!)
        .single(),
    [agentId, businessId]
  )
}
