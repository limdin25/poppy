import { useState, useEffect } from 'react'
import { NavLink, Outlet, useSearchParams } from 'react-router-dom'
import { Bot, Brain, RefreshCw, UserPlus, Search, Phone, Copy, Loader2, MessageCircle, Mail, MessageSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/core/ui/PageHeader'
import { Input } from '@/core/ui/Input'
import { Select } from '@/core/ui/Select'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { useVoiceLines } from '@/core/hooks/useVoiceLines'

/**
 * AI Agent shared shell. Left sub-nav (Personality / Call behaviour / Goals /
 * Follow-up / Handoff) + a "Configure settings for" channel picker that scopes
 * every sub-page to that channel's agent (via ?ch=), plus a "Copy from" control
 * to clone a whole channel's settings into the current one.
 */

interface NavItem { to: string; label: string; description: string; icon: LucideIcon }

const NAV: NavItem[] = [
  { to: 'personality', label: 'AI Personality', description: 'Tone, language, prompt, welcome message', icon: Bot },
  { to: 'calling', label: 'Call behaviour', description: 'Voice timing, interruptions, ambience', icon: Phone },
  { to: 'classification', label: 'Goals', description: 'What Elsie optimises each lead toward', icon: Brain },
  { to: 'followup', label: 'Auto Follow-up', description: 'Re-engage cold leads automatically', icon: RefreshCw },
  { to: 'handoff', label: 'Human Handoff', description: 'When + how Elsie escalates to your team', icon: UserPlus },
]

const CHANNELS = [
  { key: 'voice', label: 'Calls', icon: Phone },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'sms', label: 'SMS', icon: MessageSquare },
  { key: 'email', label: 'Email', icon: Mail },
] as const

