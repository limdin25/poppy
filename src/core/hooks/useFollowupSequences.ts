import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from './useSupabaseQuery'

export interface FollowupStep { after_hours: number; message: string }
export interface FollowupSequence {
  id: string
  business_id: string
  name: string
  steps: FollowupStep[]
  created_at: string
}

/** CRUD for follow-up sequences (the named "types" of auto follow-up). Same
 * table the inbox follow-up picker and the cron sender read from. */
export function useFollowupSequences() {
  const { businessId } = useAuth()
  const [data, setData] = useState<FollowupSequence[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!businessId) { setData([]); setLoading(false); return }
    const { data: rows } = await supabase
      .from('followup_sequences')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: true })
    setData((rows ?? []) as FollowupSequence[])
    setLoading(false)
  }, [businessId])

  useEffect(() => { void load() }, [load])

  const create = useCallback(async (name: string, steps: FollowupStep[]) => {
    if (!businessId) return
    await supabase.from('followup_sequences').insert({ business_id: businessId, name, steps })
    await load()
  }, [businessId, load])

  const update = useCallback(async (id: string, name: string, steps: FollowupStep[]) => {
    await supabase.from('followup_sequences').update({ name, steps }).eq('id', id)
    await load()
  }, [load])

  const remove = useCallback(async (id: string) => {
    await supabase.from('followup_sequences').delete().eq('id', id)
    await load()
  }, [load])

  return { data, loading, create, update, remove, refetch: load }
}
