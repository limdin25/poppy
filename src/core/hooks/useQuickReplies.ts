import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useAuth } from '@/core/auth/AuthProvider'

/**
 * Business-scoped quick replies ("Templates"). Backed by public.quick_replies
 * (RLS by business_id). Shared by the Templates page and the Inbox composer
 * picker so both read/write the same rows. WhatsApp-only, no credits.
 */

export interface QuickReply {
  id: string
  business_id: string
  title: string
  body: string
  sort_order: number
  created_at: string
  updated_at: string
}

export function useQuickReplies() {
  const { businessId } = useAuth()
  const [data, setData] = useState<QuickReply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!businessId) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const { data: rows, error: err } = await supabase
      .from('quick_replies')
      .select('*')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
    if (err) setError(err.message)
    else setData((rows ?? []) as QuickReply[])
    setLoading(false)
  }, [businessId])

  useEffect(() => {
    refetch()
  }, [refetch])

  /** Insert a new quick reply, appended at the end. */
  const create = useCallback(
    async (title: string, body: string) => {
      if (!businessId) return
      const sort_order = data.length ? Math.max(...data.map((q) => q.sort_order)) + 1 : 0
      const { error: err } = await supabase
        .from('quick_replies')
        .insert({ business_id: businessId, title, body, sort_order })
      if (err) {
        setError(err.message)
        return
      }
      await refetch()
    },
    [businessId, data, refetch]
  )

  /** Update title/body of an existing quick reply. */
  const update = useCallback(
    async (id: string, title: string, body: string) => {
      const { error: err } = await supabase
        .from('quick_replies')
        .update({ title, body, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (err) {
        setError(err.message)
        return
      }
      await refetch()
    },
    [refetch]
  )

  /** Delete a quick reply. */
  const remove = useCallback(
    async (id: string) => {
      const { error: err } = await supabase.from('quick_replies').delete().eq('id', id)
      if (err) {
        setError(err.message)
        return
      }
      await refetch()
    },
    [refetch]
  )

  return { data, loading, error, refetch, create, update, remove }
}

/** Replace the {name} token with a contact's display name. */
export function fillTokens(body: string, name: string): string {
  return body.replace(/\{name\}/g, name)
}
