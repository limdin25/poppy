import { useEffect, useRef, useState } from 'react'
import {
  Sparkles, MessageSquare, Send, Check, CheckCircle2, ImagePlus,
  TrendingUp, Clock, Repeat, Ban, Building2, Pause, Play, ShieldCheck,
} from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input, Textarea } from '@/core/ui/Input'
import { Select } from '@/core/ui/Select'
import { SectionCard } from '@/core/ui/SectionCard'
import { Switch } from '@/core/ui/Switch'
import { cn } from '@/core/lib/cn'
import { useReviewsSession, reviewsApi } from '../lib'
import { MockPhone, type PhoneMessage } from '../components/MockPhone'
import {
  interpolate, charsRemaining, insertToken, lintCustom,
  CUSTOM_DEFAULT, MESSAGE_MAX, TOKENS, type MessageVars,
} from '../messaging-preview'

interface Settings {
  smart_messaging: boolean
  sms_template: string | null
  owner_first_name: string | null
  business_display_name: string | null
  followups_enabled: boolean
  followup_count: number
  followup_gap_days: number
  image_enabled: boolean
  sms_from_number: string | null
  sending_paused: boolean
  initial_delay_hours: number
  quiet_start: number
  quiet_end: number
  attested_at: string | null
}

// The only initial-delay options the send engine accepts (settings.ts validates).
const INITIAL_DELAY_OPTIONS = [
  { hours: 0, label: 'Right away' }, { hours: 4, label: 'Few hours' }, { hours: 24, label: '24 hours' },
  { hours: 48, label: '2 days' }, { hours: 72, label: '3 days' }, { hours: 96, label: '4 days' },
  { hours: 120, label: '5 days' }, { hours: 144, label: '6 days' }, { hours: 168, label: '1 week' },
]
interface Template { public_url: string; name_x?: number; name_y?: number; font_color?: string; greeting_prefix?: string }

const SMART_PREVIEW = "Hi {first_name}! Thanks so much for choosing {business_name}. If you have a moment, we'd love a quick review — it really helps: {review_link}"
const FOLLOWUP_PREVIEW = 'Hey {first_name}, just wanted to quickly follow up. We\'d really appreciate your feedback! {review_link}'

