import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from './useSupabaseQuery'
import type { Conversation, Message } from '@/core/types/database'

export type ChannelFilter = 'all' | 'email' | 'whatsapp' | 'sms' | 'voice'

export function useConversations(channelFilter: ChannelFilter = 'all', agentId: string | null = null) {
  const { businessId } = useAuth()
  const [data, setData] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const hasFetched = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadData = useCallback(async (silent = false) => {
    if (!businessId) return
    if (!silent) setLoading(true)
    let query = supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('business_id', businessId)
    if (channelFilter !== 'all') {
      query = query.eq('channel', channelFilter)
    }
    // Per-number filter: each phone number is its own agent row.
    if (agentId) {
      query = query.eq('agent_id', agentId)
    }
    const { data: rows, error } = await query.order('last_message_at', { ascending: false })
    const safe = error
      ? []
      : (rows ?? []).filter((r: any) => r.is_spam !== true)
    setData(safe as Conversation[])
    setLoading(false)
    hasFetched.current = true
  }, [businessId, channelFilter, agentId])

  useEffect(() => {
    hasFetched.current = false
    loadData(false)
  }, [loadData])

  useEffect(() => {
    if (!businessId) return
    const channel = supabase
      .channel('conversations-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `business_id=eq.${businessId}`,
        },
        () => {
          clearTimeout(debounceTimer.current)
          debounceTimer.current = setTimeout(() => { loadData(true) }, 500)
        }
      )
      .subscribe()

    return () => {
      clearTimeout(debounceTimer.current)
      supabase.removeChannel(channel)
    }
  }, [businessId, loadData])

  return { data, loading, refetch: loadData }
}

export function useMessages(conversationId: string | null) {
  const [data, setData] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const hasFetched = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadData = useCallback(async (silent = false) => {
    if (!conversationId) { setData([]); setLoading(false); return }
    if (!silent) setLoading(true)
    const { data: rows } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    setData((rows ?? []) as Message[])
    setLoading(false)
    hasFetched.current = true
  }, [conversationId])

  useEffect(() => {
    hasFetched.current = false
    loadData(false)
  }, [loadData])

  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          clearTimeout(debounceTimer.current)
          debounceTimer.current = setTimeout(() => { loadData(true) }, 300)
        }
      )
      .subscribe()

    return () => {
      clearTimeout(debounceTimer.current)
      supabase.removeChannel(channel)
    }
  }, [conversationId, loadData])

  return { data, loading, refetch: loadData }
}
