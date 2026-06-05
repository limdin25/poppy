import { useState } from 'react'
import { AlertTriangle, Loader2, ExternalLink } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useChannelHealth } from '@/core/hooks/useChannelHealth'

/**
 * Global "channel disconnected" alert stripe. Renders nothing when everything
 * is healthy; when a WhatsApp/Instagram channel drops it shows a loud red bar
 * across the top of the app (every page, since it lives in the Layout) so the
 * owner can't miss it. The Reconnect button uses the RECONNECT endpoint (same
 * Unipile account, no duplicate) and opens the hosted QR in a new tab.
 */
export function ChannelAlertBanner() {
  const { disconnected } = useChannelHealth()
  const { session } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (disconnected.length === 0) return null

  const primary = disconnected[0]
  const labels = Array.from(new Set(disconnected.map((d) => d.label)))
  const labelText = labels.join(' & ')
  const phoneSuffix = labels.length === 1 && primary.phone ? ` (${primary.phone})` : ''

  async function reconnect() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/channels/whatsapp/reconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ channelId: primary.id }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error || 'Could not start reconnect. Please try again.')
        return
      }
      window.open(data.url, '_blank', 'noopener')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 bg-red-600 px-4 py-2.5 text-[13px] text-white">
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <AlertTriangle size={15} className="shrink-0" />
        <span className="min-w-0">
          <strong className="font-semibold">{labelText} disconnected{phoneSuffix}.</strong>{' '}
          <span className="text-white/90">
            Elsie isn't receiving or replying to messages until you reconnect.
          </span>
          {error && <span className="ml-1 text-white/80">— {error}</span>}
        </span>
      </div>
      <button
        onClick={reconnect}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-[12.5px] font-semibold text-red-700 transition hover:bg-white/90 disabled:opacity-70"
      >
        {busy ? (
          <>
            <Loader2 size={13} className="animate-spin" /> Opening…
          </>
        ) : (
          <>
            Reconnect now <ExternalLink size={13} />
          </>
        )}
      </button>
    </div>
  )
}