export default function ReviewsMessagingPage() {
  const session = useReviewsSession()
  const imp = session.impersonating ? session.businessId : null

  const [settings, setSettings] = useState<Settings | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)
  const [defaultImage, setDefaultImage] = useState('')
  const [tab, setTab] = useState<'smart' | 'custom'>('smart')
  const [customText, setCustomText] = useState('')
  const [owner, setOwner] = useState('')
  const [bizName, setBizName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [testTo, setTestTo] = useState('')
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const caretRef = useRef<number | null>(null)

  useEffect(() => {
    async function load() {
      const out = await reviewsApi<{ settings: Settings }>('/api/reviews/settings', { impersonateBusinessId: imp })
      setSettings(out.settings)
      setTab(out.settings.smart_messaging ? 'smart' : 'custom')
      setCustomText(out.settings.sms_template ?? CUSTOM_DEFAULT)
      setOwner(out.settings.owner_first_name ?? '')
      setBizName(out.settings.business_display_name ?? '')
      const t = await reviewsApi<{ template: Template | null; defaultUrl: string }>('/api/reviews/image-template', { impersonateBusinessId: imp })
      setTemplate(t.template)
      setDefaultImage(t.defaultUrl)
    }
    load().catch((e) => setMsg((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  // Restore the caret after inserting a variable token.
  useEffect(() => {
    if (caretRef.current != null && taRef.current) {
      taRef.current.focus()
      taRef.current.setSelectionRange(caretRef.current, caretRef.current)
      caretRef.current = null
    }
  }, [customText])

  async function save(patch: Record<string, unknown>, note = 'Saved') {
    setBusy(true); setMsg(null)
    try {
      const out = await reviewsApi<{ settings: Settings }>('/api/reviews/settings', { method: 'PUT', body: patch, impersonateBusinessId: imp })
      setSettings(out.settings)
      setMsg(note)
    } catch (err) { setMsg((err as Error).message) }
    setBusy(false)
  }

  async function uploadImage(file: File) {
    setBusy(true); setMsg(null)
    const fd = new FormData(); fd.append('file', file)
    try {
      const out = await reviewsApi<{ template: Template }>('/api/reviews/image-template', { formData: fd, impersonateBusinessId: imp })
      setTemplate(out.template)
      setMsg('Image uploaded — new requests will use it.')
    } catch (err) { setMsg((err as Error).message) }
    setBusy(false)
  }

  async function sendTest() {
    setTestMsg(null); setBusy(true)
    try {
      const out = await reviewsApi<{ channel: string }>('/api/reviews/send-test', {
        body: testTo.includes('@') ? { email: testTo, first_name: 'Jessica' } : { phone: testTo, first_name: 'Jessica' },
        impersonateBusinessId: imp,
      })
      setTestMsg(`Test ${out.channel === 'sms' ? 'text' : 'email'} sent — check your ${out.channel === 'sms' ? 'phone' : 'inbox'}.`)
    } catch (err) { setTestMsg((err as Error).message) }
    setBusy(false)
  }

  function insertVar(token: string) {
    const ta = taRef.current
    // Only trust the DOM selection when the textarea is actually focused —
    // an unfocused controlled textarea reports caret 0, which would prepend.
    const focused = ta && document.activeElement === ta
    const start = focused ? ta.selectionStart : customText.length
    const end = focused ? ta.selectionEnd : customText.length
    const r = insertToken(customText, token, start, end)
    if (r.text.length <= MESSAGE_MAX) { caretRef.current = r.cursor; setCustomText(r.text) }
    else setMsg('Message is at the 400-character limit — remove some text to add a variable.')
  }

  if (!settings) return <p className="py-12 text-center text-sm text-ink-subtle">{msg ?? 'Loading…'}</p>

  const vars: MessageVars = {
    first_name: 'Jessica',
    owner_name: owner || 'the team',
    business_name: bizName || session.businessName,
    review_link: 'go.heyelsie.com/r/abc123',
  }
  const bodyTemplate = tab === 'custom' ? customText : SMART_PREVIEW
  const previewBody = `${interpolate(bodyTemplate, vars)} Reply STOP to opt out.`

  const mainMessages: PhoneMessage[] = [
    ...(settings.image_enabled ? [{
      id: 'img', kind: 'image' as const, imageUrl: template?.public_url || defaultImage,
      imageOverlay: {
        text: `${template?.greeting_prefix ?? 'Hi'} Jessica!`,
        xPct: (template?.name_x ?? 0.5) * 100, yPct: (template?.name_y ?? 0.72) * 100,
        color: template?.font_color ?? '#ffffff',
      },
    }] : []),
    { id: 'txt', kind: 'outgoing', text: previewBody, time: '9:41 AM' },
  ]
  const followupMessages: PhoneMessage[] = [
    { id: 'fu', kind: 'outgoing', text: `${interpolate(FOLLOWUP_PREVIEW, vars)} Reply STOP to opt out.`, time: '2:30 PM' },
    { id: 'reply', kind: 'incoming', text: 'Just left a review! Thanks for your help!', time: '2:45 PM' },
  ]

  const ownerBiz = settings.owner_first_name ?? ''
  const savedBiz = settings.business_display_name ?? ''
  const smartDirty = owner !== ownerBiz || bizName !== savedBiz
  const remaining = charsRemaining(customText)
  const lint = lintCustom(customText)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Messaging</h1>
        <p className="text-sm text-ink-subtle">Configure how review requests are sent to your customers.</p>
      </div>

      {/* ── Section 1: Sending mode ── */}
      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <div>
          <MockPhone messages={mainMessages} />
          <div className="mx-auto mt-4 flex w-[280px] flex-col gap-2">
            <div className="flex gap-2">
              <Input placeholder="Your mobile or email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="h-10 text-sm" />
            </div>
            <Button onClick={sendTest} disabled={busy || !testTo} className="w-full">
              <Send style={{ width: 15, height: 15 }} /> Send Test Message
            </Button>
            {testMsg && <p className="text-center text-xs text-brand-700">{testMsg}</p>}
          </div>
        </div>

        <div className="space-y-4">
          {/* Current sending mode banner */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  {settings.smart_messaging ? <Sparkles style={{ width: 18, height: 18 }} /> : <MessageSquare style={{ width: 18, height: 18 }} />}
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Current Sending Mode</p>
                  <p className="text-sm font-semibold text-ink">{settings.smart_messaging ? 'Smart messaging is enabled' : 'Custom messaging is enabled'}</p>
                  <p className="text-xs text-ink-subtle">{settings.smart_messaging ? 'Review requests will use optimized message templates.' : 'Review requests will use your saved custom message.'}</p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                <Check style={{ width: 12, height: 12 }} /> Enabled
              </span>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 rounded-xl bg-border/40 p-1">
            {([['smart', 'Smart Message', Sparkles], ['custom', 'Custom Message', MessageSquare]] as const).map(([key, label, Icon]) => (
              <button key={key} onClick={() => { setTab(key); save({ smart_messaging: key === 'smart' }, key === 'smart' ? 'Smart messaging enabled' : 'Custom messaging enabled') }}
                className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium', tab === key ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle')}>
                <Icon style={{ width: 15, height: 15 }} /> {label}
              </button>
            ))}
          </div>

          {tab === 'smart' ? (
            <SectionCard title="Smart Messaging" action={<Sparkles className="text-brand" style={{ width: 16, height: 16 }} />}>
              <p className="-mt-1 text-xs text-ink-subtle">AI-optimized messages that continuously improve your response rates.</p>
              <div className="mt-3 rounded-xl bg-brand-50/70 p-3">
                <p className="text-sm font-semibold text-brand-700">Highest Converting Messages</p>
                <p className="mt-0.5 text-xs text-brand-700/80">We test different message variations across thousands of review requests to find what works best.</p>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-ink">
                {['Multiple message styles tested automatically', 'Learns which tone resonates with your customers', 'Continuously optimized for higher click rates'].map((t) => (
                  <li key={t} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" style={{ width: 15, height: 15 }} /> {t}</li>
                ))}
              </ul>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-ink-subtle">Owner First Name
                  <Input className="mt-1" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g., John" />
                </label>
                <label className="block text-xs font-medium text-ink-subtle">Business Name
                  <Input className="mt-1" value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="e.g., John's Auto Shop" />
                </label>
              </div>
              <Button size="sm" className="mt-3" disabled={busy || !smartDirty} onClick={() => save({ owner_first_name: owner, business_display_name: bizName }, 'Details updated')}>Update</Button>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <div>
                  <p className="text-sm font-medium text-ink">Personalized Image</p>
                  <p className="text-xs text-ink-subtle">Add a custom image to your messages.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={settings.image_enabled} onChange={(v) => save({ image_enabled: v }, v ? 'Personalized image on' : 'Personalized image off')} />
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                    <ImagePlus style={{ width: 14, height: 14 }} /> Upload Image
                  </Button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
                    onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
                </div>
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Custom Message" action={<MessageSquare className="text-brand" style={{ width: 16, height: 16 }} />}>
              <p className="-mt-1 text-xs text-ink-subtle">Write your own message template.</p>
              <div className="mb-2 mt-3 flex flex-wrap gap-1.5">
                {TOKENS.map((v) => (
                  <button key={v} onClick={() => insertVar(v)}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100">
                    {v === '{first_name}' ? 'First Name' : v === '{review_link}' ? 'Review Link' : v === '{owner_name}' ? 'Owner Name' : 'Business Name'}
                    {v === '{review_link}' && <span className="rounded bg-amber-200/70 px-1 text-[9px] font-semibold text-amber-800">Required</span>}
                  </button>
                ))}
              </div>
              <Textarea ref={taRef} value={customText} maxLength={MESSAGE_MAX} rows={5}
                onChange={(e) => setCustomText(e.target.value)} placeholder="Write your message…" />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className={cn('text-xs', lint.ok ? 'text-ink-subtle' : 'text-danger')}>
                  {lint.ok ? `${remaining} characters remaining` : lint.error}
                </span>
                <Button size="sm" disabled={busy || !lint.ok} onClick={() => save({ sms_template: customText, smart_messaging: false }, 'Message saved')}>Save Message</Button>
              </div>
            </SectionCard>
          )}
          {msg && <p className="text-sm font-medium text-brand-700">{msg}</p>}
        </div>
      </div>

      {/* ── Section 2: Follow-up messages ── */}
      <div className="border-t border-border pt-8">
        <h2 className="text-xl font-black tracking-tight text-ink">Follow-up Messages</h2>
        <p className="text-sm text-ink-subtle">Increase your review rate with automated follow-ups.</p>

        <div className="mt-4 grid gap-8 lg:grid-cols-[280px_1fr]">
          <MockPhone messages={followupMessages} />

          <div className="space-y-4">
            <SectionCard title="Enable Follow-ups" action={<TrendingUp className="text-brand" style={{ width: 16, height: 16 }} />}>
              <p className="-mt-1 text-xs text-ink-subtle">How many reminders should go to contacts who haven't left a review?</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[0, 1, 2, 3].map((n) => (
                  <button key={n} disabled={busy}
                    onClick={() => save({ followup_count: n, followups_enabled: n > 0 }, n === 0 ? 'Follow-ups off' : `${n} follow-up${n === 1 ? '' : 's'} set`)}
                    className={cn('rounded-xl border px-3 py-2 text-sm font-medium', settings.followup_count === n
                      ? 'border-brand bg-brand-50 text-brand-700' : 'border-border text-ink-subtle hover:border-ink-subtle/50')}>
                    {n === 0 ? 'No follow-ups' : `${n} follow-up${n === 1 ? '' : 's'}`}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-xl bg-emerald-50 p-3">
                <p className="text-sm font-semibold text-emerald-700">42% of reviews come from follow-up messages</p>
                <p className="mt-0.5 text-xs text-emerald-700/80">We'll send gentle reminders to customers who haven't left a review yet.</p>
              </div>
            </SectionCard>

            <SectionCard title="How Follow-ups Work">
              <ul className="grid gap-3 sm:grid-cols-2">
                {[
                  [Clock, 'Automatic Timing', `First follow-up sent ${settings.followup_gap_days} days after the initial message.`],
                  [Repeat, `Up to ${settings.followup_count} Reminders`, 'Gentle nudges spread out over time for best results.'],
                  [Ban, 'Smart Stop', 'Stops immediately when a customer clicks or responds.'],
                  [Building2, 'Business Hours Only', 'Messages sent during appropriate times for your customers.'],
                ].map(([Icon, title, body]) => {
                  const I = Icon as typeof Clock
                  return (
                    <li key={title as string} className="flex gap-2.5">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><I style={{ width: 15, height: 15 }} /></div>
                      <div>
                        <p className="text-sm font-medium text-ink">{title as string}</p>
                        <p className="text-xs text-ink-subtle">{body as string}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-xs text-ink-subtle">Follow-ups go {settings.followup_gap_days} days after the previous message and stop the moment a contact reviews or clicks.</p>
            </SectionCard>
          </div>
        </div>
      </div>

      {/* ── Section 3: Request timing & sending ── */}
      <div className="border-t border-border pt-8">
        <h2 className="text-xl font-black tracking-tight text-ink">Request timing &amp; sending</h2>
        <p className="text-sm text-ink-subtle">Choose when review requests go out, pause them any time, and confirm compliance.</p>

        <div className="mt-4 max-w-2xl space-y-4">
          {/* Pause / resume */}
          <div className={cn('flex items-center justify-between rounded-2xl border p-4', settings.sending_paused ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
            <div>
              <p className={cn('text-sm font-semibold', settings.sending_paused ? 'text-amber-800' : 'text-emerald-800')}>
                {settings.sending_paused ? 'Review requests paused' : 'Review requests active'}
              </p>
              <p className={cn('text-xs', settings.sending_paused ? 'text-amber-700' : 'text-emerald-700')}>
                {settings.sending_paused ? 'Nothing sends until you resume.' : 'Messages are being sent as scheduled.'}
              </p>
            </div>
            <Button variant={settings.sending_paused ? 'primary' : 'secondary'} size="sm" disabled={busy}
              onClick={() => save({ sending_paused: !settings.sending_paused }, settings.sending_paused ? 'Sending resumed' : 'Sending paused')}>
              {settings.sending_paused ? <><Play style={{ width: 14, height: 14 }} /> Resume</> : <><Pause style={{ width: 14, height: 14 }} /> Pause</>}
            </Button>
          </div>

          {/* Initial delay */}
          <SectionCard title="First request timing" action={<Clock className="text-brand" style={{ width: 16, height: 16 }} />}>
            <p className="-mt-1 text-xs text-ink-subtle">How long after a new customer comes in should the first review request go out?</p>
            <div className="mt-3 max-w-xs">
              <Select value={settings.initial_delay_hours} disabled={busy}
                onChange={(e) => {
                  const hours = Number(e.target.value)
                  const label = INITIAL_DELAY_OPTIONS.find((o) => o.hours === hours)?.label ?? `${hours}h`
                  save({ initial_delay_hours: hours }, `First request: ${label.toLowerCase()}`)
                }}>
                {INITIAL_DELAY_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
              </Select>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-subtle">
              <li>Requests only send between {settings.quiet_start}:00 and {settings.quiet_end}:00 (recipient local time)</li>
              <li>Anything scheduled outside that window rolls to the next morning</li>
            </ul>
          </SectionCard>

          {/* Compliance */}
          <SectionCard title="Compliance" action={<ShieldCheck className={settings.attested_at ? 'text-emerald-500' : 'text-amber-500'} style={{ width: 18, height: 18 }} />}>
            {settings.attested_at ? (
              <p className="text-sm text-emerald-700">
                Lawful-basis confirmation recorded {new Date(settings.attested_at).toLocaleDateString('en-GB')}. Requests go to ALL
                customers (never a hand-picked subset), every message identifies your business and carries an opt-out, and STOP is
                honoured instantly across every channel.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink-subtle">
                  Before anything sends, confirm your customer list meets UK rules: these are your own customers, their details were
                  collected during real transactions, and they were offered an opt-out.
                </p>
                <Button size="sm" disabled={busy} onClick={() => save({ attest: true }, 'Confirmation recorded — you can now launch campaigns')}>
                  I confirm, record it
                </Button>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
