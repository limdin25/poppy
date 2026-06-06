import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Agent } from '@/core/types/database'

const CHANNEL_TYPES = ['voice', 'whatsapp', 'sms', 'email']

/**
 * Loads the agent the AI Agent settings should edit. If a channel is selected
 * (?ch=voice|whatsapp|sms|email — set by the layout's "Configure settings for"
 * picker) it loads THAT channel's agent, creating the four per-channel agents on
 * first use. Otherwise it falls back to the default agent. Every settings sub-
 * page uses this hook, so they all scope to the selected channel automatically.
 */
export function useDefaultAgent() {
  const { businessId, session } = useAuth()
  const [searchParams] = useSearchParams()
  const channel = searchParams.get('ch')
  const scoped = channel && CHANNEL_TYPES.includes(channel) ? channel : null
  // Optional: pin to a specific agent row (e.g. a specific phone number's voice
  // agent, chosen in the number switcher). Honoured only when it matches the
  // current channel type, so switching channels can't load the wrong agent.
  const pinnedAgentId = searchParams.get('agent')

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!businessId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const fetchRows = async () => {
      const { data, error: err } = await supabase
        .from('agents').select('*').eq('business_id', businessId).order('sort_order')
      if (err) throw err
      return (data ?? []) as Agent[]
    }

    try {
      let rows = await fetchRows()
      // Selected a channel whose agent doesn't exist yet → create the 4 per-channel agents.
      if (scoped && session && !rows.some((a) => a.agent_type === scoped)) {
        await fetch('/api/agent/channels', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).catch(() => {})
        rows = await fetchRows()
      }
      // A pinned agent wins when it exists and matches the current channel type.
      const pinned = pinnedAgentId
        ? rows.find((a) => a.id === pinnedAgentId && (!scoped || a.agent_type === scoped))
        : undefined
      const chosen = pinned
        ?? (scoped
          ? (rows.find((a) => a.agent_type === scoped) ?? rows.find((a) => a.is_default) ?? rows[0] ?? null)
          : (rows.find((a) => a.is_default) ?? rows.find((a) => a.agent_type === 'whatsapp') ?? rows[0] ?? null))
      setAgent(chosen)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agent')
    } finally {
      setLoading(false)
    }
  }, [businessId, scoped, session, pinnedAgentId])

  useEffect(() => { load() }, [load])

  /** Persist a partial update to the agent row. Returns true on success. */
  const saveAgent = useCallback(
    async (patch: Partial<Agent>): Promise<boolean> => {
      if (!agent || !businessId) return false
      const { error: err } = await supabase
        .from('agents').update(patch).eq('id', agent.id).eq('business_id', businessId)
      if (err) return false
      setAgent((prev) => (prev ? { ...prev, ...patch } : prev))
      return true
    },
    [agent, businessId],
  )

  return { agent, businessId, loading, error, reload: load, saveAgent }
}
