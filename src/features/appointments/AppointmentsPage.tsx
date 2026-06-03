import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, CalendarCheck, CalendarDays, CheckCircle2, Loader2 } from 'lucide-react'
import { PageHeader } from '@/core/ui/PageHeader'
import { StatCard } from '@/core/ui/StatCard'
import { SectionCard } from '@/core/ui/SectionCard'
import { StatusPill, type PillTone } from '@/core/ui/StatusPill'
import { FilterChips } from '@/core/ui/FilterChips'
import { Avatar } from '@/core/ui/Avatar'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { useAppointments } from '@/core/hooks/useAppointments'
import { useAuth } from '@/core/auth/AuthProvider'
import type { Appointment } from '@/core/types/database'

/**
 * Appointments (waslo-faithful visual clone), wired to real data via
 * useAppointments(). Buckets, chip counts, stat cards and rows are all
 * computed from real appointment datetimes + status. WhatsApp-only copy,
 * no credits. "New booking" is a no-op TODO for now.
 */

type Bucket = 'today' | 'upcoming' | 'past'

const STATUS_LABEL: Record<Appointment['status'], string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Confirmed',
  no_show: 'Cancelled',
}

const STATUS_TONE: Record<Appointment['status'], PillTone> = {
  pending: 'warning',
  confirmed: 'success',
  cancelled: 'danger',
  completed: 'success',
  no_show: 'danger',
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function bucketFor(startsAt: string, todayStart: number, tomorrowStart: number): Bucket {
  const t = new Date(startsAt).getTime()
  if (t < todayStart) return 'past'
  if (t < tomorrowStart) return 'today'
  return 'upcoming'
}

function dayLabel(startsAt: string): string {
  const d = new Date(startsAt)
  const today = startOfDay(new Date())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function timeLabel(startsAt: string): string {
  return new Date(startsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

interface DayGroup {
  day: string
  sortKey: number
  bucket: Bucket
  items: Appointment[]
}

export default function AppointmentsPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { data: appointments, loading, refetch } = useAppointments()
  const [filter, setFilter] = useState<Bucket>('today')

  // New-booking modal
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bName, setBName] = useState('')
  const [bPhone, setBPhone] = useState('')
  const [bService, setBService] = useState('')
  const [bWhen, setBWhen] = useState('')
  const [bDuration, setBDuration] = useState(60)
  const [bNotes, setBNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)

  function openBooking() {
    setBName(''); setBPhone(''); setBService(''); setBWhen(''); setBDuration(60); setBNotes('')
    setBookError(null)
    setBookingOpen(true)
  }

  async function submitBooking() {
    if (!session) return
    if (!bWhen) { setBookError('Pick a date and time.'); return }
    setSaving(true)
    setBookError(null)
    try {
      const res = await fetch('/api/appointments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          name: bName.trim(),
          phone: bPhone.trim(),
          service: bService.trim() || 'Appointment',
          startsAt: new Date(bWhen).toISOString(),
          durationMins: bDuration,
          notes: bNotes.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setBookError(data.error || 'Could not create the booking.'); return }
      setBookingOpen(false)
      refetch()
    } catch (e) {
      setBookError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  const { groupsByBucket, counts, confirmedRate, todayPending, thisWeek } = useMemo(() => {
    const now = new Date()
    const todayStart = startOfDay(now).getTime()
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000
    // "This week" = today + the next 6 days.
    const weekEnd = todayStart + 7 * 24 * 60 * 60 * 1000

    const buckets: Record<Bucket, Map<string, DayGroup>> = {
      today: new Map(),
      upcoming: new Map(),
      past: new Map(),
    }

    let todayCount = 0
    let upcomingCount = 0
    let pastCount = 0
    let confirmedCount = 0
    let activeTotal = 0
    let todayPendingCount = 0
    let thisWeekCount = 0

    for (const appt of appointments) {
      const bucket = bucketFor(appt.starts_at, todayStart, tomorrowStart)
      const map = buckets[bucket]
      const label = dayLabel(appt.starts_at)
      const sortKey = startOfDay(new Date(appt.starts_at)).getTime()
      const group = map.get(label)
      if (group) group.items.push(appt)
      else map.set(label, { day: label, sortKey, bucket, items: [appt] })

      if (bucket === 'today') todayCount++
      else if (bucket === 'upcoming') upcomingCount++
      else pastCount++

      const isCancelled = appt.status === 'cancelled' || appt.status === 'no_show'
      if (!isCancelled) {
        activeTotal++
        if (appt.status === 'confirmed' || appt.status === 'completed') confirmedCount++
      }
      if (bucket === 'today' && appt.status === 'pending') todayPendingCount++

      const t = new Date(appt.starts_at).getTime()
      if (t >= todayStart && t < weekEnd && !isCancelled) thisWeekCount++
    }

    const sortGroups = (b: Bucket) => {
      const arr = [...buckets[b].values()]
      arr.sort((a, c) => (b === 'past' ? c.sortKey - a.sortKey : a.sortKey - c.sortKey))
      for (const g of arr) {
        g.items.sort((x, y) => new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime())
      }
      return arr
    }

    return {
      groupsByBucket: {
        today: sortGroups('today'),
        upcoming: sortGroups('upcoming'),
        past: sortGroups('past'),
      } as Record<Bucket, DayGroup[]>,
      counts: { today: todayCount, upcoming: upcomingCount, past: pastCount },
      confirmedRate: activeTotal ? Math.round((confirmedCount / activeTotal) * 100) : 0,
      todayPending: todayPendingCount,
      thisWeek: thisWeekCount,
    }
  }, [appointments])

  const groups = groupsByBucket[filter]
  const hasAny = appointments.length > 0

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Work"
        title="Appointments"
        description="Every booking Elsie has taken and confirmed for you, straight from WhatsApp."
        actions={
          <>
            <FilterChips
              options={[
                { value: 'today', label: 'Today', count: counts.today },
                { value: 'upcoming', label: 'Upcoming', count: counts.upcoming },
                { value: 'past', label: 'Past', count: counts.past },
              ]}
              value={filter}
              onChange={(v) => setFilter(v as Bucket)}
            />
            <button
              onClick={openBooking}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
            >
              <CalendarPlus size={15} /> New booking
            </button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<CalendarCheck />}
          label="Today"
          value={counts.today}
          sub={`${counts.today} booked · ${todayPending} pending`}
        />
        <StatCard
          icon={<CalendarDays />}
          label="This week"
          value={thisWeek}
          sub="Booked via WhatsApp"
        />
        <StatCard
          icon={<CheckCircle2 />}
          label="Confirmed rate"
          value={`${confirmedRate}%`}
          sub="Auto-confirmed by Elsie"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : !hasAny ? (
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
              <CalendarDays size={22} className="text-ink-subtle" />
            </div>
            <p className="mt-3 text-[15px] font-semibold text-ink">No appointments yet</p>
            <p className="mt-1 max-w-sm text-[13px] text-ink-muted">
              Add a booking yourself, or let Elsie book straight from WhatsApp. Connecting Google
              Calendar is optional — bookings are saved here either way.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={openBooking}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white transition hover:opacity-90"
              >
                <CalendarPlus size={14} />
                New booking
              </button>
              <button
                onClick={() => navigate('/connections')}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] font-medium text-ink transition hover:bg-elevated"
              >
                Connect Google Calendar
              </button>
            </div>
          </div>
        </SectionCard>
      ) : (
        <div className="space-y-5">
          {groups.length === 0 ? (
            <SectionCard>
              <p className="py-8 text-center text-[13px] text-ink-muted">No bookings in this view.</p>
            </SectionCard>
          ) : (
            groups.map((group) => (
              <SectionCard
                key={group.day}
                title={group.day}
                action={
                  <span className="text-[12px] text-ink-subtle">
                    {group.items.length} {group.items.length === 1 ? 'booking' : 'bookings'}
                  </span>
                }
                bodyClassName="p-0"
              >
                <ul className="divide-y divide-border">
                  {group.items.map((appt) => {
                    const name = appt.contact?.name ?? 'Unknown'
                    const service = appt.service?.name ?? appt.title
                    return (
                      <li
                        key={appt.id}
                        className="flex flex-col gap-2.5 px-5 py-3.5 transition-colors hover:bg-elevated/50 sm:flex-row sm:items-center sm:gap-3"
                      >
                        <div className="flex h-9 w-[52px] shrink-0 items-center justify-center rounded-lg bg-elevated text-[12.5px] font-semibold text-ink">
                          {timeLabel(appt.starts_at)}
                        </div>
                        <div className="flex items-center gap-3 sm:contents">
                          <Avatar name={name} channel="whatsapp" size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium text-ink">{name}</p>
                            <p className="truncate text-[12.5px] text-ink-muted">{service}</p>
                          </div>
                        </div>
                        <StatusPill
                          tone={STATUS_TONE[appt.status]}
                          uppercase={false}
                          className="self-start sm:self-auto"
                        >
                          {STATUS_LABEL[appt.status]}
                        </StatusPill>
                      </li>
                    )
                  })}
                </ul>
              </SectionCard>
            ))
          )}
        </div>
      )}

      <Dialog open={bookingOpen} onClose={() => !saving && setBookingOpen(false)} width="md">
        <DialogHeader>New booking</DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-ink-muted">Customer name</label>
              <input
                value={bName}
                onChange={(e) => setBName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-ink-muted">Phone (WhatsApp)</label>
              <input
                value={bPhone}
                onChange={(e) => setBPhone(e.target.value)}
                placeholder="+44…"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Service</label>
            <input
              value={bService}
              onChange={(e) => setBService(e.target.value)}
              placeholder="Consultation"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-ink-muted">Date &amp; time</label>
              <input
                type="datetime-local"
                value={bWhen}
                onChange={(e) => setBWhen(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-ink-muted">Duration (mins)</label>
              <input
                type="number"
                min={15}
                step={15}
                value={bDuration}
                onChange={(e) => setBDuration(Math.max(15, Number(e.target.value) || 60))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Notes (optional)</label>
            <textarea
              value={bNotes}
              onChange={(e) => setBNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          {bookError && <p className="text-[12.5px] text-red-600">{bookError}</p>}
          <p className="text-[11px] text-ink-subtle">
            Saved to your appointments immediately. If Google Calendar is connected, the event is added there too.
          </p>
        </DialogBody>
        <DialogFooter>
          <button
            onClick={() => setBookingOpen(false)}
            disabled={saving}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submitBooking}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving…' : 'Create booking'}
          </button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
