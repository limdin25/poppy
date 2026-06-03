import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Agent } from '@/core/types/database'

/**
 * Loads the business's DEFAULT WhatsApp agent for the AI Agent settings area.
 * Preference order: is_default === true → agent_type === 'whatsapp' → first row.
 *
 * Returns the agent row + helpers to persist updates back to the `agents`
 * table. Used by every sub-page (Personality / Classification / Follow-up /
 * Handoff) so they all read + write the same real agent record.
 */
export function useDefaultAgent() {
  const { businessId } = useAuth()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('agents')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order')
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    const rows = (data ?? []) as Agent[]
    const chosen =
      rows.find((a) => a.is_default) ??
      rows.find((a) => a.agent_type === 'whatsapp') ??
      rows[0] ??
      null
    setAgent(chosen)
    setLoading(false)
  }, [businessId])

  useEffect(() => {
    load()
  }, [load])

  /** Persist a partial update to the agent row. Returns true on success. */
  const saveAgent = useCallback(
    async (patch: Partial<Agent>): Promise<boolean> => {
      if (!agent || !businessId) return false
      const { error: err } = await supabase
        .from('agents')
        .update(patch)
        .eq('id', agent.id)
        .eq('business_id', businessId)
      if (err) return false
      setAgent((prev) => (prev ? { ...prev, ...patch } : prev))
      return true
    },
    [agent, businessId],
  )

  return { agent, businessId, loading, error, reload: load, saveAgent }
}
