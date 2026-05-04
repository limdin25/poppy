import { useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'

export function useSyncPrompt() {
  const { businessId, session } = useAuth()
  const [syncing, setSyncing] = useState(false)

  async function syncPrompt(): Promise<boolean> {
    if (!businessId || !session) return false
    setSyncing(true)
    try {
      const res = await fetch('/api/agent/sync-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ businessId }),
      })
      return res.ok
    } catch {
      return false
    } finally {
      setSyncing(false)
    }
  }

  return { syncPrompt, syncing }
}
