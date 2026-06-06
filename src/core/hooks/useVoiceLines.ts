import { useEffect, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { formatPhone } from '@/core/lib/formatPhone'
import { supabase } from './useSupabaseQuery'

export interface VoiceLine {
  /** The voice agent row id — used to filter conversations/calls by number. */
  id: string
  /** Display label: the phone number (formatted). Never the internal agent name. */
  label: string
  isDefault: boolean
}

/**
 * The business's phone numbers. Each voice number is its own agent row, linked
 * to a channel that carries the phone in its config. Powers the number switcher
 * (agent settings) and the "filter by number" controls in the inbox and calls.
 */
export function useVoiceLines() {
  const { businessId } = useAuth()
  const [lines, setLines] = useState<VoiceLine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!businessId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      const [{ data: agents }, { data: channels }] = await Promise.all([
        supabase.from('agents').select('id, name, is_default').eq('business_id', businessId).eq('agent_type', 'voice').order('sort_order'),
        supabase.from('channels').select('agent_id, config').eq('business_id', businessId).eq('type', 'voice'),
      ])
      if (cancelled) return
      const phoneByAgent: Record<string, string> = {}
      for (const ch of (channels ?? []) as Array<{ agent_id: string | null; config: Record<string, unknown> | null }>) {
        if (ch.agent_id && ch.config?.phone) phoneByAgent[ch.agent_id] = String(ch.config.phone)
      }
      setLines(((agents ?? []) as Array<{ id: string; name: string | null; is_default: boolean }>)
        // Only voice numbers (those with a phone). The label is the number itself,
        // never the internal agent name like "USA Sales Assistant".
        .filter((a) => !!phoneByAgent[a.id])
        .map((a) => ({
          id: a.id,
          label: formatPhone(phoneByAgent[a.id]),
          isDefault: a.is_default,
        })))
      setLoading(false)
    })().catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [businessId])

  return { lines, loading }
}
