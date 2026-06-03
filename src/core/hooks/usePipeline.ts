import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from './useSupabaseQuery'
import type { Deal, PipelineStage } from '@/core/types/database'

/** Editable pipeline stages for the current business (ordered by sort_order). */
export function usePipelineStages() {
  const { businessId } = useAuth()
  const [data, setData] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!businessId) {
      setData([])
      setLoading(false)
      return
    }
    const { data: rows } = await supabase
      .from('pipeline_stages')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
    setData((rows ?? []) as PipelineStage[])
    setLoading(false)
  }, [businessId])

  useEffect(() => { void load() }, [load])
  return { data, loading, refetch: load }
}

/** Deals (sale opportunities) for the current business, with their linked contact. */
export function useDeals() {
  const { businessId } = useAuth()
  const [data, setData] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!businessId) {
      setData([])
      setLoading(false)
      return
    }
    const { data: rows } = await supabase
      .from('deals')
      .select('*, contact:contacts(*)')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
    setData((rows ?? []) as Deal[])
    setLoading(false)
  }, [businessId])

  useEffect(() => { void load() }, [load])
  return { data, loading, refetch: load }
}
