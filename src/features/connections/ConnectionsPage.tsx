import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  MessageCircle,
  CalendarDays,
  CalendarClock,
  Phone,
  MessageSquare,
  Camera,
  UploadCloud,
  FileSpreadsheet,
  Copy,
  Check,
  Eye,
  EyeOff,
  Webhook,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/core/ui/PageHeader'
import { SectionCard } from '@/core/ui/SectionCard'
import { StatusPill } from '@/core/ui/StatusPill'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/integrations/supabase/browser'

type ParsedRow = { name: string; phone: string; email: string }

/** Minimal CSV parser (handles quoted fields + escaped quotes). */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else q = false
      } else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim()))
}

/** Map a parsed grid to {name,phone,email} rows by detecting header columns. */
function mapCsvRows(grid: string[][]): ParsedRow[] {
  if (!grid.length) return []
  const header = grid[0].map((h) => h.trim().toLowerCase())
  const find = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)))
  let iName = find('name', 'contact', 'customer')
  let iPhone = find('phone', 'mobile', 'whatsapp', 'tel', 'number', 'cell')
  let iEmail = find('email', 'e-mail', 'mail')
  const hasHeader = iName >= 0 || iPhone >= 0 || iEmail >= 0
  const data = hasHeader ? grid.slice(1) : grid
  if (!hasHeader) { iName = 0; iPhone = 1; iEmail = 2 }
  return data
    .map((r) => ({
      name: iName >= 0 ? (r[iName] || '').trim() : '',
      phone: iPhone >= 0 ? (r[iPhone] || '').trim() : '',
      email: iEmail >= 0 ? (r[iEmail] || '').trim() : '',
    }))
    .filter((r) => r.phone || r.email)
}

