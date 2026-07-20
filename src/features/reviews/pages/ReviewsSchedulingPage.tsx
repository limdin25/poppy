import { useEffect, useState } from 'react'
import { Pause, Play, ShieldCheck } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Select } from '@/core/ui/Select'
import { SectionCard } from '@/core/ui/SectionCard'
import { useReviewsSession, reviewsApi } from '../lib'

interface Settings {
  sending_paused: boolean
  followup_count: number
  followup_gap_days: number
  initial_delay_hours: number
  quiet_start: number
  quiet_end: number
  attested_at: string | null
}

// Mirrors Review Harvest's request-scheduling options exactly.
const INITIAL_DELAY_OPTIONS = [
  { hours: 0, label: 'Right away' },
  { hours: 4, label: 'Few hours' },
  { hours: 24, label: '24 hours' },
  { hours: 48, label: '2 days' },
  { hours: 72, label: '3 days' },
  { hours: 96, label: '4 days' },
  { hours: 120, label: '5 days' },
  { hours: 144, label: '6 days' },
  { hours: 168, label: '1 week' },
]

export default function ReviewsSchedulingPage() {
  const session = useReviewsSession()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const imp = session.impersonating ? session.businessId : null

  useEffect(() => {
    reviewsApi<{ settings: Settings }>('/api/reviews/settings', { impersonateBusinessId: imp })
      .then((out) => setSettings(out.settings))
      .catch((e) => setMsg((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  async function save(patch: Record<string, unknown>, note: string) {
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

  if (!settings) return <p className="py-12 text-center text-sm text-ink-subtle">{msg ?? 'Loading…'}</p>

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Request scheduling</h1>
        <p className="text-sm text-ink-subtle">Choose when and how review requests go out</p>
      </div>

      <div className={`flex items-center justify-between rounded-2xl border p-4 ${settings.sending_paused ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div>
          <p className={`text-sm font-semibold ${settings.sending_paused ? 'text-amber-800' : 'text-emerald-800'}`}>
            {settings.sending_paused ? 'Review requests paused' : 'Review requests active'}
          </p>
          <p className={`text-xs ${settings.sending_paused ? 'text-amber-700' : 'text-emerald-700'}`}>
            {settings.sending_paused ? 'Nothing sends until you resume' : 'Messages are being sent as scheduled'}
          </p>
        </div>
        <Button
          variant={settings.sending_paused ? 'primary' : 'secondary'}
          size="sm"
          disabled={busy}
          onClick={() => save({ sending_paused: !settings.sending_paused }, settings.sending_paused ? 'Sending resumed' : 'Sending paused')}
        >
          {settings.sending_paused ? <><Play style={{ width: 14, height: 14 }} /> Resume</> : <><Pause style={{ width: 14, height: 14 }} /> Pause</>}
        </Button>
      </div>

      <SectionCard title="Initial request scheduling">
        <p className="text-sm text-ink-subtle">How long after a new customer comes in should the first review request go out?</p>
        <div className="mt-3 max-w-xs">
          <Select
            value={settings.initial_delay_hours}
            disabled={busy}
            onChange={(e) => {
              const hours = Number(e.target.value)
              const label = INITIAL_DELAY_OPTIONS.find((o) => o.hours === hours)?.label ?? `${hours}h`
              save({ initial_delay_hours: hours }, `First request: ${label.toLowerCase()}`)
            }}
          >
            {INITIAL_DELAY_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>{o.label}</option>
            ))}
          </Select>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-subtle">
          <li>Requests only send between {settings.quiet_start}:00 and {settings.quiet_end}:00 (your local time)</li>
          <li>Anything scheduled outside that window rolls to the next morning</li>
          <li>A short wait after the job keeps the experience fresh in your customer's mind</li>
        </ul>
      </SectionCard>

      <SectionCard title="Follow-up messages">
        <p className="text-sm text-ink-subtle">How many reminders should go to contacts who haven't left a review?</p>
        <div className="mt-3 flex gap-2">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} disabled={busy}
              onClick={() => save({ followup_count: n }, n === 0 ? 'No follow-ups set' : `${n} follow-up${n === 1 ? '' : 's'} set`)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${settings.followup_count === n ? 'border-brand bg-brand-50 text-brand-700' : 'border-border text-ink-subtle hover:border-ink-subtle/50'}`}>
              {n === 0 ? 'No follow-ups' : `${n} follow-up${n === 1 ? '' : 's'}`}
            </button>
          ))}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-subtle">
          <li>Follow-ups go {settings.followup_gap_days} days after the previous message</li>
          <li>Contacts who click your review link are excluded automatically</li>
          <li>You can stop any individual contact from the Contacts page</li>
        </ul>
      </SectionCard>

      <SectionCard title="Compliance" action={<ShieldCheck className={settings.attested_at ? 'text-emerald-500' : 'text-amber-500'} style={{ width: 18, height: 18 }} />}>
        {settings.attested_at ? (
          <p className="text-sm text-emerald-700">
            Lawful-basis confirmation recorded {new Date(settings.attested_at).toLocaleDateString('en-GB')}. Requests
            go to ALL customers (never a hand-picked subset), every message identifies your business and carries an
            opt-out, and STOP is honoured instantly across every channel.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-subtle">
              Before anything sends, confirm your customer list meets UK rules: these are your own customers, their
              details were collected during real transactions, and they were offered an opt-out.
            </p>
            <Button size="sm" disabled={busy} onClick={() => save({ attest: true }, 'Confirmation recorded. You can now launch campaigns')}>
              I confirm, record it
            </Button>
          </div>
        )}
      </SectionCard>

      {msg && <p className="text-sm font-medium text-brand-700">{msg}</p>}
    </div>
  )
}