export default function AgentLayout() {
  const [search, setSearch] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const { session } = useAuth()

  const channel = (CHANNELS.find((c) => c.key === searchParams.get('ch'))?.key) ?? 'voice'
  const agentParam = searchParams.get('agent')
  const { lines: voiceLines } = useVoiceLines()
  const [agentsByChannel, setAgentsByChannel] = useState<Record<string, string>>({})
  const [copySource, setCopySource] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const [copyErr, setCopyErr] = useState<string | null>(null)

  // Default the channel to Calls so the picker and the sub-pages always agree.
  useEffect(() => {
    if (!searchParams.get('ch')) {
      const next = new URLSearchParams(searchParams)
      next.set('ch', 'voice')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ensure the 4 per-channel agents exist and learn their ids (for "Copy from").
  useEffect(() => {
    if (!session) return
    fetch('/api/agent/channels', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json()).then((d) => {
        if (d?.agents) {
          const map: Record<string, string> = {}
          for (const k of Object.keys(d.agents)) map[k] = d.agents[k]?.id
          setAgentsByChannel(map)
        }
      }).catch(() => {})
  }, [session])

  // Keep an agent pinned in the URL when on Calls, so every sub-page scopes to
  // the same phone number. Defaults to the default voice line.
  const selectedVoiceAgent = (channel === 'voice'
    ? (agentParam && voiceLines.some((v) => v.id === agentParam) ? agentParam : (voiceLines.find((v) => v.isDefault)?.id ?? voiceLines[0]?.id))
    : undefined) ?? ''

  useEffect(() => {
    if (channel === 'voice' && selectedVoiceAgent && agentParam !== selectedVoiceAgent) {
      const next = new URLSearchParams(searchParams)
      next.set('agent', selectedVoiceAgent)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, selectedVoiceAgent])

  function setChannel(key: string) {
    const next = new URLSearchParams(searchParams)
    next.set('ch', key)
    // Drop the pinned voice agent when leaving Calls — it would point at the
    // wrong channel type otherwise.
    if (key !== 'voice') next.delete('agent')
    setSearchParams(next, { replace: true })
    setCopyMsg(null); setCopyErr(null); setCopySource('')
  }

  function setVoiceAgent(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('ch', 'voice')
    next.set('agent', id)
    setSearchParams(next, { replace: true })
  }

  async function doCopy() {
    if (!session || !copySource || !agentsByChannel[copySource] || !agentsByChannel[channel]) return
    setCopyBusy(true); setCopyErr(null); setCopyMsg(null)
    try {
      const res = await fetch('/api/agent/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ fromAgentId: agentsByChannel[copySource], toAgentId: agentsByChannel[channel] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setCopyErr(data.error || 'Could not copy settings.'); return }
      setCopyMsg('Copied — reloading…')
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setCopyErr(e instanceof Error ? e.message : 'Could not copy.')
    } finally {
      setCopyBusy(false)
    }
  }

  // Call behaviour is phone-only — hide it for writing channels (WhatsApp/SMS/Email).
  const channelNav = channel === 'voice' ? NAV : NAV.filter((n) => n.to !== 'calling')
  const q = search.trim().toLowerCase()
  const items = q ? channelNav.filter((n) => n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)) : channelNav
  const currentLabel = CHANNELS.find((c) => c.key === channel)?.label ?? 'Calls'

  return (
    <div>
      <PageHeader bare eyebrow="AI Agent" title="Your AI agent" description="Shape how Elsie thinks, replies, and escalates." />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* LEFT — sub-nav */}
        <nav className="rounded-2xl border border-border bg-surface p-3 shadow-soft">
          <div className="relative mb-2">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-9 pl-9 text-[13px]" aria-label="Search agent settings" />
          </div>
          <ul className="space-y-1">
            {items.map((n) => {
              const Icon = n.icon
              return (
                <li key={n.to}>
                  <NavLink
                    to={{ pathname: n.to, search: `?ch=${channel}${channel === 'voice' && selectedVoiceAgent ? `&agent=${selectedVoiceAgent}` : ''}` }}
                    className={({ isActive }) => cn('flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition-colors', isActive ? 'bg-accent text-white' : 'text-ink hover:bg-elevated/60')}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={16} className={cn('mt-0.5 shrink-0', isActive ? 'text-white' : 'text-ink-muted')} />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-semibold leading-tight">{n.label}</span>
                          <span className={cn('mt-0.5 block truncate text-[11.5px] leading-tight', isActive ? 'text-white/70' : 'text-ink-subtle')}>{n.description}</span>
                        </span>
                      </>
                    )}
                  </NavLink>
                </li>
              )
            })}
            {items.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-ink-subtle">No settings match “{search}”.</li>}
          </ul>
        </nav>

        {/* RIGHT — channel picker + copy + active sub-page */}
        <div className="min-w-0">
          <div className="mb-5 rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Configure settings for</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {CHANNELS.map((c) => {
                const Icon = c.icon
                const active = c.key === channel
                return (
                  <button
                    key={c.key}
                    onClick={() => setChannel(c.key)}
                    className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition', active ? 'bg-accent text-white' : 'text-ink-muted hover:bg-elevated hover:text-ink')}
                  >
                    <Icon size={13} /> {c.label}
                  </button>
                )
              })}
            </div>

            {/* Phone number switcher — pick which number's agent you're editing. */}
            {channel === 'voice' && voiceLines.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Phone size={13} className="text-ink-subtle" />
                <span className="text-[12px] text-ink-muted">Phone number</span>
                <Select
                  value={selectedVoiceAgent}
                  onChange={(e) => setVoiceAgent(e.target.value)}
                  className="h-8 w-auto min-w-[180px] text-[12.5px]"
                >
                  {voiceLines.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}{v.isDefault ? ' (default)' : ''}</option>
                  ))}
                </Select>
                <span className="text-[11px] text-ink-subtle">Each number has its own voice & personality.</span>
              </div>
            )}

            {/* Copy from another channel */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-[12px] text-ink-muted">Copy all <strong>{currentLabel}</strong> settings from</span>
              <Select value={copySource} onChange={(e) => setCopySource(e.target.value)} className="h-8 w-auto min-w-[120px] text-[12.5px]">
                <option value="">Choose channel…</option>
                {CHANNELS.filter((c) => c.key !== channel).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
              <button
                onClick={() => void doCopy()}
                disabled={!copySource || copyBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-elevated disabled:opacity-50"
              >
                {copyBusy ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />} Copy
              </button>
              {copyMsg && <span className="text-[12px] font-medium text-emerald-600">{copyMsg}</span>}
              {copyErr && <span className="text-[12px] text-red-600">{copyErr}</span>}
            </div>
            <p className="mt-2 text-[11px] text-ink-subtle">Each channel has its own prompt, voice, follow-up and handoff. Changes here apply to <strong>{currentLabel}</strong>.</p>
          </div>

          <Outlet />
        </div>
      </div>
    </div>
  )
}
