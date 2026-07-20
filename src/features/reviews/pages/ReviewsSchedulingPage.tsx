import { useEffect, useState } from 'react'
import { Pause, Play, ShieldCheck } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { SectionCard } from '@/core/ui/SectionCard'
import { useReviewsSession, reviewsApi } from '../lib'

interface Settings {
  sending_paused: boolean
  followup_count: number
  followup_gap_days: number
  drip_per_day: number
  quiet_start: number
  quiet_end: number
  attested_at: string | null
}

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
        <h1 className="text-xl font-semibold text-ink">Request scheduling</h1>
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
        <p className="text-sm text-ink-subtle">New contacts are asked right away, drip-paced so reviews arrive naturally.</p>
        <div className="mt-3">
          <label className="text-xs font-medium text-ink-subtle">Daily sending pace: {settings.drip_per_day} requests/day</label>
          <input type="range" min={5} max={100} step={5} value={settings.drip_per_day}
            onChange={(e) => setSettings({ ...settings, drip_per_day: Number(e.target.value) })}
            onMouseUp={() => save({ drip_per_day: settings.drip_per_day }, 'Pace updated')}
            onTouchEnd={() => save({ drip_per_day: settings.drip_per_day }, 'Pace updated')}
            className="mt-1 w-full accent-brand" />
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-ink-subtle">
          <li>Requests only send between {settings.quiet_start}:00 and {settings.quiet_end}:00 (your local time)</li>
          <li>Anything scheduled outside that window rolls to the next morning</li>
          <li>A steady drip looks organic to Google and keeps opt-outs low</li>
        </ul>
      </SectionCard>

      <SectionCard title="Follow-up messages">
        <p className="text-sm text-ink-subtle">How many reminders should go to contacts who haven't left a review?</p>
        <div className="mt-3 flex gap-2">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} disabled={busy}
              onClick={() => save({ followup_count: n }, `${n} follow-up${n === 1 ? '' : 's'} set`)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${settings.followup_count === n ? 'border-brand bg-brand-50 text-brand-700' : 'border-border text-ink-subtle hover:border-ink-subtle/50'}`}>
              {n === 0 ? 'None' : `${n} follow-up${n === 1 ? '' : 's'}`}
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
            <Button size="sm" disabled={busy} onClick={() => save({ attest: true }, 'Confirmation recorded — you can now launch campaigns')}>
              I confirm — record it
            </Button>
          </div>
        )}
      </SectionCard>

      {msg && <p className="text-sm font-medium text-brand-700">{msg}</p>}
    </div>
  )
}
