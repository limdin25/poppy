import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  MessageCircle,
  CalendarDays,
  CalendarClock,
  Phone,
  MessageSquare,
  Mail,
  Camera,
  UploadCloud,
  FileSpreadsheet,
  Copy,
  Check,
  Eye,
  EyeOff,
  Webhook,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
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

// --- Channel-backed connections ---------------------------------------------

interface ChannelRow {
  id: string
  type: string
  status: string
  config: { phone?: string; email?: string } | null
  unipile_account_id: string | null
}

const EMAIL_TYPES = ['email_gmail', 'email_outlook', 'email_smtp']

const WEBHOOK_EVENTS = [
  { id: 'lead.created', label: 'New lead', defaultOn: true },
  { id: 'booking.created', label: 'Booking created', defaultOn: true },
  { id: 'message.received', label: 'Message received', defaultOn: false },
]

const SAMPLE_WEBHOOK_URL = 'https://app.heyelsie.com/api/webhooks/in/wh_3f8a91c2'
const SAMPLE_WEBHOOK_SECRET = 'whsec_9bD2pQ7nR4tV6yX1aZ0cE5gH8kM3oS'

const outlineBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated disabled:opacity-50'
const primaryBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60'
const dangerBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50'

function ConnectedPill() {
  return (
    <StatusPill tone="success" uppercase={false}>
      <span className="mr-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Connected
    </StatusPill>
  )
}

function Spinner() {
  return <Loader2 size={14} className="animate-spin" />
}

/** Card shell shared by every integration tile. */
function Tile({
  icon: Icon,
  tile,
  name,
  description,
  extra,
  children,
}: {
  icon: LucideIcon
  tile: string
  name: string
  description: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tile)}>
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-semibold tracking-tight text-ink">{name}</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{description}</p>
        </div>
      </div>
      {extra}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        {children}
      </div>
    </div>
  )
}

/** A connected account row (number/email) with a remove button. */
function ConnectedAccountRow({ label, onRemove, busy }: { label: string; onRemove: () => void; busy: boolean }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-page/50 px-3 py-2">
      <span className="truncate font-mono text-[12px] text-ink">{label}</span>
      <button onClick={onRemove} disabled={busy} className="shrink-0 rounded-md p-1 text-ink-subtle transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50" title="Remove">
        {busy ? <Spinner /> : <Trash2 size={14} />}
      </button>
    </div>
  )
}

