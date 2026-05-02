import { useAuth } from '@/core/auth/AuthProvider'
import { useSupabaseQuery, supabase } from './useSupabaseQuery'
import type { Conversation, Message } from '@/core/types/database'

export function useConversations() {
  const { businessId } = useAuth()

  return useSupabaseQuery<Conversation>(
    () =>
      supabase
        .from('conversations')
        .select('*, contact:contacts(*)')
        .eq('business_id', businessId!)
        .order('last_message_at', { ascending: false }),
    [businessId]
  )
}

export function useMessages(conversationId: string | null) {
  return useSupabaseQuery<Message>(
    () =>
      supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId!)
        .order('created_at', { ascending: true }),
    [conversationId]
  )
}
