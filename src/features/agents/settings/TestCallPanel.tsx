import { useEffect, useRef, useState } from 'react'
import { Loader2, Phone, PhoneOff, Mic } from 'lucide-react'
import type { RetellWebClient } from 'retell-client-js-sdk'
import { SectionCard } from '@/core/ui/SectionCard'
import { Select } from '@/core/ui/Select'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

type Status = 'idle' | 'connecting' | 'live'

interface TestTarget { id: string; label: string }

/**
 * Talk to the agent straight from the browser (mic + speakers) — no phone
 * number needed. Starts a Retell WEB call against the selected number's agent,
 * the same way Retell's own "Test" button works.
 */
export function TestCallPanel({ agentId, session }: { agentId?: string; session: { access_token: string } | null }) {
  const { businessId } = useAuth()
  const [status, setStatus] = useState<Status>('idle')
  const [talking, setTalking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clientRef = useRef<RetellWebClient | null>(null)

  // A/B targets: this number's agent + any no-phone variant agents (e.g. the
  // English voice). Lets the owner test each voice from the browser.
  const [targets, setTargets] = useState<TestTarget[]>([])
  const [targetId, setTargetId] = useState<string | undefined>(agentId)

  useEffect(() => { setTargetId(agentId) }, [agentId])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    ;(async () => {
      const [{ data: agents }, { data: channels }] = await Promise.all([
        supabase.from('agents').select('id, name, is_default').eq('business_id', businessId).eq('agent_type', 'voice').order('sort_order'),
        supabase.from('channels').select('agent_id, config').eq('business_id', businessId).eq('type', 'voice'),
      ])
      if (cancelled) return
      const hasPhone = new Set<string>()
      for (const ch of (channels ?? []) as Array<{ agent_id: string | null; config: Record<string, unknown> | null }>) {
        if (ch.agent_id && ch.config?.phone) hasPhone.add(ch.agent_id)
      }
      const list: TestTarget[] = []
      // The currently-selected number first.
      const me = ((agents ?? []) as Array<{ id: string; name: string | null }>).find((a) => a.id === agentId)
      if (me) list.push({ id: me.id, label: `${me.name || 'This number'} (this line)` })
      // Then any variant agents (voice agents without their own phone number).
      for (const a of ((agents ?? []) as Array<{ id: string; name: string | null }>)) {
        if (!hasPhone.has(a.id) && a.id !== agentId) list.push({ id: a.id, label: a.name || 'Variant' })
      }
      setTargets(list)
    })().catch(() => {})
    return () => { cancelled = true }
  }, [businessId, agentId])

  useEffect(() => () => { clientRef.current?.stopCall() }, [])

  async function start() {
    if (!session || status !== 'idle') return
    setError(null); setStatus('connecting')
    try {
      const res = await fetch('/api/agent/web-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ agentId: targetId || agentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.access_token) {
        setError(data.error || 'Could not start the test call.'); setStatus('idle'); return
      }
      // Lazy-load the (large) web-call SDK only when the user actually tests.
      const { RetellWebClient } = await import('retell-client-js-sdk')
      const client = new RetellWebClient()
      clientRef.current = client
      client.on('call_started', () => setStatus('live'))
      client.on('call_ended', () => { setStatus('idle'); setTalking(false) })
      client.on('agent_start_talking', () => setTalking(true))
      client.on('agent_stop_talking', () => setTalking(false))
      client.on('error', (e: unknown) => {
        setError(typeof e === 'string' ? e : 'Call error — please try again.')
        client.stopCall(); setStatus('idle'); setTalking(false)
      })
      await client.startCall({ accessToken: data.access_token })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the test call. Allow microphone access and try again.')
      setStatus('idle')
    }
  }

  function stop() {
    clientRef.current?.stopCall()
    setStatus('idle'); setTalking(false)
  }

  const live = status === 'live'

  return (
    <SectionCard eyebrow="Calls" title="Test Elsie in your browser" action={<Mic size={16} className="text-ink-subtle" />}>
      <p className="mb-4 text-[13px] text-ink-muted">
        Talk to this number's agent right now using your computer's mic and speakers — no phone needed. Great for testing the voice and script before you go live.
      </p>
      {targets.length > 1 && status === 'idle' && (
        <div className="mb-3 max-w-[320px]">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Voice to test (A/B)</label>
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="text-[12.5px]">
            {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {status === 'idle' && (
          <button
            onClick={() => void start()}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          >
            <Phone size={15} /> Start test call
          </button>
        )}
        {status === 'connecting' && (
          <button disabled className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white opacity-70">
            <Loader2 size={15} className="animate-spin" /> Connecting…
          </button>
        )}
        {live && (
          <button
            onClick={stop}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          >
            <PhoneOff size={15} /> End test call
          </button>
        )}
        {live && (
          <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-ink-muted">
            <span className={cn('relative flex h-2.5 w-2.5')}>
              <span className={cn('absolute inline-flex h-full w-full rounded-full', talking ? 'animate-ping bg-emerald-400' : '')} />
              <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', talking ? 'bg-emerald-500' : 'bg-ink-subtle/40')} />
            </span>
            {talking ? 'Elsie is speaking…' : 'Listening — go ahead and talk'}
          </span>
        )}
      </div>
      {error && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}
      {live && <p className="mt-3 text-[11px] text-ink-subtle">Speak naturally. End the call when you're done — it uses your live agent, so any bookings are real.</p>}
    </SectionCard>
  )
}