export default function ConnectionsPage() {
  const { businessId, session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [events, setEvents] = useState<Set<string>>(
    () => new Set(WEBHOOK_EVENTS.filter((e) => e.defaultOn).map((e) => e.id)),
  )

  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function loadStatus() {
    if (!businessId) return
    const { data: ch } = await supabase
      .from('channels')
      .select('id, type, status, config, unipile_account_id')
      .eq('business_id', businessId)
    setChannels((ch as ChannelRow[]) || [])

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

  // Reload after returning from a hosted connect / OAuth redirect.
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

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  // Open a Unipile hosted connect link for WhatsApp / Gmail / Instagram.
  async function connectChannel(provider: 'WHATSAPP' | 'GMAIL' | 'INSTAGRAM', actionId: string) {
    if (!businessId || !session) return
    setConnecting(actionId)
    setError(null)
    try {
      const res = await fetch('/api/channels/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ businessId, provider }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || data.error) setError(data.error || 'Could not start the connection.')
      else if (data.url) window.open(data.url, '_blank')
      else setError('No connect link was returned. Please try again.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setConnecting(null)
    }
  }

  // Fully remove a Unipile channel (WhatsApp / email / Instagram).
  async function removeChannel(channelId: string, actionId: string) {
    if (!session) return
    setConnecting(actionId)
    setError(null)
    try {
      const res = await fetch('/api/channels/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ channelId }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || data.error) setError(data.error || 'Could not remove.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setConnecting(null)
      await loadStatus()
    }
  }

  // Soft connect/disconnect a channel (Voice) without releasing the number.
  async function setVoiceStatus(channelId: string, status: 'connected' | 'disconnected', actionId: string) {
    if (!session) return
    setConnecting(actionId)
    setError(null)
    try {
      const res = await fetch('/api/channels/set-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ channelId, status }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || data.error) setError(data.error || 'Could not update the number.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setConnecting(null)
      await loadStatus()
    }
  }

  // "Request a number" — emails ops to provision a Twilio number.
  async function requestNumber(kind: 'voice' | 'sms', actionId: string) {
    if (!session) return
    setConnecting(actionId)
    setError(null)
    try {
      const res = await fetch('/api/numbers/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ kind }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || data.error) setError(data.error || 'Could not send the request.')
      else flash("Request sent — we'll be in touch to set up your number.")
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setConnecting(null)
    }
  }

  async function connectCalendar() {
    if (!session) return
    setConnecting('calendar')
    setError(null)
    try {
      const res = await fetch('/api/calendar/connect', { headers: { Authorization: `Bearer ${session.access_token}` } })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (data.url) { window.location.href = data.url; return }
      setError(data.error || 'Google did not return a sign-in link. Check the calendar setup and try again.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.')
    }
    setConnecting(null)
  }

  async function disconnectCalendar() {
    if (!session) return
    setConnecting('calendar-disconnect')
    setError(null)
    try {
      const res = await fetch('/api/calendar/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error || 'Could not disconnect the calendar.')
      } else setCalendarConnected(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.')
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

  // Derived channel views
  const waChannels = channels.filter((c) => c.type === 'whatsapp' && c.status === 'connected')
  const emailChannels = channels.filter((c) => EMAIL_TYPES.includes(c.type) && c.status === 'connected')
  const igChannels = channels.filter((c) => c.type === 'instagram' && c.status === 'connected')
  const voice = channels.find((c) => c.type === 'voice')
  const voiceConnected = voice?.status === 'connected'
  const voiceNumber = voice?.config?.phone ?? null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Growth"
        title="Integrations"
        description="Connect the tools Elsie uses to work for you."
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>
      )}
      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-medium text-emerald-700">{toast}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* WhatsApp */}
        <Tile
          icon={MessageCircle}
          tile="bg-whatsapp/10 text-whatsapp"
          name="WhatsApp"
          description="Elsie answers, qualifies and books straight from WhatsApp."
          extra={waChannels.map((c) => (
            <ConnectedAccountRow
              key={c.id}
              label={c.config?.phone || 'Connected number'}
              busy={connecting === `rm-${c.id}`}
              onRemove={() => removeChannel(c.id, `rm-${c.id}`)}
            />
          ))}
        >
          {waChannels.length > 0 ? <ConnectedPill /> : <span className="text-[12px] text-ink-subtle">Not connected</span>}
          <button className={waChannels.length > 0 ? outlineBtn : primaryBtn} onClick={() => connectChannel('WHATSAPP', 'connect-wa')} disabled={connecting === 'connect-wa'}>
            {connecting === 'connect-wa' ? <Spinner /> : waChannels.length > 0 ? <><Plus size={14} /> Add another</> : 'Connect'}
          </button>
        </Tile>

        {/* Email */}
        <Tile
          icon={Mail}
          tile="bg-rose-50 text-rose-600"
          name="Email"
          description="Two-way email — Elsie reads and replies from your inbox."
          extra={emailChannels.map((c) => (
            <ConnectedAccountRow
              key={c.id}
              label={c.config?.email || (c.type === 'email_outlook' ? 'Outlook account' : 'Gmail account')}
              busy={connecting === `rm-${c.id}`}
              onRemove={() => removeChannel(c.id, `rm-${c.id}`)}
            />
          ))}
        >
          {emailChannels.length > 0 ? <ConnectedPill /> : <span className="text-[12px] text-ink-subtle">Not connected</span>}
          <button className={emailChannels.length > 0 ? outlineBtn : primaryBtn} onClick={() => connectChannel('GMAIL', 'connect-email')} disabled={connecting === 'connect-email'}>
            {connecting === 'connect-email' ? <Spinner /> : emailChannels.length > 0 ? <><Plus size={14} /> Add another</> : 'Connect Gmail'}
          </button>
        </Tile>

        {/* Voice (Twilio) */}
        <Tile
          icon={Phone}
          tile="bg-indigo-50 text-indigo-600"
          name="Voice (Twilio)"
          description="A dedicated number so Elsie can take and make calls for you."
          extra={voiceNumber ? <p className="mt-3 font-mono text-[12px] text-ink">{voiceNumber}</p> : null}
        >
          {!voice ? (
            <>
              <span className="inline-flex items-center rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink-muted">Available on request</span>
              <button className={primaryBtn} onClick={() => requestNumber('voice', 'req-voice')} disabled={connecting === 'req-voice'}>
                {connecting === 'req-voice' ? <Spinner /> : 'Request a number'}
              </button>
            </>
          ) : voiceConnected ? (
            <>
              <ConnectedPill />
              <div className="flex items-center gap-2">
                <button className={outlineBtn} onClick={() => requestNumber('voice', 'req-voice')} disabled={connecting === 'req-voice'} title="Request an additional number">
                  {connecting === 'req-voice' ? <Spinner /> : <><Plus size={14} /> Add number</>}
                </button>
                <button className={dangerBtn} onClick={() => setVoiceStatus(voice.id, 'disconnected', 'voice-off')} disabled={connecting === 'voice-off'}>
                  {connecting === 'voice-off' ? <Spinner /> : 'Remove'}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-[12px] text-ink-subtle">Disconnected</span>
              <button className={outlineBtn} onClick={() => setVoiceStatus(voice.id, 'connected', 'voice-on')} disabled={connecting === 'voice-on'}>
                {connecting === 'voice-on' ? <Spinner /> : <><RotateCcw size={14} /> Reconnect</>}
              </button>
            </>
          )}
        </Tile>

        {/* SMS — uses the voice number */}
        <Tile
          icon={MessageSquare}
          tile="bg-purple-50 text-purple-600"
          name="SMS"
          description="Text confirmations and reminders to keep no-shows down."
          extra={voiceConnected && voiceNumber ? <p className="mt-3 text-[12px] text-ink-subtle">Texts send from your voice number <span className="font-mono text-ink">{voiceNumber}</span>.</p> : null}
        >
          {voiceConnected ? (
            <>
              <ConnectedPill />
              <span className="text-[12px] text-ink-subtle">Managed with Voice</span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink-muted">Needs a number</span>
              <button className={primaryBtn} onClick={() => requestNumber('sms', 'req-sms')} disabled={connecting === 'req-sms'}>
                {connecting === 'req-sms' ? <Spinner /> : 'Request a number'}
              </button>
            </>
          )}
        </Tile>

        {/* Google Calendar */}
        <Tile
          icon={CalendarDays}
          tile="bg-blue-50 text-blue-600"
          name="Google Calendar"
          description="Auto-create events when Elsie books a job, with live availability."
        >
          {calendarConnected ? (
            <>
              <ConnectedPill />
              <button className={dangerBtn} onClick={disconnectCalendar} disabled={connecting === 'calendar-disconnect'}>
                {connecting === 'calendar-disconnect' ? <Spinner /> : 'Disconnect'}
              </button>
            </>
          ) : (
            <>
              <span className="text-[12px] text-ink-subtle">Not connected</span>
              <button className={primaryBtn} onClick={connectCalendar} disabled={connecting === 'calendar'}>
                {connecting === 'calendar' ? <><Spinner /> Redirecting…</> : 'Connect'}
              </button>
            </>
          )}
        </Tile>

        {/* Instagram DM */}
        <Tile
          icon={Camera}
          tile="bg-pink-50 text-pink-600"
          name="Instagram DM"
          description="Reply to DMs and turn comments into booked jobs."
          extra={igChannels.map((c) => (
            <ConnectedAccountRow
              key={c.id}
              label="Instagram account"
              busy={connecting === `rm-${c.id}`}
              onRemove={() => removeChannel(c.id, `rm-${c.id}`)}
            />
          ))}
        >
          {igChannels.length > 0 ? <ConnectedPill /> : <span className="text-[12px] text-ink-subtle">Not connected</span>}
          <button className={igChannels.length > 0 ? outlineBtn : primaryBtn} onClick={() => connectChannel('INSTAGRAM', 'connect-ig')} disabled={connecting === 'connect-ig'}>
            {connecting === 'connect-ig' ? <Spinner /> : igChannels.length > 0 ? <><Plus size={14} /> Add another</> : 'Connect'}
          </button>
        </Tile>

        {/* Cal.com — not yet integrated */}
        <Tile
          icon={CalendarClock}
          tile="bg-violet-50 text-violet-600"
          name="Cal.com"
          description="Sync open slots and let Elsie schedule against your Cal.com links."
        >
          <span className="inline-flex items-center rounded-full bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink-muted">Available on request</span>
          <button className={cn(outlineBtn, 'cursor-not-allowed text-ink-subtle')} disabled>Connect</button>
        </Tile>
      </div>

      {/* Wider cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard eyebrow="Import" title="CSV lead import" action={<FileSpreadsheet size={16} className="text-ink-subtle" />}>
            <CsvImport />
          </SectionCard>
        </div>

        <div>
          <SectionCard
            eyebrow="Advanced"
            title="Webhooks"
            action={<StatusPill tone="info" className="bg-blue-50 text-blue-600">Beta</StatusPill>}
          >
            <div className="space-y-4">
              <p className="text-[12.5px] text-ink-subtle">
                Send events to your own systems. Read-only — generated for your account.
              </p>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Endpoint URL</p>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-page/60 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-muted">{SAMPLE_WEBHOOK_URL}</code>
                  <button onClick={copyUrl} className="shrink-0 rounded-md p-1 text-ink-subtle transition hover:bg-elevated hover:text-ink" aria-label="Copy webhook URL">
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Signing secret</p>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-page/60 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-muted">{revealed ? SAMPLE_WEBHOOK_SECRET : '•'.repeat(28)}</code>
                  <button onClick={() => setRevealed((v) => !v)} className="shrink-0 rounded-md p-1 text-ink-subtle transition hover:bg-elevated hover:text-ink" aria-label={revealed ? 'Hide secret' : 'Reveal secret'}>
                    {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Events</p>
                <div className="space-y-2">
                  {WEBHOOK_EVENTS.map((e) => (
                    <label key={e.id} className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink">
                      <input type="checkbox" checked={events.has(e.id)} onChange={() => toggleEvent(e.id)} className="h-4 w-4 rounded border-border text-accent focus:ring-accent/20" />
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
