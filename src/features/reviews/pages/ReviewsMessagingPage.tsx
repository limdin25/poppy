import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input, Textarea } from '@/core/ui/Input'
import { SectionCard } from '@/core/ui/SectionCard'
import { Switch } from '@/core/ui/Switch'
import { cn } from '@/core/lib/cn'
import { useReviewsSession, reviewsApi } from '../lib'

interface Settings {
  smart_messaging: boolean
  sms_template: string | null
  followup_template: string | null
  owner_first_name: string | null
  followups_enabled: boolean
  followup_count: number
  followup_gap_days: number
  image_enabled: boolean
  sms_from_number: string | null
}

interface Template { public_url: string }

const DEFAULT_PREVIEW = 'Hey {first_name}, thanks for choosing {business_name}! Would you mind leaving us a quick Google review? It only takes a minute and really helps: {review_link}'
const VARIABLES = ['{first_name}', '{review_link}', '{owner_name}', '{business_name}'] as const

export default function ReviewsMessagingPage() {
  const session = useReviewsSession()
  const [tab, setTab] = useState<'smart' | 'custom'>('smart')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)
  const [defaultImage, setDefaultImage] = useState('')
  const [customText, setCustomText] = useState('')
  const [owner, setOwner] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const imp = session.impersonating ? session.businessId : null

  useEffect(() => {
    async function load() {
      const out = await reviewsApi<{ settings: Settings }>('/api/reviews/settings', { impersonateBusinessId: imp })
      setSettings(out.settings)
      setTab(out.settings.smart_messaging ? 'smart' : 'custom')
      setCustomText(out.settings.sms_template ?? DEFAULT_PREVIEW)
      setOwner(out.settings.owner_first_name ?? '')
      const t = await reviewsApi<{ template: Template | null; defaultUrl: string }>('/api/reviews/image-template', { impersonateBusinessId: imp })
      setTemplate(t.template)
      setDefaultImage(t.defaultUrl)
    }
    load().catch((e) => setMsg((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  async function save(patch: Record<string, unknown>, note = 'Saved') {
    setBusy(true)
    setMsg(null)
    try {
      const out = await reviewsApi<{ settings: Settings }>('/api/reviews/settings', { method: 'PUT', body: patch, impersonateBusinessId: imp })
      setSettings(out.settings)
      setMsg(note)
    } catch (err) {
      setMsg((err as Error).message)
    }
    setBusy(false)
  }

  async function uploadImage(file: File) {
    setBusy(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const out = await reviewsApi<{ template: Template }>('/api/reviews/image-template', { formData: fd, impersonateBusinessId: imp })
      setTemplate(out.template)
      setMsg('Image uploaded. New requests will use it')
    } catch (err) {
      setMsg((err as Error).message)
    }
    setBusy(false)
  }

  async function sendTest() {
    setTestMsg(null)
    setBusy(true)
    try {
      const out = await reviewsApi<{ channel: string }>('/api/reviews/send-test', {
        body: testPhone.includes('@') ? { email: testPhone } : { phone: testPhone, first_name: session.businessName.split(/\s+/)[0] },
        impersonateBusinessId: imp,
      })
      setTestMsg(`Test ${out.channel === 'sms' ? 'text' : 'email'} sent. Check your ${out.channel === 'sms' ? 'phone' : 'inbox'}.`)
    } catch (err) {
      setTestMsg((err as Error).message)
    }
    setBusy(false)
  }

  if (!settings) return <p className="py-12 text-center text-sm text-ink-subtle">{msg ?? 'Loading…'}</p>

  const previewText = (tab === 'custom' ? customText : DEFAULT_PREVIEW)
    .replaceAll('{first_name}', 'Jessica')
    .replaceAll('{business_name}', session.businessName)
    .replaceAll('{owner_name}', owner || 'the team')
    .replaceAll('{review_link}', 'go.heyelsie.com/r/abc123')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Messaging</h1>
        <p className="text-sm text-ink-subtle">Configure how review requests are sent to your customers</p>
      </div>

      <div className={cn('rounded-xl px-4 py-2.5 text-sm font-medium',
        settings.smart_messaging ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700')}>
        Current sending mode: {settings.smart_messaging ? 'Smart messaging (AI-written)' : 'Custom template'}
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        {/* Phone preview */}
        <div className="order-2 lg:order-1">
          <div className="mx-auto w-64 rounded-[36px] border-4 border-ink/80 bg-white p-3 shadow-card">
            <div className="mx-auto mb-2 h-1 w-16 rounded-full bg-ink/20" />
            {settings.image_enabled && (
              <img src={template?.public_url || defaultImage} alt="Personalised" className="mb-2 w-full rounded-xl" />
            )}
            <div className="rounded-2xl rounded-tl-sm bg-border/40 p-3 text-[13px] leading-snug text-ink">
              {previewText} Reply STOP to opt out.
            </div>
            <p className="mt-1 text-right text-[10px] text-ink-subtle">9:41 AM</p>
          </div>
          <div className="mx-auto mt-3 flex max-w-64 gap-2">
            <Input placeholder="Your mobile or email" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} className="h-9 text-xs" />
            <Button size="sm" variant="secondary" onClick={sendTest} disabled={busy || !testPhone}>
              <Send style={{ width: 13, height: 13 }} /> Test
            </Button>
          </div>
          {testMsg && <p className="mt-1 text-center text-xs text-brand-700">{testMsg}</p>}
        </div>

        <div className="order-1 space-y-4 lg:order-2">
          <div className="flex gap-1 rounded-xl bg-border/40 p-1 sm:w-fit">
            {(['smart', 'custom'] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); save({ smart_messaging: t === 'smart' }, t === 'smart' ? 'Smart messaging enabled' : 'Custom template enabled') }}
                className={cn('flex-1 rounded-lg px-4 py-1.5 text-sm font-medium sm:flex-none',
                  tab === t ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle')}>
                {t === 'smart' ? 'Smart message' : 'Custom message'}
              </button>
            ))}
          </div>

          {tab === 'smart' ? (
            <SectionCard title="Smart messaging" action={<Sparkles className="text-brand" style={{ width: 16, height: 16 }} />}>
              <p className="text-sm text-ink-subtle">
                Claude writes each request individually: warm, personal, and different every time, always with your
                business name, the review link and an opt-out line.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-ink">
                <li>✓ Message wording tailored per customer</li>
                <li>✓ Learns your business's tone from its profile</li>
                <li>✓ Never offers incentives (Google rules built in)</li>
              </ul>
            </SectionCard>
          ) : (
            <SectionCard title="Custom message">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {VARIABLES.map((v) => (
                  <button key={v} onClick={() => setCustomText((t) => `${t} ${v}`)}
                    className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100">
                    {v}{v === '{review_link}' && ' *'}
                  </button>
                ))}
              </div>
              <Textarea value={customText} onChange={(e) => setCustomText(e.target.value)} maxLength={320} rows={4} />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-ink-subtle">{320 - customText.length} characters remaining · {'{review_link}'} required</span>
                <Button size="sm" onClick={() => save({ sms_template: customText, smart_messaging: false }, 'Template saved')} disabled={busy}>Save message</Button>
              </div>
            </SectionCard>
          )}

          <SectionCard title="Sender details">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-ink-subtle">Owner first name</label>
                <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. Sam" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink-subtle">Your sender number</label>
                <Input value={settings.sms_from_number ?? 'Being assigned by our team…'} disabled />
              </div>
            </div>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => save({ owner_first_name: owner })} disabled={busy}>Update</Button>
          </SectionCard>

          <SectionCard title="Personalised image" action={
            <Switch checked={settings.image_enabled} onChange={(v) => save({ image_enabled: v }, v ? 'Personalised images on' : 'Personalised images off')} />
          }>
            <p className="text-sm text-ink-subtle">
              Your customer's first name is rendered onto your team photo ("Hi Sally!") and included with every
              request (embedded in emails; UK texts carry it via the link).
            </p>
            <div className="mt-3 flex items-center gap-3">
              <img src={template?.public_url || defaultImage} alt="Template" className="h-16 w-24 rounded-lg object-cover" />
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>Upload image</Button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
            </div>
          </SectionCard>

          <SectionCard title="Follow-up messages" action={
            <Switch checked={settings.followups_enabled} onChange={(v) => save({ followups_enabled: v }, v ? 'Follow-ups on' : 'Follow-ups off')} />
          }>
            <p className="text-sm text-ink-subtle">42% of reviews come from follow-ups. Gentle nudges go to customers who haven't reviewed yet.</p>
            <ul className="mt-3 grid gap-2 text-sm text-ink sm:grid-cols-2">
              <li>⏱ First follow-up {settings.followup_gap_days} days after the initial message</li>
              <li>🔁 Up to {settings.followup_count} reminders (change in Scheduling)</li>
              <li>🛑 Stops the moment they review or click the link</li>
              <li>🕘 Business hours only</li>
            </ul>
          </SectionCard>

          {msg && <p className="text-sm font-medium text-brand-700">{msg}</p>}
        </div>
      </div>
    </div>
  )
}
