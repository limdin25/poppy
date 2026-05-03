import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from './useSupabaseQuery'
import type { Conversation, Message } from '@/core/types/database'

export type ChannelFilter = 'all' | 'email' | 'whatsapp' | 'sms' | 'voice'

export function useConversations(channelFilter: ChannelFilter = 'all') {
  const { businessId } = useAuth()
  const [data, setData] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    let query = supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('business_id', businessId)
    if (channelFilter !== 'all') {
      query = query.eq('channel', channelFilter)
    }
    const { data: rows, error } = await query.order('last_message_at', { ascending: false })
    const safe = error
      ? []
      : (rows ?? []).filter((r: any) => r.is_spam !== true)
    setData(safe as Conversation[])
    setLoading(false)
  }, [businessId, channelFilter])

  useEffect(() => { fetch() }, [fetch])

  // Realtime: listen for any changes to conversations for this business
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
        () => { fetch() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [businessId, fetch])

  return { data, loading, refetch: fetch }
}

export function useMessages(conversationId: string | null) {
  const [data, setData] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!conversationId) { setData([]); setLoading(false); return }
    setLoading(true)
    const { data: rows } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    setData((rows ?? []) as Message[])
    setLoading(false)
  }, [conversationId])

  useEffect(() => { fetch() }, [fetch])

  // Realtime: listen for new messages in this conversation
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
        () => { fetch() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [conversationId, fetch])

  return { data, loading, refetch: fetch }
}
