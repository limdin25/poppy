import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Call } from '@/core/types/database'

export function useCalls(agentId: string | null = null) {
  const { businessId } = useAuth()

  return useSupabaseQuery<Call>(
    () => {
      let q = supabase
        .from('calls')
        .select('*, contact:contacts(*)')
        .eq('business_id', businessId!)
      // Per-number filter: each phone number is its own agent row.
      if (agentId) q = q.eq('agent_id', agentId)
      return q.order('created_at', { ascending: false })
    },
    [businessId, agentId]
  )
}