/** CSV lead import: parse client-side → preview → POST /api/contacts/import. */
function CsvImport() {
  const { session } = useAuth()
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [error, setError] = useState('')

  function onFile(input: HTMLInputElement) {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setError('')
    setResult(null)
    if (file.size > 5 * 1024 * 1024) { setError('That file is over 5 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = mapCsvRows(parseCsvText(String(reader.result || '')))
      if (!parsed.length) { setError('No rows with a phone or email were found.'); return }
      setFileName(file.name)
      setRows(parsed)
    }
    reader.readAsText(file)
  }

  async function doImport() {
    if (!rows || !session) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error || 'Import failed.'); return }
      setResult({ imported: data.imported ?? 0, skipped: data.skipped ?? 0 })
      setRows(null)
      setFileName('')
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-muted">
        Upload a spreadsheet — we map name, phone and email to your contacts. Existing contacts are
        matched by phone (or email), so nothing gets duplicated.
      </p>

      {result && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-700">
          Imported {result.imported} contact{result.imported === 1 ? '' : 's'}
          {result.skipped ? ` · ${result.skipped} skipped` : ''}.
        </div>
      )}
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>}

      {!rows ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-page/60 px-6 py-10 text-center transition hover:border-ink-subtle hover:bg-elevated/50">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-elevated text-ink-muted">
            <UploadCloud size={20} />
          </span>
          <span className="text-[13.5px] font-medium text-ink">Drop a CSV or browse</span>
          <span className="text-[12px] text-ink-subtle">.csv up to 5 MB · name, phone, email columns</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.currentTarget)} />
        </label>
      ) : (
        <div className="rounded-xl border border-border bg-page/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[13px] font-medium text-ink">{fileName}</p>
            <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-muted">
              {rows.length} row{rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-elevated text-ink-subtle">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Name</th>
                  <th className="px-3 py-1.5 font-medium">Phone</th>
                  <th className="px-3 py-1.5 font-medium">Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-border text-ink">
                    <td className="px-3 py-1.5">{r.name || '—'}</td>
                    <td className="px-3 py-1.5">{r.phone || '—'}</td>
                    <td className="truncate px-3 py-1.5">{r.email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 5 && <p className="mt-1.5 text-[11px] text-ink-subtle">+ {rows.length - 5} more…</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={doImport}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              {busy ? 'Importing…' : `Import ${rows.length} contact${rows.length === 1 ? '' : 's'}`}
            </button>
            <button
              onClick={() => { setRows(null); setFileName('') }}
              disabled={busy}
              className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink-muted transition hover:bg-elevated"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Integrations (waslo-faithful visual clone). Live tiles:
 *   WhatsApp        → Unipile hosted QR connect (POST /api/channels/whatsapp/connect),
 *                     status from `channels` table (whatsapp row, status=connected)
 *   Google Calendar → OAuth start (GET /api/calendar/connect → redirect to url),
 *                     status from businesses.google_calendar_tokens, disconnect via
 *                     POST /api/calendar/disconnect
 *   Cal.com / Voice / SMS / Instagram → gated "Available on request" (disabled)
 *   CSV import      → no backend yet, dropzone is a no-op (see TODO)
 *   Webhooks        → static read-only display
 * No credits/top-up/unlock UI anywhere.
 */

type IntegrationState =
  | { kind: 'whatsapp' }
  | { kind: 'calendar' }
  | { kind: 'gated'; note: string }

interface Integration {
  id: string
  name: string
  description: string
  icon: LucideIcon
  tile: string
  state: IntegrationState
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Elsie answers, qualifies and books straight from WhatsApp.',
    icon: MessageCircle,
    tile: 'bg-whatsapp/10 text-whatsapp',
    state: { kind: 'whatsapp' },
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Auto-create events when Elsie books a job, with live availability.',
    icon: CalendarDays,
    tile: 'bg-blue-50 text-blue-600',
    state: { kind: 'calendar' },
  },
  {
    id: 'cal-com',
    name: 'Cal.com',
    description: 'Sync open slots and let Elsie schedule against your Cal.com links.',
    icon: CalendarClock,
    tile: 'bg-violet-50 text-violet-600',
    state: { kind: 'gated', note: 'Available on request' },
  },
  {
    id: 'voice',
    name: 'Voice (Twilio)',
    description: 'A dedicated number so Elsie can take and make calls for you.',
    icon: Phone,
    tile: 'bg-indigo-50 text-indigo-600',
    state: { kind: 'gated', note: 'Available on request' },
  },
  {
    id: 'sms',
    name: 'SMS',
    description: 'Text confirmations and reminders to keep no-shows down.',
    icon: MessageSquare,
    tile: 'bg-purple-50 text-purple-600',
    state: { kind: 'gated', note: 'Available on request' },
  },
  {
    id: 'instagram',
    name: 'Instagram DM',
    description: 'Reply to DMs and turn comments into booked jobs.',
    icon: Camera,
    tile: 'bg-pink-50 text-pink-600',
    state: { kind: 'gated', note: 'Available on request' },
  },
]

const WEBHOOK_EVENTS = [
  { id: 'lead.created', label: 'New lead', defaultOn: true },
  { id: 'booking.created', label: 'Booking created', defaultOn: true },
  { id: 'message.received', label: 'Message received', defaultOn: false },
]

const SAMPLE_WEBHOOK_URL = 'https://app.heyelsie.com/api/webhooks/in/wh_3f8a91c2'
const SAMPLE_WEBHOOK_SECRET = 'whsec_9bD2pQ7nR4tV6yX1aZ0cE5gH8kM3oS'

const outlineBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated'
const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90'
const disabledBtn =
  'inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-border bg-elevated/60 px-3 py-2 text-[13px] font-medium text-ink-subtle'

export default function ConnectionsPage() {
  const { businessId, session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [events, setEvents] = useState<Set<string>>(
    () => new Set(WEBHOOK_EVENTS.filter((e) => e.defaultOn).map((e) => e.id)),
  )

  // Live connection status
  const [whatsappConnected, setWhatsappConnected] = useState(false)
  const [whatsappChannel, setWhatsappChannel] = useState<{ id: string; phone: string | null } | null>(null)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [whatsappError, setWhatsappError] = useState<string | null>(null)

  async function loadStatus() {
    if (!businessId) return
    const { data: ch } = await supabase
      .from('channels')
      .select('id, status, config')
      .eq('business_id', businessId)
      .eq('type', 'whatsapp')
      .eq('status', 'connected')
      .order('connected_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ch) {
      const cfg = (ch.config as { phone?: string } | null) || {}
      setWhatsappConnected(true)
      setWhatsappChannel({ id: ch.id as string, phone: cfg.phone ?? null })
    } else {
      setWhatsappConnected(false)
      setWhatsappChannel(null)
    }

    const { data } = await supabase
      .from('businesses')
      .select('google_calendar_tokens')
      .eq('id', businessId)
      .single()
    setCalendarConnected(!!data?.google_calendar_tokens)
  }

  useEffect(() => {
    loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  // Reload status after returning from a hosted connect/OAuth redirect
  useEffect(() => {
    const unipile = searchParams.get('unipile')
    const calendar = searchParams.get('calendar')
    if (unipile || calendar) {
      loadStatus()
      searchParams.delete('unipile')
      searchParams.delete('calendar')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function connectWhatsApp() {
    if (!businessId || !session) return
    setConnecting('whatsapp')
    setWhatsappError(null)
    try {
      const res = await fetch('/api/channels/whatsapp/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ businessId, provider: 'WHATSAPP' }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || data.error) setWhatsappError(data.error || 'Could not start WhatsApp connect.')
      else if (data.url) window.open(data.url, '_blank')
      else setWhatsappError('No connect link was returned. Please try again.')
    } catch (e) {
      setWhatsappError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setConnecting(null)
    }
  }

  async function disconnectWhatsApp() {
    if (!session || !whatsappChannel) return
    setConnecting('whatsapp-disconnect')
    setWhatsappError(null)
    try {
      const res = await fetch('/api/channels/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ channelId: whatsappChannel.id }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || data.error) setWhatsappError(data.error || 'Could not disconnect.')
      else {
        setWhatsappConnected(false)
        setWhatsappChannel(null)
      }
    } catch (e) {
      setWhatsappError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setConnecting(null)
      await loadStatus()
    }
  }

  async function refreshWhatsApp() {
    setConnecting('whatsapp-refresh')
    setWhatsappError(null)
    try {
      await loadStatus()
    } finally {
      setConnecting(null)
    }
  }

  async function connectCalendar() {
    if (!session) return
    setConnecting('calendar')
    setCalendarError(null)
    try {
      const res = await fetch('/api/calendar/connect', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      setCalendarError(data.error || 'Google did not return a sign-in link. Check the calendar setup and try again.')
    } catch (e) {
      setCalendarError(e instanceof Error ? e.message : 'Could not reach the server.')
    }
    setConnecting(null)
  }

  async function disconnectCalendar() {
    if (!session) return
    setConnecting('calendar-disconnect')
    setCalendarError(null)
    try {
      const res = await fetch('/api/calendar/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setCalendarError(data.error || 'Could not disconnect the calendar.')
      } else {
        setCalendarConnected(false)
      }
    } catch (e) {
      setCalendarError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setConnecting(null)
    }
  }

  function copyUrl() {
    navigator.clipboard?.writeText(SAMPLE_WEBHOOK_URL).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  function toggleEvent(id: string) {
    setEvents((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Growth"
        title="Integrations"
        description="Connect the tools Elsie uses to work for you."
      />

      {(whatsappError || calendarError) && (
        <div className="space-y-2">
          {whatsappError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              WhatsApp: {whatsappError}
            </div>
          )}
          {calendarError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              Calendar: {calendarError}
            </div>
          )}
        </div>
      )}

      {/* Integration marketplace */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((it) => (
          <IntegrationCard
            key={it.id}
            integration={it}
            whatsappConnected={whatsappConnected}
            whatsappPhone={whatsappChannel?.phone ?? null}
            calendarConnected={calendarConnected}
            connecting={connecting}
            onConnectWhatsApp={connectWhatsApp}
            onDisconnectWhatsApp={disconnectWhatsApp}
            onRefreshWhatsApp={refreshWhatsApp}
            onConnectCalendar={connectCalendar}
            onDisconnectCalendar={disconnectCalendar}
          />
        ))}
      </div>

      {/* Wider cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* CSV import — higher priority, spans wider */}
        <div className="lg:col-span-2">
          <SectionCard
            eyebrow="Import"
            title="CSV lead import"
            action={<FileSpreadsheet size={16} className="text-ink-subtle" />}
          >
            <CsvImport />
          </SectionCard>
        </div>

        {/* Webhooks — advanced, lower visual priority */}
        <div>
          <SectionCard
            eyebrow="Advanced"
            title="Webhooks"
            action={
              <StatusPill tone="info" className="bg-blue-50 text-blue-600">
                Beta
              </StatusPill>
            }
          >
            <div className="space-y-4">
              <p className="text-[12.5px] text-ink-subtle">
                Send events to your own systems. Read-only — generated for your account.
              </p>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Endpoint URL
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-page/60 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-muted">
                    {SAMPLE_WEBHOOK_URL}
                  </code>
                  <button
                    onClick={copyUrl}
                    className="shrink-0 rounded-md p-1 text-ink-subtle transition hover:bg-elevated hover:text-ink"
                    aria-label="Copy webhook URL"
                  >
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Signing secret
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-page/60 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-muted">
                    {revealed ? SAMPLE_WEBHOOK_SECRET : '•'.repeat(28)}
                  </code>
                  <button
                    onClick={() => setRevealed((v) => !v)}
                    className="shrink-0 rounded-md p-1 text-ink-subtle transition hover:bg-elevated hover:text-ink"
                    aria-label={revealed ? 'Hide secret' : 'Reveal secret'}
                  >
                    {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Events
                </p>
                <div className="space-y-2">
                  {WEBHOOK_EVENTS.map((e) => (
                    <label
                      key={e.id}
                      className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={events.has(e.id)}
                        onChange={() => toggleEvent(e.id)}
                        className="h-4 w-4 rounded border-border text-accent focus:ring-accent/20"
                      />
                      <span>{e.label}</span>
                      <code className="ml-auto font-mono text-[11px] text-ink-subtle">{e.id}</code>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1.5 border-t border-border pt-3 text-[11px] text-ink-subtle">
                <Webhook size={13} />
                Verify the signature header on every request.
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

interface IntegrationCardProps {
  integration: Integration
  whatsappConnected: boolean
  whatsappPhone: string | null
  calendarConnected: boolean
  connecting: string | null
  onConnectWhatsApp: () => void
  onDisconnectWhatsApp: () => void
  onRefreshWhatsApp: () => void
  onConnectCalendar: () => void
  onDisconnectCalendar: () => void
}

function ConnectedPill() {
  return (
    <StatusPill tone="success" uppercase={false}>
      <span className="mr-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Connected
    </StatusPill>
  )
}

function IntegrationCard({
  integration,
  whatsappConnected,
  whatsappPhone,
  calendarConnected,
  connecting,
  onConnectWhatsApp,
  onDisconnectWhatsApp,
  onRefreshWhatsApp,
  onConnectCalendar,
  onDisconnectCalendar,
}: IntegrationCardProps) {
  const { name, description, icon: Icon, tile, state } = integration

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tile)}>
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-semibold tracking-tight text-ink">{name}</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{description}</p>
          {state.kind === 'whatsapp' && whatsappConnected && whatsappPhone && (
            <p className="mt-1.5 font-mono text-[12px] text-ink">{whatsappPhone}</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        {state.kind === 'whatsapp' && (
          whatsappConnected ? (
            <>
              <ConnectedPill />
              <div className="flex items-center gap-2">
                <button
                  className={outlineBtn}
                  title="Re-check connection"
                  onClick={onRefreshWhatsApp}
                  disabled={connecting === 'whatsapp-refresh'}
                >
                  {connecting === 'whatsapp-refresh' ? <Loader2 size={14} className="animate-spin" /> : 'Refresh'}
                </button>
                <button
                  className={cn(outlineBtn, 'text-red-600 hover:bg-red-50')}
                  title="Remove this WhatsApp connection"
                  onClick={onDisconnectWhatsApp}
                  disabled={connecting === 'whatsapp-disconnect'}
                >
                  {connecting === 'whatsapp-disconnect' ? <Loader2 size={14} className="animate-spin" /> : 'Disconnect'}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-[12px] text-ink-subtle">Not connected</span>
              <button
                className={primaryBtn}
                onClick={onConnectWhatsApp}
                disabled={connecting === 'whatsapp'}
              >
                {connecting === 'whatsapp' ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Opening…
                  </>
                ) : (
                  'Connect'
                )}
              </button>
            </>
          )
        )}

        {state.kind === 'calendar' && (
          calendarConnected ? (
            <>
              <ConnectedPill />
              <button
                className={outlineBtn}
                onClick={onDisconnectCalendar}
                disabled={connecting === 'calendar-disconnect'}
              >
                {connecting === 'calendar-disconnect' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  'Disconnect'
                )}
              </button>
            </>
          ) : (
            <>
              <span className="text-[12px] text-ink-subtle">Not connected</span>
              <button
                className={primaryBtn}
                onClick={onConnectCalendar}
                disabled={connecting === 'calendar'}
              >
                {connecting === 'calendar' ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Redirecting…
                  </>
                ) : (
                  'Connect'
                )}
              </button>
            </>
          )
        )}

        {state.kind === 'gated' && (
          <>
            <span className="inline-flex items-center rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink-muted">
              {state.note}
            </span>
            <button className={disabledBtn} disabled>
              Connect
            </button>
          </>
        )}
      </div>
    </div>
  )
}
