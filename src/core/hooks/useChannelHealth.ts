import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

export interface DisconnectedChannel {
  id: string
  type: string
  label: string
  phone: string | null
}

const PROVIDER_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
}

/**
 * Messaging channels (WhatsApp / Instagram) that have a linked Unipile account
 * but are currently disconnected — i.e. the QR session dropped and Elsie can no
 * longer send or receive on them. Drives the global reconnect banner.
 *
 * Re-checks on mount, when the tab regains focus, and every 60s (a drop is
 * detected by the per-minute poll, so this keeps the banner roughly in sync).
 */
export function useChannelHealth(): {
  disconnected: DisconnectedChannel[]
  refetch: () => void
} {
  const { businessId } = useAuth()
  const [disconnected, setDisconnected] = useState<DisconnectedChannel[]>([])

  const load = useCallback(async () => {
    if (!businessId) {
      setDisconnected([])
      return
    }
    const { data } = await supabase
      .from('channels')
      .select('id, type, status, config')
      .eq('business_id', businessId)
      .in('type', ['whatsapp', 'instagram'])
      .eq('status', 'disconnected')
      .not('unipile_account_id', 'is', null)

    setDisconnected(
      (data ?? []).map((ch) => {
        const cfg = (ch.config as { phone?: string } | null) || {}
        return {
          id: ch.id as string,
          type: ch.type as string,
          label: PROVIDER_LABEL[ch.type as string] || 'Channel',
          phone: cfg.phone ?? null,
        }
      }),
    )
  }, [businessId])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return { disconnected, refetch: load }
}
