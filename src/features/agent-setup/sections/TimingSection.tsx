import { useState, useEffect } from 'react'
import { Loader2, Clock, Moon, Calendar } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { cn } from '@/core/lib/cn'

const DELAY_OPTIONS = [
  { value: 0, label: 'Immediately', description: 'Elsie responds right away to every message' },
  { value: 30, label: '30 seconds', description: 'Quick pause — feels more human' },
  { value: 60, label: '1 minute', description: 'Short wait before stepping in' },
  { value: 120, label: '2 minutes', description: 'Gives you a moment to see the message' },
  { value: 300, label: '5 minutes', description: 'Time to finish a quick task' },
  { value: 600, label: '10 minutes', description: 'Enough to wrap up most conversations' },
  { value: 1200, label: '20 minutes', description: 'Default — good for salons and trades' },
  { value: 1800, label: '30 minutes', description: 'For when you\'re in long appointments' },
]

const AFTER_HOURS_OPTIONS = [
  { value: 0, label: 'Immediately', description: 'No waiting — no one is around to reply' },
  { value: 30, label: '30 seconds', description: 'Quick pause so it feels natural' },
  { value: 60, label: '1 minute', description: 'Short wait' },
  { value: 300, label: '5 minutes', description: 'Slight delay' },
]

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, '0')}:00`,
}))

export default function TimingSection() {
  const { businessId } = useAuth()
  const { data: business, refetch } = useBusiness()
  const [delay, setDelay] = useState(1200)
  const [afterHoursDelay, setAfterHoursDelay] = useState(0)
  const [workStart, setWorkStart] = useState(8)
  const [workEnd, setWorkEnd] = useState(18)
  const [workDays, setWorkDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (business) {
      setDelay(business.takeover_delay_seconds ?? 1200)
      setAfterHoursDelay(business.after_hours_delay_seconds ?? 0)
      setWorkStart(business.working_hours_start ?? 8)
      setWorkEnd(business.working_hours_end ?? 18)
      setWorkDays(business.working_days?.length ? business.working_days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    }
  }, [business])

  function toggleDay(day: string) {
    setWorkDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  async function handleSave() {
    if (!businessId) return
    setSaving(true)
    const { error } = await supabase
      .from('businesses')
      .update({
        takeover_delay_seconds: delay,
        after_hours_delay_seconds: afterHoursDelay,
        working_hours_start: workStart,
        working_hours_end: workEnd,
        working_days: workDays,
      })
      .eq('id', businessId)
    if (!error) {
      refetch()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  const isImmediate = delay === 0

  return (
    <div className="space-y-6">
      {/* During working hours */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10">
            <Clock size={18} className="text-brand" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">During working hours</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              How long Elsie waits before responding to messages. If you reply first, Elsie stays silent.
            </p>
          </div>
        </div>

        {delay > 0 && delay < 30 && (
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            We recommend at least 30 seconds so replies feel more natural to your customers.
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DELAY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDelay(opt.value)}
              className={cn(
                'rounded-xl border px-3 py-3 text-left transition',
                delay === opt.value
                  ? 'border-brand bg-brand/5 ring-1 ring-brand'
                  : 'border-border hover:border-brand/40'
              )}
            >
              <p className={cn(
                'text-[13px] font-semibold',
                delay === opt.value ? 'text-brand' : 'text-ink'
              )}>
                {opt.label}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted leading-tight">{opt.description}</p>
            </button>
          ))}
        </div>

        {isImmediate && (
          <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-[13px] text-blue-800">
            Elsie will respond to every message instantly. You can still reply manually — your message will appear alongside Elsie's.
          </div>
        )}
      </div>

      {/* After hours */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
            <Moon size={18} className="text-purple-600" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">After working hours</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              How long Elsie waits outside your working hours. Most businesses set this to immediate since no one is around to reply.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {AFTER_HOURS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setAfterHoursDelay(opt.value)}
              className={cn(
                'rounded-xl border px-3 py-3 text-left transition',
                afterHoursDelay === opt.value
                  ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
                  : 'border-border hover:border-purple-300'
              )}
            >
              <p className={cn(
                'text-[13px] font-semibold',
                afterHoursDelay === opt.value ? 'text-purple-700' : 'text-ink'
              )}>
                {opt.label}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted leading-tight">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Working hours schedule */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
            <Calendar size={18} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Working hours</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Set when your business is open. Outside these hours, Elsie uses the after-hours delay.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[13px] font-medium text-ink mb-2">Working days</p>
          <div className="flex flex-wrap gap-2">
            {ALL_DAYS.map(day => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className={cn(
                  'rounded-full px-4 py-1.5 text-[13px] font-medium transition',
                  workDays.includes(day)
                    ? 'bg-emerald-500 text-white'
                    : 'bg-elevated text-ink-muted hover:bg-emerald-100 hover:text-emerald-700'
                )}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div>
            <label className="text-[13px] font-medium text-ink">Opens at</label>
            <select
              value={workStart}
              onChange={e => setWorkStart(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              {HOURS.map(h => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </div>
          <span className="mt-6 text-ink-muted">to</span>
          <div>
            <label className="text-[13px] font-medium text-ink">Closes at</label>
            <select
              value={workEnd}
              onChange={e => setWorkEnd(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            >
              {HOURS.map(h => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex h-10 items-center gap-2 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
